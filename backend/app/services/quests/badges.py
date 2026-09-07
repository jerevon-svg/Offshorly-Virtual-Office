from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone, tzinfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.badge import BadgeAward, BadgeProgress
from app.models.quest import QuestEvent, QuestProgress
from app.services.quests.missions import as_utc
from app.services.quests.registry import (
    DEFAULT_PERIOD_KEY,
    EVENT_CHECK_IN,
    EVENT_COWORKER_APPROACHED,
    EVENT_DM_SENT,
    EVENT_HUB_VISITED,
    EVENT_RECOGNITION_GIVEN,
    all_definitions,
)

# Badge Progression V1 on top of Quest Foundation, Missions and Progression.
#
# A badge = one monotonic metric + four thresholds (Bronze, Silver, Gold, Platinum). Every metric
# is recomputed from existing storage — the quest_events ledger or quest_progress completions —
# so badges add no tracking of their own and cannot drift. Tiers are permanent: once the metric
# has crossed a threshold the award row exists forever, even if a metric shape later changes.
#
# TIMEZONE READINESS. Day-based metrics take an explicit `tz`; V1 passes None (= UTC) everywhere.
# A future Early Bird badge will pass a per-employee zone from Atlas once it is reliably populated.
# Nothing here assumes Asia/Manila and nothing infers a zone from email/department/browser.

TIER_NAMES = {0: "none", 1: "bronze", 2: "silver", 3: "gold", 4: "platinum"}
MAX_TIER = 4

# Achievement Gallery categories (server-owned so the client never hardcodes grouping).
CATEGORY_ENGAGEMENT = "engagement"
CATEGORY_SOCIAL = "social"
CATEGORY_CONTRIBUTION = "contribution"
CATEGORY_GROWTH = "growth"
CATEGORIES = (CATEGORY_ENGAGEMENT, CATEGORY_SOCIAL, CATEGORY_CONTRIBUTION, CATEGORY_GROWTH)

METRIC_EVENT_COUNT = "event_count"  # ledger rows of a type
METRIC_UNIQUE_TARGETS = "unique_targets"  # distinct counterparts of a type
METRIC_UNIQUE_DAYS = "unique_days"  # distinct calendar days with a type
METRIC_STREAK_BEST = "streak_best"  # longest run of consecutive days with a type (monotonic)
METRIC_QUESTS_COMPLETED = "quests_completed"  # completed permanent quests
METRIC_MISSIONS_COMPLETED = "missions_completed"  # completed period missions

COMPLETION_METRICS = (METRIC_QUESTS_COMPLETED, METRIC_MISSIONS_COMPLETED)


@dataclass(frozen=True)
class BadgeDefinition:
    id: str
    title: str
    description: str
    metric: str
    thresholds: tuple[int, int, int, int]  # bronze, silver, gold, platinum
    event_type: str | None = None  # None for completion metrics
    order: int = 0
    category: str = CATEGORY_ENGAGEMENT
    # Stable artwork key the client maps to an emblem (glyph today, custom art later). Defaults
    # to the badge id; never derived from the title so renames cannot break artwork.
    emblem: str = ""

    def __post_init__(self) -> None:
        if self.category not in CATEGORIES:
            raise ValueError(f"badge {self.id}: unknown category {self.category!r}")
        if not self.emblem:
            object.__setattr__(self, "emblem", self.id)
        if len(self.thresholds) != 4 or list(self.thresholds) != sorted(self.thresholds) or self.thresholds[0] < 1:
            raise ValueError(f"badge {self.id}: thresholds must be 4 ascending positive values")
        if (self.metric in COMPLETION_METRICS) != (self.event_type is None):
            raise ValueError(f"badge {self.id}: completion metrics take no event type, others require one")

    def tier_for(self, metric: int) -> int:
        return sum(1 for t in self.thresholds if metric >= t)


