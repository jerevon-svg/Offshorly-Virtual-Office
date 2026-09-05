from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.quest import QuestProgress

# Shared get-or-create for quest_progress rows. Used by the foundation engine (period_key "")
# and by missions (real period keys). Lives below both so neither imports the other.


async def get_or_create_progress(
    session: AsyncSession, *, actor: str, quest_id: str, period_key: str
) -> QuestProgress:
    """Get-or-create behind UNIQUE(actor, quest, period). A concurrent creator loses the race
    cleanly inside its savepoint and re-reads the winner's row."""
    stmt = select(QuestProgress).where(
        QuestProgress.actor_email == actor,
        QuestProgress.quest_id == quest_id,
        QuestProgress.period_key == period_key,
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None:
        return row
    try:
        async with session.begin_nested():
            row = QuestProgress(actor_email=actor, quest_id=quest_id, period_key=period_key, count=0)
            session.add(row)
            await session.flush()
        return row
    except IntegrityError:
        row = (await session.execute(stmt)).scalar_one_or_none()
        if row is None:  # pragma: no cover - the unique index guarantees the winner exists
            raise
        return row
