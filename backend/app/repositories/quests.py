from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.quest import QuestProgress
from app.services.quests.registry import (
    DEFAULT_PERIOD_KEY,
    QuestDefinition,
    all_definitions,
)

# READ side of Quest Foundation. Writes happen only in services/quests/engine.py. Every read here
# is scoped to one actor — there is deliberately no helper that returns another person's rows.


def _progress_to_dict(definition: QuestDefinition, row: QuestProgress | None) -> dict[str, Any]:
    return {
        "id": definition.id,
        "title": definition.title,
        "event_type": definition.event_type,
        "mode": definition.mode,
        "target": definition.target,
        "order": definition.order,
        "count": row.count if row is not None else 0,
        "completed_at": row.completed_at if row is not None else None,
    }


async def list_my_quests(session: AsyncSession, *, actor_email: str) -> list[dict[str, Any]]:
    """Every registered definition joined with this actor's progress (zero rows when they have
    none yet), in registry display order. Deterministic: order, then id."""
    actor = actor_email.strip().lower()
    stmt = select(QuestProgress).where(
        QuestProgress.actor_email == actor, QuestProgress.period_key == DEFAULT_PERIOD_KEY
    )
    rows = {row.quest_id: row for row in (await session.execute(stmt)).scalars().all()}
    return [_progress_to_dict(d, rows.get(d.id)) for d in all_definitions()]
