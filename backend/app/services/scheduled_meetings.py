from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.realtime.state import call_registry
from app.repositories import scheduled_meetings as repo
from app.schemas.scheduled_meetings import (
    CreateScheduledMeetingIn,
    InviteeOut,
    RoomAvailabilityOut,
    RoomBookingOut,
    ScheduledMeetingOut,
    UpdateScheduledMeetingIn,
)
from app.services import meeting_notifications
from app.services.call_registry import MEETING_KEY_PREFIX
from app.services.meeting_floor_rooms import (
    MEETING_FLOOR_ROOMS,
    room_by_id,
    room_for_meeting_id,
)

# SCHEDULED MEETINGS V1 — the rules. Three jobs, kept apart:
#
#   1. BOOKINGS: validate, refuse overlaps, write. The server is the only guard against a double
#      booking; any availability shown to a client is a convenience.
#   2. WHAT OTHERS MAY SEE: a private meeting is visible to non-invitees only as "this room is
#      reserved, privately, from/to" — never its title, organizer or invitees.
#   3. WHO MAY ENTER: during a private booking's access window only its invitees may get the room's
#      meeting token, register as a participant, or be rung into it. Room authorization only —
#      personal DND and presence are never read or written here.
#
# THE LIVE MEETING IS NOT STORED. A booking says who may use a room and when; whether the room's
# meeting is running stays call_registry's answer. The one piece of in-memory state below — which
# booking a LIVE session belongs to — exists so that a meeting running past its end keeps its own
# rules until it empties, and the next booking never silently takes over a room somebody is in.

MIN_DURATION = timedelta(minutes=15)
MAX_DURATION = timedelta(hours=8)
# A client clock a little behind the server's must not make "starts now" read as "in the past".
START_GRACE = timedelta(seconds=60)
# A private booking closes its room this long before it starts, matching the room's "starting" state.
ACCESS_LEAD = timedelta(minutes=5)
# An invitee who starts their room's meeting this long before it is booked starts THAT meeting.
EARLY_START = timedelta(minutes=15)
MAX_INVITEES = 100
TITLE_MAX = 120

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime) -> datetime:
    # SQLite hands timezone-aware columns back naive; every writer stores UTC, so naive == UTC.
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _client_utc(dt: datetime, field: str) -> datetime:
    """A client timestamp must say which instant it means. Naive ones are refused, not guessed."""
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise HTTPException(status_code=400, detail=f"{field} must include a timezone offset")
    return dt.astimezone(timezone.utc)


def _title(raw: str) -> str:
    title = (raw or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if len(title) > TITLE_MAX:
        raise HTTPException(status_code=400, detail=f"Title must be at most {TITLE_MAX} characters")
    return title


def _room(raw: str) -> str:
    room = room_by_id(raw)
    if room is None:
        raise HTTPException(status_code=400, detail="Unknown Meeting Floor room")
    return room.id


def _invitees(raw: list[str], organizer: str) -> list[str]:
    """Normalised, de-duplicated invitee emails, the organizer removed (they are added separately)."""
    out: list[str] = []
    for item in raw:
        email = (item or "").strip().lower()
        if not _EMAIL.match(email):
            raise HTTPException(status_code=400, detail=f"Invalid invitee email: {item!r}")
        if email != organizer and email not in out:
            out.append(email)
    if len(out) > MAX_INVITEES:
        raise HTTPException(status_code=400, detail=f"At most {MAX_INVITEES} invitees")
    return out


def _window(starts_at: datetime, ends_at: datetime, *, now: datetime, check_start: bool) -> None:
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="endsAt must be after startsAt")
    if check_start and starts_at < now - START_GRACE:
        raise HTTPException(status_code=400, detail="startsAt is in the past")
    span = ends_at - starts_at
    if span < MIN_DURATION:
        raise HTTPException(status_code=400, detail="A meeting must be at least 15 minutes")
    if span > MAX_DURATION:
        raise HTTPException(status_code=400, detail="A meeting can be at most 8 hours")


# ---- the room-booking lock -----------------------------------------------------------------------
#
# Check-then-write must be one step per room, or two people booking the same slot at once both pass
# the check. Two layers, each covering what the other cannot:
#   * an asyncio.Lock per room serialises bookings inside this process (the app's deployment is one
#     worker — the same assumption call_registry/meeting_hosts already make — and it is what makes
#     SQLite safe, where there is no row lock to take);
#   * on Postgres, a transaction-scoped advisory lock per room serialises across processes too, so a
#     second worker added later cannot double-book either. Released by the commit below.
# The commit happens INSIDE both, so the next booker's check sees this one's row.

