from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_intelligence import (
    ITEM_COMMITMENT,
    ITEM_DECISION,
    ITEM_OPEN_LOOP,
    REVIEW_REJECTED,
    REVIEW_SUGGESTED,
    RUN_SUCCEEDED,
    MeetingIntelligenceItem,
    MeetingIntelligenceRun,
)
from app.models.meeting_session import MeetingSession, MeetingSessionAttendance
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.repositories import meeting_sessions as repo
from app.services import meeting_access
from app.services.meeting_intelligence import current_transcript, effective_content, fingerprint
from app.services.meeting_receipt import _aware, _iso

# PHASE 8C — MEETING CONTINUITY: the Meeting Sessions RELATED to one Receipt's session that the caller may
# read, in order, each with a compact view of its effective intelligence. It is a doorway between existing
# Receipts, not a new memory: nothing is generated, compared by AI or stored.
#
# WHAT "RELATED" MEANS — deterministic, persisted, and PAIRWISE WITH THE CURRENT SESSION (never a chain, so
# a hidden session can never be the link that joins two visible ones):
#   * same_booking — another occurrence of the very same booking (the meeting was restarted in its window);
#   * same_series  — another SCHEDULED occurrence whose booking title is the same once case and whitespace
#                    are normalized AND whose booking roster (organizer + invitees) overlaps this one's
#                    meaningfully: at least 2 people in common and a Jaccard overlap of at least 1/2.
# The schema has no recurrence/series identity, so this is the conservative stand-in. What NEVER relates two
# meetings: the room, a loosely similar title, the same organizer alone, or anything an AI thinks. An
# instant meeting has no booking and therefore no continuity. Missing a relationship is the safe failure.
#
# ORDER OF OPERATIONS — the gate first, per session, before any content:
#   1. meeting_access.readable(current) — unreadable = not found, exactly like the Receipt;
#   2. SQL candidates only inside meeting_access.candidate_ids(caller) with the same booking or the same
#      normalized title (reveals nothing, returns nothing);
#   3. meeting_access.readable per candidate — a refused one is dropped and never mentioned;
#   4. only then the roster check, and only for the survivors the intelligence/attendance loads.
# So an inaccessible session between two accessible ones leaves no gap, count, title, date or name behind.
#
# WHAT A TIMELINE MAY CLAIM. Each event shows its OWN active intelligence (effective content: edited → the
# human's wording; rejected left out; suggested stays marked). Between adjacent visible events the only
# transition asserted is "raised again": an open loop whose effective text, normalized, is the same as an
# open loop of the previous visible event. Nothing is ever called resolved, superseded, changed or
# completed — the contract has no field that could establish it, so chronology is shown instead.

NEIGHBOURS = 3  # at most this many related sessions each side of the current one
_CANDIDATES = 120
_PREVIEW = 3
_LINE_CHARS = 160
MIN_SHARED = 2
MIN_JACCARD = 0.5
_TYPES = {ITEM_DECISION: "decisions", ITEM_COMMITMENT: "commitments", ITEM_OPEN_LOOP: "openLoops"}


def _normalized(title: str | None) -> str:
    return " ".join((title or "").split()).casefold()


def _clip(text: str | None) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= _LINE_CHARS else text[: _LINE_CHARS - 1].rstrip() + "…"


def _roster_overlaps(a: set[str], b: set[str]) -> bool:
    shared = len(a & b)
    return shared >= MIN_SHARED and shared / len(a | b) >= MIN_JACCARD


async def _rosters(db: AsyncSession, booking_ids: list[str]) -> dict[str, set[str]]:
    """Booking → organizer + invitees, lower-cased. Only ever called for bookings of approved sessions."""
    out: dict[str, set[str]] = defaultdict(set)
    if not booking_ids:
        return out
    rows = await db.execute(
        select(ScheduledMeeting.id, ScheduledMeeting.organizer_email).where(ScheduledMeeting.id.in_(booking_ids))
    )
    for bid, org in rows.all():
        out[bid].add(org.strip().lower())
    rows = await db.execute(
        select(ScheduledMeetingInvitee.meeting_id, ScheduledMeetingInvitee.email).where(
            ScheduledMeetingInvitee.meeting_id.in_(booking_ids)
        )
    )
    for bid, who in rows.all():
        out[bid].add(who.strip().lower())
    return out


async def _related(db: AsyncSession, current: MeetingSession, booking: ScheduledMeeting, email: str) -> dict[str, str]:
    """Approved related session id → relation. Steps 2–4 of the order above."""
    candidates = meeting_access.candidate_ids(email)
    title = _normalized(booking.title)
    rows = await db.execute(
        select(MeetingSession.id, MeetingSession.scheduled_meeting_id, ScheduledMeeting.title)
        .join(ScheduledMeeting, ScheduledMeeting.id == MeetingSession.scheduled_meeting_id)
        .where(
            MeetingSession.id.in_(select(candidates.c.sid)),
            MeetingSession.id != current.id,
            MeetingSession.ended_at.is_not(None),
            (MeetingSession.scheduled_meeting_id == booking.id)
            # a loose SQL prefilter (spaces removed); the exact normalized comparison is below
            | (func.lower(func.replace(ScheduledMeeting.title, " ", "")) == "".join(title.split())),
        )
        .order_by(MeetingSession.started_at.desc())
        .limit(_CANDIDATES)
    )
    approved: list[tuple[str, str]] = []
    for sid, bid, t in rows.all():
        if bid != booking.id and _normalized(t) != title:
            continue
        if await meeting_access.readable(db, sid, email) is None:  # THE GATE, per candidate
            continue
        approved.append((sid, bid))
    rosters = await _rosters(db, sorted({bid for _, bid in approved} | {booking.id}))
    mine = rosters.get(booking.id, set())
    out: dict[str, str] = {}
    for sid, bid in approved:
        if bid == booking.id:
            out[sid] = "same_booking"
        elif _roster_overlaps(mine, rosters.get(bid, set())):
            out[sid] = "same_series"
    return out


