from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from app import database as app_db
from app.models.base import generate_uuid
from app.models.meeting_session import (
    END_EMPTIED,
    END_ENDED,
    END_SERVER_RESTART,
    GRANT_INVITED,
    GRANT_INVITEE,
    GRANT_ORGANIZER,
    KIND_INSTANT,
    KIND_SCHEDULED,
)
from app.repositories import meeting_sessions as repo
from app.repositories import scheduled_meetings as booking_repo
from app.services.call_registry import MEETING_KEY_PREFIX
from app.services.meeting_floor_rooms import room_for_meeting_id

# PHASE 6A — THE MEETING SESSION LIFECYCLE, layered ABOVE the live call and never instead of it.
#
# call_registry / meeting_hosts / scheduled_meetings._live_booking are untouched and still decide who is
# connected, who hosts and which booking governs. This module watches the same edges socket.py already
# has — a person's first connection to a meeting key, their last disconnection from it, End Meeting — and
# turns them into one durable MeetingSession per occurrence, with attendance intervals and grants.
#
# THE SEAM, and why it is split in two. socket.py's call_joined makes join + ensure_host + bind_live one
# synchronous step (see meeting_hosts.py on atomicity). `reserve` joins that step: it is synchronous, so the
# decision "is this a NEW occurrence or the one already live?" is made against exactly the registry state
# the join produced, and two people pressing Start together get ONE session id. The DB writes that follow
# (`record_join`, …) are awaited afterwards, serialized per meeting key by a lock, so a session row is
# always written before any attendance row that points at it — whatever order the handlers resume in.
#
# RECONNECT GRACE. When the last participant drops, the live meeting ends at once (host released, chat
# cleared — unchanged). The SESSION waits RECONNECT_GRACE_S before closing: a lone host whose socket blips
# and re-registers comes back to the same session instead of splitting one meeting into two records. A
# rejoin in the grace window reuses the session only when it binds the same booking (or is still ad-hoc);
# anything else is a different occurrence and gets a new id. End Meeting closes immediately, no grace.
#
# NEVER BREAKS REALTIME. Every DB write here swallows and logs its failure, the same posture as socket.py's
# _record_arrival: bookkeeping must not refuse a join or drop a leave. A session that failed to persist is
# simply not exposed (session_id_for returns None) and grants nothing.
#
# ASSUMPTION: the same single-worker, in-memory caveat as call_registry.py. A restart loses the live map;
# close_orphans (run at startup) closes whatever the dead process left open.

_logger = logging.getLogger(__name__)

RECONNECT_GRACE_S = 30.0


@dataclass
class LiveSession:
    session_id: str
    meeting_id: str
    booking_id: str | None
    started_by: str
    started_at: datetime
    is_private: bool = False
    persisted: bool = False
    # the booking's organizer + invitees, as loaded when the session went live (and refreshed on edits)
    invitees: set[str] = field(default_factory=set)
    # employees a participant explicitly invited into this occurrence
    invited: set[str] = field(default_factory=set)
    # set when the last participant left; cleared if somebody comes back inside the grace
    emptied_at: datetime | None = None
    close_task: asyncio.Task | None = None


# meeting registry key ("meeting:<id>") -> the occurrence currently live under it
_live: dict[str, LiveSession] = {}
_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def _norm(email: str) -> str:
    return email.strip().lower()


def _cancel_close(live: LiveSession) -> None:
    if live.close_task is not None and not live.close_task.done():
        live.close_task.cancel()
    live.close_task = None


# ---- the synchronous half: called inside socket.py's atomic join step -----------------------------------