# Ids are STABLE: they key badge_progress and badge_awards rows. Thresholds are the assessed V1
# values; editing them changes future evaluations only (awards already granted stay).
BADGE_DEFINITIONS: tuple[BadgeDefinition, ...] = (
    BadgeDefinition("regular", "Regular", "Check in to the office", METRIC_EVENT_COUNT, (5, 20, 60, 150), EVENT_CHECK_IN, 10, CATEGORY_ENGAGEMENT),
    BadgeDefinition(
        "connector", "Connector", "Message different coworkers", METRIC_UNIQUE_TARGETS, (3, 8, 15, 30), EVENT_DM_SENT, 20, CATEGORY_SOCIAL
    ),
    BadgeDefinition(
        "approachable",
        "Approachable",
        "Walk up to different coworkers",
        METRIC_UNIQUE_TARGETS,
        (3, 8, 15, 30),
        EVENT_COWORKER_APPROACHED,
        30,
        CATEGORY_SOCIAL,
    ),
    BadgeDefinition(
        "hub_regular", "Hub Regular", "Visit the Company Hub on different days", METRIC_UNIQUE_DAYS, (5, 20, 60, 150), EVENT_HUB_VISITED, 40, CATEGORY_ENGAGEMENT
    ),
    BadgeDefinition(
        "cheerleader", "Cheerleader", "Recognise coworkers", METRIC_EVENT_COUNT, (3, 10, 30, 75), EVENT_RECOGNITION_GIVEN, 50, CATEGORY_CONTRIBUTION
    ),
    BadgeDefinition("mission_runner", "Mission Runner", "Complete daily and weekly missions", METRIC_MISSIONS_COMPLETED, (5, 25, 75, 200), None, 60, CATEGORY_GROWTH),
    BadgeDefinition("pathfinder", "Pathfinder", "Complete onboarding quests", METRIC_QUESTS_COMPLETED, (3, 6, 9, 11), None, 70, CATEGORY_GROWTH),
    BadgeDefinition("streak", "Streak", "Check in on consecutive days", METRIC_STREAK_BEST, (3, 7, 14, 30), EVENT_CHECK_IN, 80, CATEGORY_ENGAGEMENT),
)

_BY_ID: dict[str, BadgeDefinition] = {b.id: b for b in BADGE_DEFINITIONS}
if len(_BY_ID) != len(BADGE_DEFINITIONS):
    raise RuntimeError("duplicate badge id in BADGE_DEFINITIONS")
_BY_EVENT: dict[str, tuple[BadgeDefinition, ...]] = {}
for _b in BADGE_DEFINITIONS:
    if _b.event_type is not None:
        _BY_EVENT[_b.event_type] = _BY_EVENT.get(_b.event_type, ()) + (_b,)
_COMPLETION_BADGES: tuple[BadgeDefinition, ...] = tuple(b for b in BADGE_DEFINITIONS if b.event_type is None)


def all_badges() -> tuple[BadgeDefinition, ...]:
    return tuple(sorted(BADGE_DEFINITIONS, key=lambda b: (b.order, b.id)))


def get_badge(badge_id: str) -> BadgeDefinition | None:
    return _BY_ID.get(badge_id)


def badge_definitions_for(event_type: str) -> tuple[BadgeDefinition, ...]:
    return _BY_EVENT.get(event_type, ())


def local_day(dt: datetime, tz: tzinfo | None) -> date:
    """Calendar day of `dt` in `tz` (UTC when None). The single seam a per-employee zone plugs
    into later; V1 callers always pass None."""
    return (as_utc(dt).astimezone(tz) if tz is not None else as_utc(dt)).date()


def longest_run(days: set[date]) -> int:
    best = 0
    for d in days:
        if d - timedelta(days=1) in days:
            continue  # only start counting from the first day of a run
        n = 1
        while d + timedelta(days=n) in days:
            n += 1
        best = max(best, n)
    return best