_room_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def _lock_room_in_db(session: AsyncSession, room_id: str) -> None:
    if session.get_bind().dialect.name == "postgresql":
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"scheduled_meetings:{room_id}"}
        )


async def _refuse_conflict(
    session: AsyncSession, *, room_id: str, starts_at: datetime, ends_at: datetime, exclude_id: str | None = None
) -> None:
    clash = await repo.first_conflict(
        session, room_id=room_id, starts_at=starts_at, ends_at=ends_at, exclude_id=exclude_id
    )
    if clash is not None:
        # The clashing window is safe to state (the floor can see it anyway); its title is not.
        raise HTTPException(
            status_code=409,
            detail={
                "error": "Room is already booked for part of that time",
                "conflict": {
                    "roomId": clash.room_id,
                    "startsAt": _iso(clash.starts_at),
                    "endsAt": _iso(clash.ends_at),
                },
            },
        )


def _iso(dt: datetime) -> str:
    return as_utc(dt).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---- serialisation -------------------------------------------------------------------------------


def full_view(meeting: ScheduledMeeting, invitees: list[ScheduledMeetingInvitee]) -> ScheduledMeetingOut:
    return ScheduledMeetingOut(
        id=meeting.id,
        title=meeting.title,
        room_id=meeting.room_id,
        organizer_email=meeting.organizer_email,
        starts_at=as_utc(meeting.starts_at),
        ends_at=as_utc(meeting.ends_at),
        is_private=meeting.is_private,
        status=meeting.status,
        invitees=[InviteeOut(email=i.email, response=i.response) for i in invitees],
        created_at=as_utc(meeting.created_at),
        updated_at=as_utc(meeting.updated_at),
    )


def booking_view(meeting: ScheduledMeeting, *, viewer_is_invitee: bool) -> RoomBookingOut:
    """What the whole floor may know. A private meeting the viewer is not in is a reserved window
    and nothing more — no id, no title, no organizer."""
    hidden = meeting.is_private and not viewer_is_invitee
    return RoomBookingOut(
        id=None if hidden else meeting.id,
        room_id=meeting.room_id,
        starts_at=as_utc(meeting.starts_at),
        ends_at=as_utc(meeting.ends_at),
        is_private=meeting.is_private,
        title=None if hidden else meeting.title,
        organizer_email=None if hidden else meeting.organizer_email,
        viewer_is_invitee=viewer_is_invitee,
    )


async def _full(session: AsyncSession, meeting: ScheduledMeeting) -> ScheduledMeetingOut:
    invitees = (await repo.invitees_by_meeting(session, [meeting.id]))[meeting.id]
    return full_view(meeting, invitees)


# ---- bookings ------------------------------------------------------------------------------------


async def create(session: AsyncSession, body: CreateScheduledMeetingIn, organizer: str) -> ScheduledMeetingOut:
    organizer = organizer.strip().lower()
    now = _now()
    title = _title(body.title)
    room_id = _room(body.room_id)
    starts_at = _client_utc(body.starts_at, "startsAt")
    ends_at = _client_utc(body.ends_at, "endsAt")
    _window(starts_at, ends_at, now=now, check_start=True)
    invitees = _invitees(body.invitee_emails, organizer)

    async with _room_locks[room_id]:
        await _lock_room_in_db(session, room_id)
        await _refuse_conflict(session, room_id=room_id, starts_at=starts_at, ends_at=ends_at)
        meeting = ScheduledMeeting(
            title=title,
            room_id=room_id,
            organizer_email=organizer,
            starts_at=starts_at,
            ends_at=ends_at,
            is_private=body.is_private,
            status=repo.SCHEDULED,
        )
        session.add(meeting)
        await session.flush()
        session.add(ScheduledMeetingInvitee(meeting_id=meeting.id, email=organizer, response="accepted"))
        for email in invitees:
            session.add(ScheduledMeetingInvitee(meeting_id=meeting.id, email=email, response="pending"))
        await session.commit()
    await meeting_notifications.invited(session, meeting, invitees)
    return await _full(session, meeting)


