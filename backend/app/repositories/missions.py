from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.quest import QuestProgress
from app.services.quests.missions import CADENCES, MissionDefinition, MissionPeriod, period_for, reconcile_period
from app.services.quests.rewards import claimed_map, reward_for_mission

# READ side of Daily/Weekly Missions, self-scoped like repositories/quests.py. The one write it
# may cause is the lazy first-touch draw of a period (reconcile_period) — a read can be the first
# thing that happens to an actor in a new day/week.


def _mission_to_dict(definition: MissionDefinition, row: QuestProgress | None, claimed_at) -> dict[str, Any]:
    reward = reward_for_mission(definition)
    return {
        "reward_xp": reward.xp,
        "reward_coins": reward.coins,
        "claimed_at": claimed_at,
        "id": definition.id,
        "title": definition.title,
        "event_type": definition.event_type,
        "mode": definition.mode,
        "target": definition.target,
        "cadence": definition.cadence,
        "count": row.count if row is not None else 0,
        "completed_at": row.completed_at if row is not None else None,
    }


async def _period_block(session: AsyncSession, *, actor: str, period: MissionPeriod, now: datetime) -> dict[str, Any]:
    defs = await reconcile_period(session, actor=actor, period=period, now=now)
    stmt = select(QuestProgress).where(
        QuestProgress.actor_email == actor,
        QuestProgress.period_key == period.key,
        QuestProgress.quest_id.in_([d.id for d in defs]) if defs else False,
    )
    rows = {row.quest_id: row for row in (await session.execute(stmt)).scalars().all()}
    claimed = await claimed_map(session, actor=actor, period_keys=(period.key,))
    return {
        "cadence": period.cadence,
        "period_key": period.key,
        "starts_at": period.starts_at,
        "ends_at": period.ends_at,
        "missions": [_mission_to_dict(d, rows.get(d.id), claimed.get((d.id, period.key))) for d in defs],
    }


async def list_my_missions(
    session: AsyncSession, *, actor_email: str, now: datetime | None = None
) -> dict[str, Any]:
    """The caller's active daily and weekly missions for the periods containing `now` (server
    clock, UTC), each with progress. Assignment order is the pinned slot order."""
    actor = actor_email.strip().lower()
    now = now or datetime.now(timezone.utc)
    blocks = {c: await _period_block(session, actor=actor, period=period_for(c, now), now=now) for c in CADENCES}
    return {"server_time": now, **blocks}
