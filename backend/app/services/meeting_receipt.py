from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_session import MeetingSession, MeetingSessionAttendance
from app.repositories import meeting_intelligence as intelligence_repo
from app.repositories import meeting_sessions as repo
from app.repositories import scheduled_meetings as booking_repo
from app.services import meeting_access
from app.services.meeting_intelligence import may_curate

# PHASE 7C — MEETING RECEIPT: the Meeting Session facts a Receipt shows beside its intelligence (identity,
# planned vs actual time, who ACTUALLY attended) and the short list of recent sessions a Receipt is opened
# from. Nothing here is new content: it is the Phase 6A session, its booking and its attendance intervals.
#
# READ = services/meeting_access.readable, FIRST, for the detail and for EVERY row of the recent list — the
# candidate query below only narrows the search; the gate decides. Unauthorized = not found. The room
# grants nothing.
#
# ATTENDANCE is the attendance intervals only. An invitation is not attendance: an invited-but-absent
# employee may read the Receipt and never appears in `attendees`.

RECENT_LIMIT = 12
_CANDIDATES = 60


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    dt = _aware(dt)
    return dt.isoformat() if dt is not None else None


def _attendees(rows: list[MeetingSessionAttendance], ended_at: datetime | None) -> list[dict]:
    """Per person: their intervals in order, first join, last leave and total time present. An interval
    still open on an ended session is closed at the session's end."""
    by_email: dict[str, list[tuple[datetime, datetime | None]]] = defaultdict(list)
    for r in rows:
        left = _aware(r.left_at) or _aware(ended_at)
        by_email[r.email].append((_aware(r.joined_at), left))
    out = []
    for email, spans in by_email.items():
        spans.sort(key=lambda s: s[0])
        lefts = [left for _, left in spans]
        present = sum(((left - joined).total_seconds() for joined, left in spans if left is not None), 0.0)
        out.append(
            {
                "email": email,
                "joinedAt": _iso(spans[0][0]),
                "leftAt": None if any(left is None for left in lefts) else _iso(max(lefts)),
                "presentMs": int(present * 1000),
                "intervals": [{"joinedAt": _iso(j), "leftAt": _iso(left)} for j, left in spans],
            }
        )
    out.sort(key=lambda a: (a["joinedAt"], a["email"]))
    return out


async def _booking(db: AsyncSession, s: MeetingSession) -> ScheduledMeeting | None:
    return await booking_repo.get(db, s.scheduled_meeting_id) if s.scheduled_meeting_id else None


async def read_session(db: AsyncSession, session_id: str, email: str) -> dict | None:
    session = await meeting_access.readable(db, session_id, email)
    if session is None:
        return None
    booking = await _booking(db, session)
    attendees = _attendees(await repo.attendance(db, session.id), session.ended_at)
    return {
        "sessionId": session.id,
        "kind": session.kind,
        "isPrivate": session.is_private,
        "roomId": session.room_id,
        # Planned facts exist only for a booking; an instant meeting has none (never invented).
        "title": booking.title if booking is not None else None,
        "planned": (
            {"startsAt": _iso(booking.starts_at), "endsAt": _iso(booking.ends_at), "organizerEmail": booking.organizer_email}
            if booking is not None
            else None
        ),
        "startedAt": _iso(session.started_at),
        "endedAt": _iso(session.ended_at),
        "endReason": session.end_reason,
        "startedBy": session.started_by_email,
        "attendees": attendees,
        "viewer": {"mayCurate": await may_curate(db, session, email)},
    }


async def recent(db: AsyncSession, email: str, *, limit: int = RECENT_LIMIT) -> list[dict]:
    """The caller's most recently ended Meeting Sessions that the gate lets them read, newest first."""
    email = repo.normalize_email(email)
    if not email:
        return []
    candidates = meeting_access.candidate_ids(email)
    rows = await db.execute(
        select(MeetingSession)
        .where(MeetingSession.id.in_(select(candidates.c.sid)), MeetingSession.ended_at.is_not(None))
        .order_by(MeetingSession.ended_at.desc(), MeetingSession.id)
        .limit(_CANDIDATES)
    )
    out = []
    for s in rows.scalars():
        if len(out) >= limit:
            break
        if await meeting_access.readable(db, s.id, email) is None:  # the gate, per row
            continue
        booking = await _booking(db, s)
        attendance = await repo.attendance(db, s.id)
        out.append(
            {
                "sessionId": s.id,
                "kind": s.kind,
                "isPrivate": s.is_private,
                "roomId": s.room_id,
                "title": booking.title if booking is not None else None,
                "startedAt": _iso(s.started_at),
                "endedAt": _iso(s.ended_at),
                "attendeeCount": len({a.email for a in attendance}),
                "hasIntelligence": await intelligence_repo.latest_succeeded(db, s.id) is not None,
            }
        )
    return out