async def _as_participant(session: AsyncSession, meeting_id: str, email: str) -> ScheduledMeeting:
    """The meeting, if `email` is invited to it. A meeting you are not in does not exist to you: 404,
    so a private meeting's id reveals nothing."""
    meeting = await repo.get(session, meeting_id)
    if meeting is None or await repo.invitee(session, meeting_id, email) is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


def _require_editable(meeting: ScheduledMeeting, now: datetime) -> None:
    if meeting.status != repo.SCHEDULED:
        raise HTTPException(status_code=400, detail="Meeting is cancelled")
    if as_utc(meeting.ends_at) <= now:
        raise HTTPException(status_code=400, detail="Meeting has already ended")


async def update(
    session: AsyncSession, meeting_id: str, body: UpdateScheduledMeetingIn, email: str
) -> ScheduledMeetingOut:
    email = email.strip().lower()
    now = _now()
    meeting = await _as_participant(session, meeting_id, email)
    if meeting.organizer_email != email:
        raise HTTPException(status_code=403, detail="Only the organizer can edit this meeting")
    _require_editable(meeting, now)

    title = _title(body.title) if body.title is not None else meeting.title
    room_id = _room(body.room_id) if body.room_id is not None else meeting.room_id
    old_start = as_utc(meeting.starts_at)
    starts_at = _client_utc(body.starts_at, "startsAt") if body.starts_at is not None else old_start
    ends_at = _client_utc(body.ends_at, "endsAt") if body.ends_at is not None else as_utc(meeting.ends_at)
    # A meeting already under way may still be edited (extended, renamed) without its own start
    # counting as "in the past"; MOVING the start must land in the future like any new booking.
    _window(starts_at, ends_at, now=now, check_start=starts_at != old_start)
    invitees = _invitees(body.invitee_emails, email) if body.invitee_emails is not None else None
    before = (meeting.title, meeting.room_id, old_start, as_utc(meeting.ends_at))
    before_people = {row.email for row in (await repo.invitees_by_meeting(session, [meeting.id]))[meeting.id]}

    async with _room_locks[room_id]:
        await _lock_room_in_db(session, room_id)
        await _refuse_conflict(
            session, room_id=room_id, starts_at=starts_at, ends_at=ends_at, exclude_id=meeting.id
        )
        meeting.title = title
        meeting.room_id = room_id
        meeting.starts_at = starts_at
        meeting.ends_at = ends_at
        if body.is_private is not None:
            meeting.is_private = body.is_private
        if invitees is not None:
            current = (await repo.invitees_by_meeting(session, [meeting.id]))[meeting.id]
            keep = set(invitees) | {email}
            for row in current:
                if row.email not in keep:
                    await session.delete(row)
            existing = {row.email for row in current}
            for new_email in invitees:
                if new_email not in existing:
                    session.add(ScheduledMeetingInvitee(meeting_id=meeting.id, email=new_email, response="pending"))
        await session.commit()
    note_booking_if_live(meeting)
    # THE BELL: newcomers are invited; everybody who stays is told only when what they would act on —
    # the title, the room or the time — actually changed.
    now_people = {row.email for row in (await repo.invitees_by_meeting(session, [meeting.id]))[meeting.id]}
    await meeting_notifications.invited(session, meeting, sorted(now_people - before_people))
    if (meeting.title, meeting.room_id, as_utc(meeting.starts_at), as_utc(meeting.ends_at)) != before:
        await meeting_notifications.updated(session, meeting, sorted(now_people & before_people))
    return await _full(session, meeting)


async def cancel(session: AsyncSession, meeting_id: str, email: str) -> ScheduledMeetingOut:
    """Idempotent. The row is kept; a cancelled booking is simply ignored by every check."""
    email = email.strip().lower()
    meeting = await _as_participant(session, meeting_id, email)
    if meeting.organizer_email != email:
        raise HTTPException(status_code=403, detail="Only the organizer can cancel this meeting")
    if meeting.status != repo.CANCELLED:
        meeting.status = repo.CANCELLED
        await session.commit()
        people = (await repo.invitees_by_meeting(session, [meeting.id]))[meeting.id]
        await meeting_notifications.cancelled(session, meeting, [row.email for row in people])
    note_booking_if_live(meeting)
    return await _full(session, meeting)


