from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mission import MissionAssignment
from app.models.quest import QuestEvent
from app.services.quests.progress import get_or_create_progress
from app.services.quests.registry import (
    EVENT_ASK_TO_JOIN,
    EVENT_CHECK_IN,
    EVENT_CHECK_OUT,
    EVENT_COWORKER_APPROACHED,
    EVENT_DM_SENT,
    EVENT_HUB_VISITED,
    EVENT_PROFILE_VIEWED,
    EVENT_RECOGNITION_GIVEN,
    EVENT_SPATIAL_SESSION_JOINED,
    EVENT_TOUCAN_ASKED,
    MODE_ONCE,
    MODE_UNIQUE_COUNT,
)

# Daily/Weekly Missions on top of Quest Foundation.
#
# PERIODS are server-authoritative and UTC: a daily period is one UTC calendar day, a weekly
# period is the ISO week (Monday 00:00 UTC → next Monday). The period an event belongs to is
# derived from its server-side `occurred_at`, never from the client. "Reset" is not a job: a new
# period simply has a new key, so it has no assignments and no progress rows until something
# happens in it. Old periods stay readable in quest_progress under their own keys.
#
# THE POOL is code (like registry.QUEST_DEFINITIONS) and reuses only event types the foundation
# already records from authoritative write sites. Every actor gets ACTIVE_PER_CADENCE missions
# per period, drawn deterministically from the cadence's pool (seeded by actor + period key) and
# pinned in mission_assignments so a later pool edit cannot reshuffle a live period.
#
# ANTI-FARMING BY CONSTRUCTION. There is no raw "count N events" mode. Progress is recomputed
# from the ledger, bounded to the period, in one of three shapes: `once` (any accepted event),
# `unique_count` (DISTINCT counterparts — spamming the same coworker is one), `unique_days`
# (DISTINCT UTC days — check-in/out churn within a day is one). Events are already idempotent per
# natural key at the ledger, and self/Toucan-directed acts are dropped before storage.

CADENCE_DAILY = "daily"
CADENCE_WEEKLY = "weekly"
CADENCES = (CADENCE_DAILY, CADENCE_WEEKLY)

MODE_UNIQUE_DAYS = "unique_days"
MISSION_MODES = (MODE_ONCE, MODE_UNIQUE_COUNT, MODE_UNIQUE_DAYS)

ACTIVE_PER_CADENCE = {CADENCE_DAILY: 3, CADENCE_WEEKLY: 3}


def as_utc(dt: datetime) -> datetime:
    # SQLite hands timezone-aware columns back naive; every writer stores UTC, so naive == UTC.
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def utc_day_key(dt: datetime | None = None) -> str:
    """'YYYY-MM-DD' of `dt` (default now) in UTC — the day component hook sites put in dedupe
    keys for actions that should count again on a new day (Hub visit, profile view, approach)."""
    return as_utc(dt or datetime.now(timezone.utc)).date().isoformat()


@dataclass(frozen=True)
class MissionPeriod:
    cadence: str
    key: str
    starts_at: datetime
    ends_at: datetime  # exclusive; also "resets at"


def period_for(cadence: str, at: datetime) -> MissionPeriod:
    at = as_utc(at)
    day = datetime(at.year, at.month, at.day, tzinfo=timezone.utc)
    if cadence == CADENCE_DAILY:
        return MissionPeriod(cadence, f"d:{day.date().isoformat()}", day, day + timedelta(days=1))
    if cadence == CADENCE_WEEKLY:
        monday = day - timedelta(days=day.weekday())
        iso_year, iso_week, _ = monday.isocalendar()
        return MissionPeriod(cadence, f"w:{iso_year}-W{iso_week:02d}", monday, monday + timedelta(days=7))
    raise ValueError(f"unknown cadence {cadence!r}")


@dataclass(frozen=True)
class MissionDefinition:
    id: str
    title: str
    event_type: str
    cadence: str
    mode: str = MODE_ONCE
    target: int = 1

    def __post_init__(self) -> None:
        if self.cadence not in CADENCES:
            raise ValueError(f"unknown mission cadence {self.cadence!r}")
        if self.mode not in MISSION_MODES:
            raise ValueError(f"unknown mission mode {self.mode!r}")
        if self.target < 1:
            raise ValueError("mission target must be >= 1")
        if self.mode == MODE_ONCE and self.target != 1:
            raise ValueError("once-mode missions always have target 1")


