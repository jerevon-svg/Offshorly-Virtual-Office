from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_session import MeetingSession
from app.repositories import meeting_sessions as repo
from app.repositories import scheduled_meetings as booking_repo

# PHASE 6A — THE ONE GATE for anything that belongs to a Meeting Session.
#
# Every future reader of meeting content — transcript REST reads, recording metadata, Meeting Memory, a
# Meeting Twin, and above all AI retrieval — must come through `can_read` / `readable` BEFORE it loads any
# of that content. That ordering is the rule: an AI prompt is assembled only from sessions this function
# already approved for this caller, never from whatever a query returned with the UI left to hide it.
#
# WHO IS AUTHORIZED (the initial, participants-only policy — the same for normal and private meetings):
#   * whoever started the occurrence (the instant meeting's host at activation);
#   * the booking's organizer and invitees — snapshotted as grants when the meeting went live, and also
#     the booking's CURRENT invitee list, so somebody added before the meeting's window closes is included;
#   * anybody a participant explicitly invited into the occurrence (a grant — the invitation was memory-only);
#   * anybody who actually attended, for any interval.
# Being invited and attending are separate facts: an invitee who never joined is authorized.
#
# WHAT NEVER GRANTS ACCESS: the room. `room_id` and `meeting_key` are not read here at all, so standing
# in Foxtrot — or having hosted a different meeting there — opens nothing. Team / Project / Company
# sharing does not exist yet; when it does, it is added HERE and nowhere else.
#
# FAILS CLOSED: an unknown id, a blank email, or any error answers False.

_logger = logging.getLogger(__name__)


async def can_read(session: AsyncSession, session_id: str, email: str) -> bool:
    return await readable(session, session_id, email) is not None


async def readable(session: AsyncSession, session_id: str, email: str) -> MeetingSession | None:
    """The Meeting Session, only if `email` may read it; otherwise None — exactly as if it did not exist,
    so an id reveals nothing to somebody who is not authorized for it."""
    session_id = (session_id or "").strip()
    email = (email or "").strip().lower()
    if not session_id or not email:
        return None
    try:
        row = await repo.get(session, session_id)
        if row is None:
            return None
        if row.started_by_email == email:
            return row
        if await repo.has_grant(session, row.id, email):
            return row
        if await repo.attended(session, row.id, email):
            return row
        if row.scheduled_meeting_id:
            booking = await booking_repo.get(session, row.scheduled_meeting_id)
            if booking is not None and (
                booking.organizer_email.strip().lower() == email
                or await booking_repo.invitee(session, booking.id, email) is not None
            ):
                return row
        return None
    except Exception:  # noqa: BLE001 — an error is a denial, never an accidental grant
        _logger.warning("meeting_access: check failed for session %s", session_id, exc_info=True)
        return None