def reserve(key: str, email: str, booking_id: str | None, *, now: datetime) -> tuple[LiveSession, bool]:
    """The occurrence this join belongs to, and whether it is NEW. No `await`: see the header."""
    live = _live.get(key)
    if live is not None and live.emptied_at is not None:
        if live.booking_id == booking_id:
            # Back inside the grace, same booking (or still ad-hoc): the same meeting continues.
            _cancel_close(live)
            live.emptied_at = None
            return live, False
        # A different occurrence took the room: the emptied one ended when it emptied.
        _live.pop(key, None)
        _cancel_close(live)
        asyncio.create_task(_close(key, live, END_EMPTIED, live.emptied_at))
        live = None
    if live is None:
        live = LiveSession(
            session_id=generate_uuid(),
            meeting_id=key[len(MEETING_KEY_PREFIX):],
            booking_id=booking_id,
            started_by=_norm(email),
            started_at=now,
        )
        _live[key] = live
        return live, True
    return live, False


# ---- the awaited half ----------------------------------------------------------------------------------


async def record_join(key: str, live: LiveSession, *, created: bool, email: str, joined: bool, now: datetime) -> None:
    """Persist a new session (with its booking's grants) and/or open this person's attendance interval.
    `joined` is the registry's own "this EMAIL just became present" — a second tab is not a new interval."""
    async with _locks[key]:
        try:
            async with app_db.async_session_maker() as db:
                if created:
                    booking = await booking_repo.get(db, live.booking_id) if live.booking_id else None
                    live.is_private = bool(booking is not None and booking.is_private)
                    room = room_for_meeting_id(live.meeting_id)
                    await repo.create(
                        db,
                        session_id=live.session_id,
                        meeting_key=live.meeting_id,
                        room_id=room.id if room else None,
                        scheduled_meeting_id=booking.id if booking else None,
                        kind=KIND_SCHEDULED if booking else KIND_INSTANT,
                        is_private=live.is_private,
                        started_by_email=live.started_by,
                        started_at=live.started_at,
                    )
                    if booking is not None:
                        await _snapshot_booking(db, live, booking)
                    live.persisted = True
                if joined and live.persisted:
                    await repo.open_attendance(db, live.session_id, email, at=now)
                await db.commit()
        except Exception:  # noqa: BLE001 — never let bookkeeping break a join
            if created:
                live.persisted = False
            _logger.warning("meeting session: failed to record join for %s", key, exc_info=True)


async def _snapshot_booking(db, live: LiveSession, booking) -> None:
    """The booking's organizer and invitees become durable grants on THIS occurrence, so a later edit to
    the booking cannot quietly remove somebody who was invited when the meeting happened."""
    rows = (await booking_repo.invitees_by_meeting(db, [booking.id]))[booking.id]
    organizer = _norm(booking.organizer_email)
    people = {organizer} | {_norm(r.email) for r in rows}
    live.invitees = people
    await repo.add_grant(db, live.session_id, organizer, reason=GRANT_ORGANIZER)
    for email in sorted(people - {organizer}):
        await repo.add_grant(db, live.session_id, email, reason=GRANT_INVITEE)


async def record_leave(key: str, email: str, *, emptied: bool, now: datetime) -> None:
    """This EMAIL stopped being present (its last tab left). `emptied`: nobody is left at all."""
    live = _live.get(key)
    if live is None:
        return
    if emptied:
        # Synchronous, before the first await, so a rejoin that races this call still sees the grace.
        live.emptied_at = now
        _cancel_close(live)
        live.close_task = asyncio.create_task(_close_after_grace(key, live))
    if not live.persisted:
        return
    async with _locks[key]:
        try:
            async with app_db.async_session_maker() as db:
                await repo.close_attendance(db, live.session_id, email, at=now)
                await db.commit()
        except Exception:  # noqa: BLE001
            _logger.warning("meeting session: failed to record leave for %s", key, exc_info=True)


async def _close_after_grace(key: str, live: LiveSession) -> None:
    await asyncio.sleep(RECONNECT_GRACE_S)
    if _live.get(key) is not live or live.emptied_at is None:
        return
    _live.pop(key, None)
    live.close_task = None
    await _close(key, live, END_EMPTIED, live.emptied_at)


async def _close(key: str, live: LiveSession, reason: str, at: datetime) -> None:
    if not live.persisted:
        return
    async with _locks[key]:
        try:
            async with app_db.async_session_maker() as db:
                await repo.close(db, live.session_id, at=at, reason=reason)
                await db.commit()
        except Exception:  # noqa: BLE001
            _logger.warning("meeting session: failed to close %s", live.session_id, exc_info=True)