# Ids are STABLE: they are the quest_id of every mission's quest_progress row and the mission_id
# of every assignment. Rename a title freely; never reuse an id for a different meaning.
MISSION_POOL: tuple[MissionDefinition, ...] = (
    # ---- daily ------------------------------------------------------------------------------
    MissionDefinition("daily_check_in", "Check in today", EVENT_CHECK_IN, CADENCE_DAILY),
    MissionDefinition("daily_visit_hub", "Visit the Company Hub", EVENT_HUB_VISITED, CADENCE_DAILY),
    MissionDefinition(
        "daily_dm_two_coworkers", "Message 2 different coworkers", EVENT_DM_SENT, CADENCE_DAILY, MODE_UNIQUE_COUNT, 2
    ),
    MissionDefinition("daily_approach_coworker", "Walk up to a coworker", EVENT_COWORKER_APPROACHED, CADENCE_DAILY),
    MissionDefinition("daily_view_profile", "View a coworker's profile", EVENT_PROFILE_VIEWED, CADENCE_DAILY),
    MissionDefinition("daily_ask_toucan", "Ask Toucan something", EVENT_TOUCAN_ASKED, CADENCE_DAILY),
    MissionDefinition("daily_spatial_chat", "Join a spatial conversation", EVENT_SPATIAL_SESSION_JOINED, CADENCE_DAILY),
    MissionDefinition("daily_recognise", "Recognise a coworker", EVENT_RECOGNITION_GIVEN, CADENCE_DAILY),
    MissionDefinition("daily_log_time", "Log your time", EVENT_CHECK_OUT, CADENCE_DAILY),
    # ---- weekly -----------------------------------------------------------------------------
    MissionDefinition(
        "weekly_check_in_days", "Check in on 3 different days", EVENT_CHECK_IN, CADENCE_WEEKLY, MODE_UNIQUE_DAYS, 3
    ),
    MissionDefinition(
        "weekly_dm_coworkers", "Message 4 different coworkers", EVENT_DM_SENT, CADENCE_WEEKLY, MODE_UNIQUE_COUNT, 4
    ),
    MissionDefinition(
        "weekly_recognise_two",
        "Recognise 2 different coworkers",
        EVENT_RECOGNITION_GIVEN,
        CADENCE_WEEKLY,
        MODE_UNIQUE_COUNT,
        2,
    ),
    MissionDefinition(
        "weekly_spatial_days",
        "Join spatial conversations on 2 different days",
        EVENT_SPATIAL_SESSION_JOINED,
        CADENCE_WEEKLY,
        MODE_UNIQUE_DAYS,
        2,
    ),
    MissionDefinition(
        "weekly_toucan_days", "Ask Toucan on 3 different days", EVENT_TOUCAN_ASKED, CADENCE_WEEKLY, MODE_UNIQUE_DAYS, 3
    ),
    MissionDefinition(
        "weekly_approach_coworkers",
        "Walk up to 3 different coworkers",
        EVENT_COWORKER_APPROACHED,
        CADENCE_WEEKLY,
        MODE_UNIQUE_COUNT,
        3,
    ),
    MissionDefinition("weekly_ask_to_join", "Use Ask-to-Join", EVENT_ASK_TO_JOIN, CADENCE_WEEKLY),
    MissionDefinition(
        "weekly_view_profiles", "View 3 coworkers' profiles", EVENT_PROFILE_VIEWED, CADENCE_WEEKLY, MODE_UNIQUE_COUNT, 3
    ),
)

_BY_ID: dict[str, MissionDefinition] = {m.id: m for m in MISSION_POOL}
if len(_BY_ID) != len(MISSION_POOL):
    raise RuntimeError("duplicate mission id in MISSION_POOL")

_BY_EVENT: dict[str, tuple[MissionDefinition, ...]] = {}
_BY_CADENCE: dict[str, tuple[MissionDefinition, ...]] = {c: () for c in CADENCES}
for _m in MISSION_POOL:
    _BY_EVENT[_m.event_type] = _BY_EVENT.get(_m.event_type, ()) + (_m,)
    _BY_CADENCE[_m.cadence] = _BY_CADENCE[_m.cadence] + (_m,)
for _c, _pool in _BY_CADENCE.items():
    if len(_pool) < ACTIVE_PER_CADENCE[_c]:
        raise RuntimeError(f"mission pool for {_c} is smaller than ACTIVE_PER_CADENCE")


def mission_definitions_for(event_type: str) -> tuple[MissionDefinition, ...]:
    """Pool entries that subscribe to `event_type` (the engine's storage gate, alongside quests)."""
    return _BY_EVENT.get(event_type, ())


def get_mission(mission_id: str) -> MissionDefinition | None:
    return _BY_ID.get(mission_id)


def pool_for(cadence: str) -> tuple[MissionDefinition, ...]:
    return tuple(sorted(_BY_CADENCE[cadence], key=lambda m: m.id))


def select_missions(actor: str, period: MissionPeriod) -> tuple[MissionDefinition, ...]:
    """The deterministic draw for (actor, period): same inputs, same missions, on any server."""
    pool = pool_for(period.cadence)
    seed = int.from_bytes(hashlib.sha256(f"{actor}|{period.key}".encode()).digest()[:8], "big")
    return tuple(random.Random(seed).sample(pool, ACTIVE_PER_CADENCE[period.cadence]))