async def compute_metric(
    session: AsyncSession, *, actor: str, definition: BadgeDefinition, tz: tzinfo | None = None
) -> int:
    m = definition.metric
    if m in COMPLETION_METRICS:
        quest_ids = {d.id for d in all_definitions()}
        stmt = select(func.count()).select_from(QuestProgress).where(
            QuestProgress.actor_email == actor, QuestProgress.completed_at.isnot(None)
        )
        stmt = (
            stmt.where(QuestProgress.period_key == DEFAULT_PERIOD_KEY, QuestProgress.quest_id.in_(quest_ids))
            if m == METRIC_QUESTS_COMPLETED
            else stmt.where(QuestProgress.period_key != DEFAULT_PERIOD_KEY)
        )
        return int((await session.execute(stmt)).scalar_one() or 0)

    by_actor_type = (QuestEvent.actor_email == actor, QuestEvent.event_type == definition.event_type)
    if m == METRIC_EVENT_COUNT:
        stmt = select(func.count()).select_from(QuestEvent).where(*by_actor_type)
        return int((await session.execute(stmt)).scalar_one() or 0)
    if m == METRIC_UNIQUE_TARGETS:
        stmt = select(func.count(func.distinct(QuestEvent.target_email))).where(
            *by_actor_type, QuestEvent.target_email.isnot(None)
        )
        return int((await session.execute(stmt)).scalar_one() or 0)
    stamps = (await session.execute(select(QuestEvent.occurred_at).where(*by_actor_type))).scalars().all()
    days = {local_day(s, tz) for s in stamps}
    if m == METRIC_UNIQUE_DAYS:
        return len(days)
    if m == METRIC_STREAK_BEST:
        return longest_run(days)
    raise ValueError(f"unknown badge metric {m!r}")  # pragma: no cover


@dataclass(frozen=True)
class BadgeAwardRef:
    """One tier crossed on this call — the unit a future Reward Redemption keys on."""

    badge_id: str
    tier: int


async def _progress_row(session: AsyncSession, *, actor: str, badge_id: str) -> BadgeProgress:
    stmt = select(BadgeProgress).where(BadgeProgress.actor_email == actor, BadgeProgress.badge_id == badge_id)
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None:
        return row
    try:
        async with session.begin_nested():
            row = BadgeProgress(actor_email=actor, badge_id=badge_id, metric=0, tier=0)
            session.add(row)
            await session.flush()
        return row
    except IntegrityError:
        row = (await session.execute(stmt)).scalar_one_or_none()
        if row is None:  # pragma: no cover
            raise
        return row


async def evaluate_badge(
    session: AsyncSession, *, actor: str, definition: BadgeDefinition, now: datetime, tz: tzinfo | None = None
) -> tuple[BadgeAwardRef, ...]:
    """Recompute one badge's metric, keep it monotonic, and award every newly crossed tier."""
    row = await _progress_row(session, actor=actor, badge_id=definition.id)
    metric = max(row.metric, await compute_metric(session, actor=actor, definition=definition, tz=tz))
    target_tier = definition.tier_for(metric)
    awarded: list[BadgeAwardRef] = []
    for tier in range(row.tier + 1, target_tier + 1):
        try:
            async with session.begin_nested():
                session.add(BadgeAward(actor_email=actor, badge_id=definition.id, tier=tier, metric=metric, awarded_at=now))
                await session.flush()
            awarded.append(BadgeAwardRef(definition.id, tier))
        except IntegrityError:
            pass  # a concurrent evaluation already awarded this tier — permanent either way
    if metric != row.metric or target_tier != row.tier:
        row.metric = metric
        row.tier = max(row.tier, target_tier)
    return tuple(awarded)


async def advance_badges(
    session: AsyncSession, *, actor: str, event_type: str, occurred_at: datetime, completions_changed: bool
) -> tuple[BadgeAwardRef, ...]:
    """Engine hook: after a ledger row (and its quest/mission progress) is written, re-evaluate the
    badges that subscribe to `event_type`, plus the completion badges when anything completed."""
    todo: list[BadgeDefinition] = list(badge_definitions_for(event_type))
    if completions_changed:
        todo.extend(_COMPLETION_BADGES)
    awarded: list[BadgeAwardRef] = []
    for definition in todo:
        awarded.extend(await evaluate_badge(session, actor=actor, definition=definition, now=occurred_at))
    return tuple(awarded)


async def reconcile_all(session: AsyncSession, *, actor: str, now: datetime) -> tuple[BadgeAwardRef, ...]:
    """Evaluate every badge from history — the one-time backfill when an actor with existing
    ledger/completion history is read for the first time."""
    awarded: list[BadgeAwardRef] = []
    for definition in all_badges():
        awarded.extend(await evaluate_badge(session, actor=actor, definition=definition, now=now))
    return tuple(awarded)
