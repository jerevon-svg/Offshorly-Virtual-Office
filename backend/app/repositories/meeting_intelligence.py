from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_capture import CaptureSession, TranscriptSegment
from app.models.meeting_intelligence import (
    RUN_FAILED,
    RUN_RUNNING,
    RUN_SUCCEEDED,
    MeetingIntelligenceEvidence,
    MeetingIntelligenceItem,
    MeetingIntelligenceRun,
)

# PHASE 7A — plain persistence for Meeting Intelligence. No rules live here: WHO may generate/review and
# WHAT a draft must prove is services/meeting_intelligence.py's decision, WHO may read is
# services/meeting_access.py's. Nothing in this module commits; the caller owns the transaction.


async def next_version(session: AsyncSession, meeting_session_id: str) -> int:
    row = await session.execute(
        select(func.max(MeetingIntelligenceRun.version)).where(
            MeetingIntelligenceRun.meeting_session_id == meeting_session_id
        )
    )
    return (row.scalar() or 0) + 1


async def get_run(session: AsyncSession, meeting_session_id: str, run_id: str) -> MeetingIntelligenceRun | None:
    """A run, only when it belongs to `meeting_session_id` — a run id from another meeting finds nothing."""
    rows = await session.execute(
        select(MeetingIntelligenceRun).where(
            MeetingIntelligenceRun.id == run_id, MeetingIntelligenceRun.meeting_session_id == meeting_session_id
        )
    )
    return rows.scalars().first()


async def runs(session: AsyncSession, meeting_session_id: str) -> list[MeetingIntelligenceRun]:
    rows = await session.execute(
        select(MeetingIntelligenceRun)
        .where(MeetingIntelligenceRun.meeting_session_id == meeting_session_id)
        .order_by(MeetingIntelligenceRun.version.desc())
    )
    return list(rows.scalars())


async def latest_succeeded(session: AsyncSession, meeting_session_id: str) -> MeetingIntelligenceRun | None:
    """THE latest intelligence: the succeeded run with the highest version. Failed/running never count."""
    rows = await session.execute(
        select(MeetingIntelligenceRun)
        .where(
            MeetingIntelligenceRun.meeting_session_id == meeting_session_id,
            MeetingIntelligenceRun.status == RUN_SUCCEEDED,
        )
        .order_by(MeetingIntelligenceRun.version.desc())
        .limit(1)
    )
    return rows.scalars().first()


async def fail_all_running(session: AsyncSession, *, at: datetime, reason: str) -> int:
    """Startup recovery: a run still `running` belongs to a process that no longer exists."""
    result = await session.execute(
        update(MeetingIntelligenceRun)
        .where(MeetingIntelligenceRun.status == RUN_RUNNING)
        .values(status=RUN_FAILED, failure_reason=reason, completed_at=at)
    )
    return result.rowcount or 0


async def items(session: AsyncSession, run_id: str) -> list[MeetingIntelligenceItem]:
    rows = await session.execute(
        select(MeetingIntelligenceItem)
        .where(MeetingIntelligenceItem.run_id == run_id)
        .order_by(MeetingIntelligenceItem.position)
    )
    return list(rows.scalars())


async def item_in_session(
    session: AsyncSession, meeting_session_id: str, item_id: str
) -> tuple[MeetingIntelligenceItem, MeetingIntelligenceRun] | None:
    """An item with its run, only when the run belongs to `meeting_session_id`."""
    rows = await session.execute(
        select(MeetingIntelligenceItem, MeetingIntelligenceRun)
        .join(MeetingIntelligenceRun, MeetingIntelligenceRun.id == MeetingIntelligenceItem.run_id)
        .where(
            MeetingIntelligenceItem.id == item_id, MeetingIntelligenceRun.meeting_session_id == meeting_session_id
        )
    )
    row = rows.first()
    return (row[0], row[1]) if row is not None else None


async def evidence_with_segments(
    session: AsyncSession, item_ids: list[str]
) -> list[tuple[MeetingIntelligenceEvidence, TranscriptSegment]]:
    if not item_ids:
        return []
    rows = await session.execute(
        select(MeetingIntelligenceEvidence, TranscriptSegment)
        .join(TranscriptSegment, TranscriptSegment.id == MeetingIntelligenceEvidence.segment_id)
        .where(MeetingIntelligenceEvidence.item_id.in_(item_ids))
        .order_by(MeetingIntelligenceEvidence.item_id, MeetingIntelligenceEvidence.position)
    )
    return [(r[0], r[1]) for r in rows.all()]


async def segment_session_ids(session: AsyncSession, segment_ids: list[str]) -> dict[str, str]:
    """segment id → the Meeting Session its capture belongs to, for the ids that exist."""
    if not segment_ids:
        return {}
    rows = await session.execute(
        select(TranscriptSegment.id, CaptureSession.meeting_session_id)
        .join(CaptureSession, CaptureSession.id == TranscriptSegment.capture_id)
        .where(TranscriptSegment.id.in_(segment_ids))
    )
    return {r[0]: r[1] for r in rows.all()}
