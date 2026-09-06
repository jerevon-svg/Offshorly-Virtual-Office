from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.quest import QuestProgress
from app.models.reward import RewardGrant
from app.services.quests.missions import CADENCE_DAILY, CADENCE_WEEKLY, MissionDefinition, get_mission
from app.services.quests.registry import DEFAULT_PERIOD_KEY, MODE_UNIQUE_COUNT, QuestDefinition, get_definition

# Progression & Rewards V1.
#
# REWARD MODEL (server-side, by kind — no per-definition tuning yet): a permanent onboarding quest
# pays more than a mission, a unique-count quest (several distinct coworkers) pays more than a
# once quest, a weekly mission pays more than a daily. Amounts are pinned into reward_grants at
# claim time; editing this table only affects future claims.
#
# LEVEL is a pure function of lifetime XP: level L (L >= 2) starts at 50 * (L-1) * L XP, i.e.
# 100 / 300 / 600 / 1000 / 1500 ... — a gentle quadratic so early levels come quickly.
#
# CLAIM is one conditional INSERT into reward_grants behind UNIQUE(actor, quest_id, period_key).
# Nothing here mutates quest_progress; "claimed" is the existence of the grant.

SOURCE_QUEST = "quest"
SOURCE_MISSION = "mission"


@dataclass(frozen=True)
class Reward:
    xp: int
    coins: int


REWARD_QUEST_ONCE = Reward(xp=50, coins=10)
REWARD_QUEST_UNIQUE = Reward(xp=100, coins=25)
REWARD_MISSION_DAILY = Reward(xp=20, coins=5)
REWARD_MISSION_WEEKLY = Reward(xp=60, coins=15)


def reward_for_quest(definition: QuestDefinition) -> Reward:
    return REWARD_QUEST_UNIQUE if definition.mode == MODE_UNIQUE_COUNT else REWARD_QUEST_ONCE


def reward_for_mission(definition: MissionDefinition) -> Reward:
    return REWARD_MISSION_WEEKLY if definition.cadence == CADENCE_WEEKLY else REWARD_MISSION_DAILY


def level_start_xp(level: int) -> int:
    return 0 if level <= 1 else 50 * (level - 1) * level


@dataclass(frozen=True)
class Progression:
    xp: int
    coins: int
    level: int
    level_start_xp: int  # lifetime XP where the current level began
    next_level_xp: int  # lifetime XP where the next level begins


def progression_for(xp: int, coins: int) -> Progression:
    level = 1
    while xp >= level_start_xp(level + 1):
        level += 1
    return Progression(xp=xp, coins=coins, level=level, level_start_xp=level_start_xp(level), next_level_xp=level_start_xp(level + 1))


@dataclass(frozen=True)
class ClaimTarget:
    source: str
    quest_id: str
    period_key: str
    reward: Reward


def resolve_claim_target(quest_id: str, period_key: str) -> ClaimTarget | None:
    """Map (quest_id, period_key) to a claimable definition, or None when the pair names nothing
    real: permanent quests only with the empty period key, missions only with a period key whose
    prefix matches their cadence."""
    if period_key == DEFAULT_PERIOD_KEY:
        q = get_definition(quest_id)
        return ClaimTarget(SOURCE_QUEST, q.id, DEFAULT_PERIOD_KEY, reward_for_quest(q)) if q else None
    m = get_mission(quest_id)
    if m is None:
        return None
    prefix = "d:" if m.cadence == CADENCE_DAILY else "w:"
    if not period_key.startswith(prefix) or len(period_key) > 32:
        return None
    return ClaimTarget(SOURCE_MISSION, m.id, period_key, reward_for_mission(m))


class NotCompleted(Exception):
    """The actor has no completed progress row for this target."""


@dataclass(frozen=True)
class ClaimResult:
    granted_now: bool  # False = already claimed earlier (idempotent replay)
    grant: RewardGrant


async def claim(session: AsyncSession, *, actor: str, target: ClaimTarget, now: datetime | None = None) -> ClaimResult:
    """Grant `target`'s reward to `actor` exactly once. Raises NotCompleted when the progress row
    is missing or not completed. Safe under concurrency: the unique index arbitrates, and the
    loser re-reads the winner's grant. MUST be the only write in the caller's transaction (the
    loser path rolls the session back to get a fresh snapshot)."""
    stmt = select(QuestProgress).where(
        QuestProgress.actor_email == actor,
        QuestProgress.quest_id == target.quest_id,
        QuestProgress.period_key == target.period_key,
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None or row.completed_at is None:
        raise NotCompleted()

    existing = await _grant(session, actor=actor, target=target)
    if existing is not None:
        return ClaimResult(granted_now=False, grant=existing)
    grant = RewardGrant(
        actor_email=actor,
        source=target.source,
        quest_id=target.quest_id,
        period_key=target.period_key,
        xp=target.reward.xp,
        coins=target.reward.coins,
        granted_at=now or datetime.now(timezone.utc),
    )
    try:
        async with session.begin_nested():
            session.add(grant)
            await session.flush()
        return ClaimResult(granted_now=True, grant=grant)
    except (IntegrityError, OperationalError):
        # Lost the race to a concurrent claim (other tab, double-click): UNIQUE collision on
        # Postgres, or SQLite WAL's "database is locked" when our read snapshot predates the
        # winner's commit. End this transaction and re-read on a fresh snapshot. Safe because
        # claim() is the only write in its request; if there is still no grant, it was a real
        # error and it propagates.
        await session.rollback()
        existing = await _grant(session, actor=actor, target=target)
        if existing is None:  # pragma: no cover - the unique index guarantees the winner exists
            raise
        return ClaimResult(granted_now=False, grant=existing)


async def _grant(session: AsyncSession, *, actor: str, target: ClaimTarget) -> RewardGrant | None:
    stmt = select(RewardGrant).where(
        RewardGrant.actor_email == actor,
        RewardGrant.quest_id == target.quest_id,
        RewardGrant.period_key == target.period_key,
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def load_progression(session: AsyncSession, *, actor: str) -> Progression:
    stmt = select(func.coalesce(func.sum(RewardGrant.xp), 0), func.coalesce(func.sum(RewardGrant.coins), 0)).where(
        RewardGrant.actor_email == actor
    )
    xp, coins = (await session.execute(stmt)).one()
    return progression_for(int(xp), int(coins))


async def claimed_map(session: AsyncSession, *, actor: str, period_keys: tuple[str, ...]) -> dict[tuple[str, str], datetime]:
    """{(quest_id, period_key): granted_at} for this actor's grants in the given periods."""
    stmt = select(RewardGrant.quest_id, RewardGrant.period_key, RewardGrant.granted_at).where(
        RewardGrant.actor_email == actor, RewardGrant.period_key.in_(period_keys)
    )
    return {(q, p): g for q, p, g in (await session.execute(stmt)).all()}