async def respond(session: AsyncSession, meeting_id: str, email: str, response: str) -> ScheduledMeetingOut:
    email = email.strip().lower()
    meeting = await _as_participant(session, meeting_id, email)
    if meeting.organizer_email == email:
        raise HTTPException(status_code=400, detail="The organizer does not respond to their own meeting")
    _require_editable(meeting, _now())
    row = await repo.invitee(session, meeting_id, email)
    assert row is not None  # _as_participant proved it
    row.response = response
    await session.commit()
    return await _full(session, meeting)


async def list_mine(
    session: AsyncSession, email: str, starts_at: datetime | None, ends_at: datetime | None
) -> list[ScheduledMeetingOut]:
    frm = _client_utc(starts_at, "from") if starts_at is not None else _now()
    to = _client_utc(ends_at, "to") if ends_at is not None else None
    meetings = await repo.mine(session, email=email.strip().lower(), starts_at=frm, ends_at=to)
    by_id = await repo.invitees_by_meeting(session, [m.id for m in meetings])
    return [full_view(m, by_id[m.id]) for m in meetings]


async def availability(session: AsyncSession, starts_at: datetime, ends_at: datetime) -> list[RoomAvailabilityOut]:
    frm = _client_utc(starts_at, "startsAt")
    to = _client_utc(ends_at, "endsAt")
    if to <= frm:
        raise HTTPException(status_code=400, detail="endsAt must be after startsAt")
    booked = await repo.booked_room_ids(session, starts_at=frm, ends_at=to)
    return [
        RoomAvailabilityOut(room_id=r.id, name=r.name, capacity=r.capacity, available=r.id not in booked)
        for r in MEETING_FLOOR_ROOMS
    ]


async def floor_bookings(
    session: AsyncSession, viewer: str, starts_at: datetime | None, ends_at: datetime | None
) -> list[RoomBookingOut]:
    """Every standing booking on the floor in the window, as signage may show it. The client passes
    its own local day as `from`/`to` (it knows its timezone; the server does not guess one); the
    default is the next 24 hours, meetings already under way included."""
    frm = _client_utc(starts_at, "from") if starts_at is not None else _now()
    to = _client_utc(ends_at, "to") if ends_at is not None else frm + timedelta(hours=24)
    if to <= frm:
        raise HTTPException(status_code=400, detail="to must be after from")
    if to - frm > timedelta(days=2):
        raise HTTPException(status_code=400, detail="Window can be at most 2 days")
    viewer = viewer.strip().lower()
    meetings = await repo.standing_in_window(session, starts_at=frm, ends_at=to)
    by_id = await repo.invitees_by_meeting(session, [m.id for m in meetings])
    return [
        booking_view(m, viewer_is_invitee=any(i.email == viewer for i in by_id[m.id])) for m in meetings
    ]


# ---- who may enter a Meeting Floor room's live meeting -------------------------------------------
#
# THE GOVERNING BOOKING of a room is, in order:
#   1. while the room's meeting is LIVE, the booking it was bound to when its first participant
#      joined (None = an unbooked, ad-hoc meeting). It keeps governing past its scheduled end until
#      the session empties — an overrunning private meeting stays private, and the next booking
#      does not take over a room that is in use;
#   2. otherwise, the standing booking whose access window [starts_at - ACCESS_LEAD, ends_at)
#      contains now (the earlier one while two back-to-back windows touch).
# If the governing booking is private, only its invitees (organizer included) may enter.

# meeting registry key -> booking id the live session was bound to (None = unbooked)
_live_booking: dict[str, str | None] = {}
# booking id -> the booking's PUBLIC window facts, cached whenever `admit` resolves it, so the
# synchronous meeting_presence broadcast can say which booking a live room belongs to. Only what
# /rooms/today already shows everybody: the window and the private flag — never a title or an id.
_window_of: dict[str, dict] = {}


def _key(meeting_id: str) -> str:
    return f"{MEETING_KEY_PREFIX}{meeting_id}"


def is_meeting_floor_meeting(meeting_id: str) -> bool:
    return room_for_meeting_id(meeting_id) is not None


async def _governing(session: AsyncSession, meeting_id: str, now: datetime) -> ScheduledMeeting | None:
    room = room_for_meeting_id(meeting_id)
    if room is None:
        return None
    key = _key(room.meeting_id)
    if call_registry.participants(key) and key in _live_booking:
        bound = _live_booking[key]
        booking = await repo.get(session, bound) if bound else None
        return booking if booking is not None and booking.status == repo.SCHEDULED else None
    return await repo.governing(session, room_id=room.id, at=now, lead_from=now + ACCESS_LEAD)


