from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_capture import CONSENT_PENDING, CaptureConsent, CaptureSession, TranscriptSegment

# PHASE 6B — plain persistence for captures, consents and transcript segments. No rules live here: WHO may
# start/stop and WHAT a segment must prove is services/meeting_capture.py's decision, WHO may read is
# services/meeting_access.py's. Nothing in this module commits; the caller owns the transaction.


def _norm(email: str) -> str:
    return email.strip().lower()


async def get(session: AsyncSession, capture_id: str) -> CaptureSession | None:
    return await session.get(CaptureSession, capture_id)


async def active_for_session(session: AsyncSession, meeting_session_id: str) -> CaptureSession | None:
    rows = await session.execute(
        select(CaptureSession)
        .where(CaptureSession.meeting_session_id == meeting_session_id, CaptureSession.stopped_at.is_(None))
        .order_by(CaptureSession.started_at.desc())
        .limit(1)
    )
    return rows.scalars().first()


async def latest_for_session(session: AsyncSession, meeting_session_id: str) -> CaptureSession | None:
    rows = await session.execute(
        select(CaptureSession)
        .where(CaptureSession.meeting_session_id == meeting_session_id)
        .order_by(CaptureSession.started_at.desc())
        .limit(1)
    )
    return rows.scalars().first()


async def for_session(session: AsyncSession, meeting_session_id: str) -> list[CaptureSession]:
    rows = await session.execute(
        select(CaptureSession)
        .where(CaptureSession.meeting_session_id == meeting_session_id)
        .order_by(CaptureSession.started_at)
    )
    return list(rows.scalars())


async def create(
    session: AsyncSession, *, meeting_session_id: str, started_by_email: str, started_at: datetime, source: str
) -> CaptureSession:
    row = CaptureSession(
        meeting_session_id=meeting_session_id,
        started_by_email=_norm(started_by_email),
        started_at=started_at,
        source=source,
    )
    session.add(row)
    await session.flush()
    return row


async def stop(session: AsyncSession, capture_id: str, *, at: datetime, reason: str) -> None:
    """Idempotent: a capture already stopped keeps its original stop."""
    await session.execute(
        update(CaptureSession)
        .where(CaptureSession.id == capture_id, CaptureSession.stopped_at.is_(None))
        .values(stopped_at=at, stop_reason=reason)
    )


async def stop_active_for_session(session: AsyncSession, meeting_session_id: str, *, at: datetime, reason: str) -> None:
    await session.execute(
        update(CaptureSession)
        .where(CaptureSession.meeting_session_id == meeting_session_id, CaptureSession.stopped_at.is_(None))
        .values(stopped_at=at, stop_reason=reason)
    )


async def stop_all_active(session: AsyncSession, *, at: datetime, reason: str) -> int:
    """Startup recovery: every capture still active belongs to a process that no longer exists."""
    result = await session.execute(
        update(CaptureSession).where(CaptureSession.stopped_at.is_(None)).values(stopped_at=at, stop_reason=reason)
    )
    return result.rowcount or 0


# ---- consent -------------------------------------------------------------------------------------


async def consent(session: AsyncSession, capture_id: str, email: str) -> CaptureConsent | None:
    rows = await session.execute(
        select(CaptureConsent).where(CaptureConsent.capture_id == capture_id, CaptureConsent.email == _norm(email))
    )
    return rows.scalars().first()


async def consents(session: AsyncSession, capture_id: str) -> list[CaptureConsent]:
    rows = await session.execute(
        select(CaptureConsent).where(CaptureConsent.capture_id == capture_id).order_by(CaptureConsent.email)
    )
    return list(rows.scalars())


async def ensure_pending(session: AsyncSession, capture_id: str, email: str) -> CaptureConsent:
    """The person's consent row for this capture, created `pending` if they have none. An existing
    decision is returned untouched — leaving and rejoining never erases it."""
    row = await consent(session, capture_id, email)
    if row is None:
        row = CaptureConsent(capture_id=capture_id, email=_norm(email), state=CONSENT_PENDING)
        session.add(row)
        await session.flush()
    return row


# ---- transcript ----------------------------------------------------------------------------------


async def add_segment(session: AsyncSession, **fields) -> TranscriptSegment:
    row = TranscriptSegment(**fields)
    session.add(row)
    await session.flush()
    return row


async def segments(session: AsyncSession, capture_ids: list[str]) -> list[TranscriptSegment]:
    if not capture_ids:
        return []
    rows = await session.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.capture_id.in_(capture_ids))
        .order_by(TranscriptSegment.capture_id, TranscriptSegment.start_offset_ms, TranscriptSegment.created_at)
    )
    return list(rows.scalars())