def _state(run: MeetingIntelligenceRun, items: list[MeetingIntelligenceItem], stale: bool) -> dict:
    active = [i for i in items if i.review_state != REVIEW_REJECTED]
    out: dict = {"runVersion": run.version, "stale": stale, "counts": {}}
    for item_type, key in _TYPES.items():
        of_type = [i for i in active if i.item_type == item_type]
        out["counts"][key] = len(of_type)
        out["counts"][f"{key}Reviewed"] = sum(1 for i in of_type if i.review_state != REVIEW_SUGGESTED)
        rows = []
        for i in of_type[:_PREVIEW]:
            content = effective_content(i)
            row = {"itemId": i.id, "text": _clip(content.get("text")), "reviewState": i.review_state}
            if item_type == ITEM_OPEN_LOOP:
                row["kind"] = content.get("kind")
            if item_type == ITEM_COMMITMENT:
                row["ownerEmail"] = content.get("ownerEmail")
            rows.append(row)
        out[key] = rows
    # every active open loop's normalized text, for "raised again" (not sent to the client)
    out["_openKeys"] = {
        _normalized(effective_content(i).get("text")): i for i in active if i.item_type == ITEM_OPEN_LOOP
    }
    return out


async def continuity(db: AsyncSession, session_id: str, email: str) -> dict | None:
    """The caller's timeline around one session: `events` oldest first, exactly one `isCurrent`. None when
    the caller may not read the session (the same not-found as the Receipt)."""
    email = repo.normalize_email(email or "")
    current = await meeting_access.readable(db, session_id, email)
    if current is None:
        return None
    booking = await db.get(ScheduledMeeting, current.scheduled_meeting_id) if current.scheduled_meeting_id else None
    relations = await _related(db, current, booking, email) if booking is not None else {}

    rows = await db.execute(select(MeetingSession).where(MeetingSession.id.in_([current.id, *relations])))
    sessions = sorted(rows.scalars(), key=lambda s: (_aware(s.started_at), s.id))
    at = next(n for n, s in enumerate(sessions) if s.id == current.id)
    sessions = sessions[max(0, at - NEIGHBOURS) : at + NEIGHBOURS + 1]
    ids = [s.id for s in sessions]

    # Content, for approved ids only.
    titles = {}
    booking_ids = [s.scheduled_meeting_id for s in sessions if s.scheduled_meeting_id]
    if booking_ids:
        res = await db.execute(select(ScheduledMeeting.id, ScheduledMeeting.title).where(ScheduledMeeting.id.in_(booking_ids)))
        titles = dict(res.all())
    res = await db.execute(
        select(MeetingSessionAttendance.session_id).where(
            MeetingSessionAttendance.session_id.in_(ids), MeetingSessionAttendance.email == email
        )
    )
    attended = {r[0] for r in res.all()}
    latest: dict[str, MeetingIntelligenceRun] = {}
    res = await db.execute(
        select(MeetingIntelligenceRun)
        .where(MeetingIntelligenceRun.meeting_session_id.in_(ids), MeetingIntelligenceRun.status == RUN_SUCCEEDED)
        .order_by(MeetingIntelligenceRun.version.desc())
    )
    for run in res.scalars():
        latest.setdefault(run.meeting_session_id, run)
    items: dict[str, list[MeetingIntelligenceItem]] = defaultdict(list)
    if latest:
        res = await db.execute(
            select(MeetingIntelligenceItem)
            .where(MeetingIntelligenceItem.run_id.in_([r.id for r in latest.values()]))
            .order_by(MeetingIntelligenceItem.position)
        )
        for it in res.scalars():
            items[it.run_id].append(it)

    events, previous = [], None
    for s in sessions:
        run = latest.get(s.id)
        state = None
        if run is not None:
            stale = fingerprint(await current_transcript(db, s.id)) != run.source_fingerprint
            state = _state(run, items.get(run.id, []), stale)
        change = None
        if state is not None and previous is not None and previous.get("intelligence") is not None:
            before = previous["intelligence"]["_openKeys"]
            again = [
                {"itemId": i.id, "text": _clip(effective_content(i).get("text")), "sinceSessionId": previous["sessionId"]}
                for key, i in state["_openKeys"].items()
                if key and key in before
            ]
            change = {"sinceSessionId": previous["sessionId"], "raisedAgain": again}
        event = {
            "sessionId": s.id,
            "isCurrent": s.id == current.id,
            "relation": None if s.id == current.id else relations[s.id],
            "title": titles.get(s.scheduled_meeting_id) if s.scheduled_meeting_id else None,
            "kind": s.kind,
            "isPrivate": s.is_private,
            "roomId": s.room_id,
            "startedAt": _iso(s.started_at),
            "endedAt": _iso(s.ended_at),
            "viewer": {"attended": s.id in attended},
            "intelligence": state,
            "change": change,
        }
        events.append(event)
        previous = event
    for e in events:
        if e["intelligence"] is not None:
            e["intelligence"].pop("_openKeys", None)
    return {"sessionId": current.id, "events": events}