@dataclass(frozen=True)
class MissionRef:
    """Identifies one mission instance — the unit XP/Coins will later be granted for."""

    mission_id: str
    cadence: str
    period_key: str


async def ensure_assignments(
    session: AsyncSession, *, actor: str, period: MissionPeriod
) -> tuple[tuple[MissionDefinition, ...], bool]:
    """This actor's pinned missions for `period`, drawing and storing them if this is the first
    touch of the period. Returns (definitions in slot order, created_now). Assignments whose id
    left the pool are skipped, never redrawn."""
    stmt = (
        select(MissionAssignment)
        .where(MissionAssignment.actor_email == actor, MissionAssignment.period_key == period.key)
        .order_by(MissionAssignment.slot)
    )
    rows = (await session.execute(stmt)).scalars().all()
    if rows:
        return _known(rows), False
    chosen = select_missions(actor, period)
    try:
        async with session.begin_nested():
            for slot, m in enumerate(chosen):
                session.add(
                    MissionAssignment(
                        actor_email=actor, cadence=period.cadence, period_key=period.key, mission_id=m.id, slot=slot
                    )
                )
            await session.flush()
        return chosen, True
    except IntegrityError:
        rows = (await session.execute(stmt)).scalars().all()
        return _known(rows), False


def _known(rows) -> tuple[MissionDefinition, ...]:
    return tuple(m for r in rows if (m := get_mission(r.mission_id)) is not None)


async def sync_progress(
    session: AsyncSession, *, actor: str, definition: MissionDefinition, period: MissionPeriod, occurred_at: datetime
) -> tuple[bool, bool]:
    """Recompute one mission's progress from the ledger, bounded to `period`, and write it if it
    moved. Returns (changed, completed_on_this_call). Completed missions never reopen."""
    row = await get_or_create_progress(session, actor=actor, quest_id=definition.id, period_key=period.key)
    if row.completed_at is not None:
        return False, False
    count = await _period_count(session, actor=actor, definition=definition, period=period)
    if count == row.count:
        return False, False
    row.count = min(count, definition.target)
    done = count >= definition.target
    if done:
        row.completed_at = occurred_at
    return True, done


async def _period_count(
    session: AsyncSession, *, actor: str, definition: MissionDefinition, period: MissionPeriod
) -> int:
    in_period = (
        QuestEvent.actor_email == actor,
        QuestEvent.event_type == definition.event_type,
        QuestEvent.occurred_at >= period.starts_at,
        QuestEvent.occurred_at < period.ends_at,
    )
    if definition.mode == MODE_UNIQUE_COUNT:
        stmt = select(func.count(func.distinct(QuestEvent.target_email))).where(
            *in_period, QuestEvent.target_email.isnot(None)
        )
        return int((await session.execute(stmt)).scalar_one() or 0)
    if definition.mode == MODE_UNIQUE_DAYS:
        stamps = (await session.execute(select(QuestEvent.occurred_at).where(*in_period))).scalars().all()
        return len({as_utc(s).date() for s in stamps})
    stmt = select(func.count()).select_from(QuestEvent).where(*in_period)
    return 1 if int((await session.execute(stmt)).scalar_one() or 0) > 0 else 0


async def reconcile_period(
    session: AsyncSession, *, actor: str, period: MissionPeriod, now: datetime
) -> tuple[MissionDefinition, ...]:
    """Ensure assignments for `period`; on first touch, materialize progress for every drawn
    mission from events already in the ledger (a read can be the first touch of a period)."""
    defs, created = await ensure_assignments(session, actor=actor, period=period)
    if created:
        for d in defs:
            await sync_progress(session, actor=actor, definition=d, period=period, occurred_at=now)
    return defs


async def advance_missions(
    session: AsyncSession, *, actor: str, event_type: str, occurred_at: datetime
) -> tuple[tuple[MissionRef, ...], tuple[MissionRef, ...]]:
    """Engine hook: after a ledger row for (actor, event_type, occurred_at) is written, move every
    active mission that subscribes to it in the periods containing occurred_at."""
    updated: list[MissionRef] = []
    completed: list[MissionRef] = []
    for cadence in CADENCES:
        period = period_for(cadence, occurred_at)
        defs, created = await ensure_assignments(session, actor=actor, period=period)
        # First touch of the period: sync everything drawn (older events in this period may
        # exist, e.g. a foundation-only type). Otherwise only the subscribers can have moved.
        to_sync = defs if created else tuple(d for d in defs if d.event_type == event_type)
        for d in to_sync:
            changed, done = await sync_progress(
                session, actor=actor, definition=d, period=period, occurred_at=occurred_at
            )
            ref = MissionRef(d.id, cadence, period.key)
            if changed:
                updated.append(ref)
            if done:
                completed.append(ref)
    return tuple(updated), tuple(completed)
