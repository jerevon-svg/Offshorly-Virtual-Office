from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.badge import BadgeAward
from app.models.quest import QuestEvent, QuestProgress
from app.models.reward import RewardGrant
from app.services.quests.badges import MAX_TIER, get_badge
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
# Badge tier bonuses: detection stays automatic (badge_awards), the XP/Coins are claimed from the
# Achievement Gallery through this same ledger with quest_id=<badge_id>, period_key="t:<tier>".
SOURCE_BADGE = "badge"
BADGE_PERIOD_PREFIX = "t:"
# KUDOS (company terminology for the recognition act). Unlike every source above, this one is
# NOT claimed: it is the RECIPIENT's payout, granted server-side the moment a coworker gives
# them Kudos, through the same append-only ledger so balances stay a SUM and never drift. The
# giver keeps their ordinary (smaller) quest/mission/badge claims — nothing here changes those.
# quest_id is a fixed pseudo-id and the period key is the Kudos artifact itself, so
# UNIQUE(actor, quest_id, period_key) makes the payout idempotent per Kudos with no new table.
SOURCE_KUDOS = "kudos"
KUDOS_RECEIVED_ID = "kudos_received"
# ANTI-FARMING V1. One giver pays one recipient at most once per rolling 7 days. The cooldown
# needs no table and no migration: quest_events ALREADY records (actor, target, occurred_at) for
# every rewarded Kudos, so "have I rewarded this pair recently" is one indexed read of data the
# engine writes anyway. Kudos events carry their own dedupe-key prefix so the probe cannot be
# tripped by the other acts that share the recognition_given event type (a reaction, a Hub
# birthday wish). A Kudos inside the cooldown is still POSTED — it simply records no event and
# grants nothing, which is what stops reward AND quest/mission/badge farming with one gate.
KUDOS_DEDUPE_PREFIX = "kudos:"
KUDOS_COOLDOWN_DAYS = 7

_logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Reward:
    xp: int
    coins: int


REWARD_QUEST_ONCE = Reward(xp=50, coins=10)
REWARD_QUEST_UNIQUE = Reward(xp=100, coins=25)
REWARD_MISSION_DAILY = Reward(xp=20, coins=5)
REWARD_MISSION_WEEKLY = Reward(xp=60, coins=15)
REWARD_BADGE_TIER: dict[int, Reward] = {
    1: Reward(xp=25, coins=10),  # bronze
    2: Reward(xp=75, coins=25),  # silver
    3: Reward(xp=150, coins=50),  # gold
    4: Reward(xp=300, coins=100),  # platinum
}
# Receiving Kudos deliberately pays MORE than any repeatable engagement action (daily mission
# 20/5, weekly 60/15, once-quest 50/10) — being recognised by a coworker is the strongest signal
# in the system. Amounts are pinned into the grant row, so changing this only affects new Kudos.
REWARD_KUDOS_RECEIVED = Reward(xp=75, coins=20)


def reward_for_badge_tier(tier: int) -> Reward:
    return REWARD_BADGE_TIER[tier]