async def admit(
    session: AsyncSession, meeting_id: str, email: str, *, now: datetime | None = None
) -> tuple[bool, str | None]:
    """May `email` enter this meeting now? Returns (allowed, governing booking id). Any meeting that
    is not a Meeting Floor room's is always allowed, exactly as before this feature."""
    booking = await _governing(session, meeting_id, now or _now())
    if booking is None:
        return True, None
    note_booking(booking)
    if not booking.is_private:
        return True, booking.id
    allowed = await repo.invitee(session, booking.id, email.strip().lower()) is not None
    return allowed, booking.id


async def early_booking(
    session: AsyncSession, meeting_id: str, email: str, *, now: datetime | None = None
) -> ScheduledMeeting | None:
    """The booking a session STARTED EARLY belongs to: one of `email`'s own bookings of this room that
    starts within EARLY_START (its door sign already says Upcoming). Without it, an invitee who opened
    their meeting ten minutes early bound it as ad-hoc, and their own booking then never took effect."""
    room = room_for_meeting_id(meeting_id)
    if room is None:
        return None
    now = now or _now()
    nxt = await repo.governing(session, room_id=room.id, at=now, lead_from=now + EARLY_START)
    if nxt is None or await repo.invitee(session, nxt.id, email.strip().lower()) is None:
        return None
    note_booking(nxt)
    return nxt


def bind_live(meeting_key: str, booking_id: str | None, *, fresh: bool) -> None:
    """A participant joined. The FIRST join of a session (`fresh`: the room was empty) binds it, over
    any stale binding; later joins change nothing. Synchronous, called right beside
    call_registry.join with nothing awaited between — see meeting_hosts.py on atomicity."""
    if fresh:
        _live_booking[meeting_key] = booking_id
    else:
        _live_booking.setdefault(meeting_key, booking_id)


async def live_booking(session: AsyncSession, meeting_key: str) -> ScheduledMeeting | None:
    """The standing booking a LIVE room session is bound to, or None (ad-hoc, or nothing live)."""
    booking_id = _live_booking.get(meeting_key)
    if not booking_id:
        return None
    meeting = await repo.get(session, booking_id)
    return meeting if meeting is not None and meeting.status == repo.SCHEDULED else None


async def end_live(session: AsyncSession, meeting_key: str) -> ScheduledMeeting | None:
    """THE HOST ENDED THE MEETING FOR EVERYONE. The booking the live session belongs to is complete —
    even when that is before its scheduled start (it was started early): it no longer governs the room,
    its reminder sweep skips it, and its original time never reactivates it. Returns the ended booking,
    or None for an ad-hoc session. Leaving is not ending: this is only ever called for an explicit End."""
    meeting = await live_booking(session, meeting_key)
    if meeting is None:
        return None
    meeting.status = repo.ENDED
    await session.commit()
    note_booking(meeting)
    return meeting


def release_live(meeting_key: str) -> None:
    """The session emptied. The room goes back to being governed by its schedule."""
    _live_booking.pop(meeting_key, None)


def note_booking(meeting: ScheduledMeeting) -> None:
    """Refresh the cached public window of a booking (called by `admit`, and by edits/cancels so a
    live room's presence never describes a booking as it used to be). A cancelled booking governs
    nothing, exactly as `_governing` treats it."""
    if meeting.status != repo.SCHEDULED:
        _window_of.pop(meeting.id, None)
        return
    _window_of[meeting.id] = {
        "startsAt": _iso(meeting.starts_at),
        "endsAt": _iso(meeting.ends_at),
        "isPrivate": bool(meeting.is_private),
    }


def note_booking_if_live(meeting: ScheduledMeeting) -> None:
    if meeting.id in _live_booking.values():
        note_booking(meeting)


def live_booking_wire(meeting_key: str) -> dict | None:
    """The booking a LIVE room session belongs to, as meeting_presence carries it: its public window
    facts, or None for an unbooked (ad-hoc) session or one whose booking was cancelled."""
    booking_id = _live_booking.get(meeting_key)
    return _window_of.get(booking_id) if booking_id else None


def reset_live() -> None:
    _live_booking.clear()
    _window_of.clear()