async def end(key: str, *, now: datetime) -> str | None:
    """END MEETING. Closes the live occurrence at once (no grace) and every attendance interval in it —
    anyone still connected when they get `meeting_ended` has, as far as the record goes, left. Anybody
    who joins the key afterwards starts a NEW session. Returns the closed session id, or None."""
    live = _live.pop(key, None)
    if live is None:
        return None
    _cancel_close(live)
    await _close(key, live, END_ENDED, now)
    return live.session_id


async def grant_invited(key: str, *, inviter: str, to_email: str, participants: list[str]) -> None:
    """A PARTICIPANT explicitly invited somebody into this occurrence. The invitation itself only lives in
    memory (call_invites.py) and vanishes when it resolves; this grant is what outlasts it. An invitation
    from somebody who is not in the meeting grants nothing."""
    live = _live.get(key)
    inviter = _norm(inviter)
    if live is None or live.emptied_at is not None or inviter not in {_norm(p) for p in participants}:
        return
    to_email = _norm(to_email)
    live.invited.add(to_email)
    if not live.persisted:
        return
    async with _locks[key]:
        try:
            async with app_db.async_session_maker() as db:
                await repo.add_grant(db, live.session_id, to_email, reason=GRANT_INVITED)
                await db.commit()
        except Exception:  # noqa: BLE001
            _logger.warning("meeting session: failed to grant invitation on %s", key, exc_info=True)


async def refresh_booking(booking_id: str) -> None:
    """The organizer edited a booking whose occurrence is LIVE. Newly added invitees are granted on it and
    may see its private presence; the grants of anybody removed are kept (they were invited when the
    meeting happened), but the live presence list follows the booking as it now stands."""
    for key, live in list(_live.items()):
        if live.booking_id != booking_id or not live.persisted:
            continue
        async with _locks[key]:
            try:
                async with app_db.async_session_maker() as db:
                    booking = await booking_repo.get(db, booking_id)
                    if booking is not None:
                        await _snapshot_booking(db, live, booking)
                        await db.commit()
            except Exception:  # noqa: BLE001
                _logger.warning("meeting session: failed to refresh booking on %s", key, exc_info=True)


async def close_orphans(*, now: datetime) -> int:
    """STARTUP ONLY. The live map is empty in a fresh process, so every session still open in the database
    was left by a process that no longer exists: close it (and its open attendance) as a server restart.
    The recorded end is this startup time — an upper bound, since the crash itself left no timestamp."""
    async with app_db.async_session_maker() as db:
        count = await repo.close_all_open(db, at=now, reason=END_SERVER_RESTART)
        await db.commit()
    return count


# ---- read-only views of the live map, for presence (synchronous) ----------------------------------------


def session_id_for(key: str) -> str | None:
    """The live occurrence's durable id, once it is persisted — for PARTICIPANTS only (socket.py decides)."""
    live = _live.get(key)
    return live.session_id if live is not None and live.persisted and live.emptied_at is None else None


def is_private(key: str) -> bool:
    live = _live.get(key)
    return bool(live is not None and live.is_private)


def may_see_live(key: str, viewer: str, participants: list[str]) -> bool:
    """May `viewer` see who is in, and who hosts, this key's live meeting? Participants always; otherwise
    only people the occurrence itself authorizes (organizer, invitees, explicitly invited, its starter).
    Fails closed: no live record means participants only. Never consults the room."""
    viewer = _norm(viewer)
    if viewer in {_norm(p) for p in participants}:
        return True
    live = _live.get(key)
    if live is None:
        return False
    return viewer == live.started_by or viewer in live.invitees or viewer in live.invited


def reset() -> None:
    """Test-only: module-level live state would otherwise leak between tests (and between event loops)."""
    for live in _live.values():
        _cancel_close(live)
    _live.clear()
    _locks.clear()