def badge_period_key(tier: int) -> str:
    return f"{BADGE_PERIOD_PREFIX}{tier}"


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
    prefix matches their cadence, badge tiers only as (badge_id, "t:1".."t:4")."""
    if period_key == DEFAULT_PERIOD_KEY:
        q = get_definition(quest_id)
        return ClaimTarget(SOURCE_QUEST, q.id, DEFAULT_PERIOD_KEY, reward_for_quest(q)) if q else None
    if period_key.startswith(BADGE_PERIOD_PREFIX):
        b = get_badge(quest_id)
        tier_text = period_key[len(BADGE_PERIOD_PREFIX) :]
        if b is None or not tier_text.isdigit() or not 1 <= int(tier_text) <= MAX_TIER:
            return None
        return ClaimTarget(SOURCE_BADGE, b.id, badge_period_key(int(tier_text)), reward_for_badge_tier(int(tier_text)))
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
    if not await _is_completed(session, actor=actor, target=target):
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


async def _is_completed(session: AsyncSession, *, actor: str, target: ClaimTarget) -> bool:
    """Quests/missions: a completed quest_progress row. Badge tiers: a badge_awards row — the
    server already decided the tier was earned; the claim only collects the bonus."""
    if target.source == SOURCE_BADGE:
        tier = int(target.period_key[len(BADGE_PERIOD_PREFIX) :])
        stmt = select(BadgeAward.id).where(
            BadgeAward.actor_email == actor, BadgeAward.badge_id == target.quest_id, BadgeAward.tier == tier
        )
        return (await session.execute(stmt)).scalar_one_or_none() is not None
    stmt = select(QuestProgress.completed_at).where(
        QuestProgress.actor_email == actor,
        QuestProgress.quest_id == target.quest_id,
        QuestProgress.period_key == target.period_key,
    )
    completed_at = (await session.execute(stmt)).scalar_one_or_none()
    return completed_at is not None


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


def kudos_period_key(reference_id: str) -> str:
    """The Kudos artifact (the Feed activity id) as a period key. reward_grants.period_key is
    VARCHAR(32) and a post id is a 36-char UUID, so the dashes are stripped to land on exactly
    32 hex characters. Deterministic, so the same Kudos always maps to the same grant row."""
    return reference_id.strip().replace("-", "")[:32]


async def grant_kudos_received(
    session: AsyncSession, *, recipient: str, giver: str, reference_id: str, now: datetime | None = None
) -> RewardGrant | None:
    """Pay REWARD_KUDOS_RECEIVED to the employee who RECEIVED one Kudos. Server-authoritative
    (no client input reaches the amount) and idempotent: keyed on the Kudos artifact, so a
    re-click, a retry or a replay all resolve to the one grant. Returns the new grant, or None
    when nothing was written (self-Kudos, already granted, bad input, or a logged failure).

    Self-Kudos is refused HERE rather than at each call site, so every present and future path
    that pays a recipient inherits the rule — the same rule the quest engine applies to events.

    Unlike claim(), this runs alongside the caller's other writes, so a collision unwinds only
    this INSERT via a SAVEPOINT and never rolls back the Kudos itself — same contract as
    services/quests/engine.record_quest_event.
    """
    actor = recipient.strip().lower()
    period_key = kudos_period_key(reference_id) if reference_id else ""
    if not actor or not period_key:
        _logger.error("kudos grant rejected: missing recipient or reference reference_id=%s", reference_id)
        return None
    if actor == giver.strip().lower():
        return None  # you cannot pay yourself Kudos

    target = ClaimTarget(SOURCE_KUDOS, KUDOS_RECEIVED_ID, period_key, REWARD_KUDOS_RECEIVED)
    try:
        if await _grant(session, actor=actor, target=target) is not None:
            return None  # already paid for this Kudos
        grant = RewardGrant(
            actor_email=actor,
            source=SOURCE_KUDOS,
            quest_id=KUDOS_RECEIVED_ID,
            period_key=period_key,
            xp=REWARD_KUDOS_RECEIVED.xp,
            coins=REWARD_KUDOS_RECEIVED.coins,
            granted_at=now or datetime.now(timezone.utc),
        )
        async with session.begin_nested():
            session.add(grant)
            await session.flush()
        return grant
    except IntegrityError:
        return None  # concurrent giver won the race; the single grant already exists
    except Exception:  # pragma: no cover - defensive, mirrors record_quest_event's contract
        _logger.exception("kudos grant failed recipient=%s reference_id=%s", actor, reference_id)
        return None


def kudos_dedupe_key(post_id: str) -> str:
    """The quest_events dedupe key for one Kudos. The `kudos:` prefix is what makes the pair
    cooldown probe below able to see Kudos and only Kudos."""
    return f"{KUDOS_DEDUPE_PREFIX}{post_id}"


async def kudos_reward_on_cooldown(
    session: AsyncSession, *, giver: str, recipient: str, now: datetime | None = None
) -> bool:
    """True when `giver` already had a Kudos to `recipient` rewarded inside the rolling
    KUDOS_COOLDOWN_DAYS window. The caller then posts the Kudos but records no quest event and
    grants no reward, so neither XP/Coins nor quest/mission/badge progress can be farmed by
    repeating the same Kudos."""
    since = (now or datetime.now(timezone.utc)) - timedelta(days=KUDOS_COOLDOWN_DAYS)
    stmt = (
        select(QuestEvent.id)
        .where(
            QuestEvent.actor_email == giver.strip().lower(),
            QuestEvent.target_email == recipient.strip().lower(),
            QuestEvent.dedupe_key.startswith(KUDOS_DEDUPE_PREFIX),
            QuestEvent.occurred_at >= since,
        )
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none() is not None

