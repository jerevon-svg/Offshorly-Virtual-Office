from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.quest import QuestEvent
from app.services.quests.missions import MissionRef, advance_missions, mission_definitions_for
from app.services.quests.progress import get_or_create_progress
from app.services.quests.registry import (
    DEFAULT_PERIOD_KEY,
    MODE_UNIQUE_COUNT,
    QuestDefinition,
    definitions_for,
)

_logger = logging.getLogger(__name__)

# THE ONE WRITE PATH for quest_events and quest_progress.
#
# Callers (the authoritative hook sites, all server-side, all with a server-derived actor):
#   routers/attendance.py        check_in / check_out    — only on a real status transition
#   services/chat_send.py        send_chat_message       — dm_sent / group_message_sent per saved message
#   routers/requests.py          create_request          — ask_to_join for kind="join_group"
#   realtime/socket.py           spatial_session_start   — spatial_session_joined per (email, session id)
#   routers/feed.py + routers/hub.py                     — recognition_given for posts/reactions/Hub CTA
#   repositories/toucan.py       append_exchange         — toucan_asked per persisted user turn
#
# Hub visit / profile view / approach keys carry a UTC day component (missions.utc_day_key) so
# they count once per day — enough for the once-mode onboarding quests AND for daily missions.
#
# CONTRACT. `record_quest_event` never raises and never breaks the caller's transaction: all of
# its work runs inside a SAVEPOINT on the caller's session, so a failure unwinds only the quest
# writes, is logged (event type / reference / actor — never content), and the primary action
# commits as if quests did not exist. A duplicate natural key is not a failure: it is the
# expected shape of a retry, and it records nothing.

# The reserved non-human chat sender (services/chat_send.py). Duplicated as a literal rather than
# imported so this module depends on nothing above the model layer; test_quest_engine pins it.
_TOUCAN_SENDER = "toucan@virtual-office.local"


def _normalize(email: str | None) -> str | None:
    if email is None:
        return None
    email = email.strip().lower()
    return email or None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class QuestRecordResult:
    """What one call did. `stored` is False for an unsubscribed event type or a duplicate key;
    `completed_quest_ids` lists quests that crossed their target ON THIS CALL (a later hook for
    XP/Coins, unused today)."""

    stored: bool
    duplicate: bool = False
    updated_quest_ids: tuple[str, ...] = field(default_factory=tuple)
    completed_quest_ids: tuple[str, ...] = field(default_factory=tuple)
    # Daily/Weekly Missions moved by this call (services/quests/missions.py). `completed_missions`
    # is THE seam for Progression & Rewards: each ref is one (mission, period) instance that
    # crossed its target on this call, exactly once.
    updated_missions: tuple[MissionRef, ...] = field(default_factory=tuple)
    completed_missions: tuple[MissionRef, ...] = field(default_factory=tuple)


UNSUBSCRIBED = QuestRecordResult(stored=False)
DUPLICATE = QuestRecordResult(stored=False, duplicate=True)


async def record_quest_event(
    session: AsyncSession,
    *,
    actor_email: str,
    event_type: str,
    dedupe_key: str,
    target_email: str | None = None,
    reference_id: str | None = None,
    occurred_at: datetime | None = None,
) -> QuestRecordResult | None:
    """Record one validated occurrence of `event_type` by `actor_email` and advance every quest
    that subscribes to it. Returns None ONLY when recording itself failed (already logged)."""
    # Storage gate: an event type is written only if a quest OR a pool mission subscribes to it.
    subscribed = definitions_for(event_type)
    if not subscribed and not mission_definitions_for(event_type):
        return UNSUBSCRIBED

    actor = _normalize(actor_email)
    target = _normalize(target_email)
    if actor is None or not dedupe_key:
        _logger.error(
            "quest event rejected: missing actor or dedupe key event_type=%s reference_id=%s", event_type, reference_id
        )
        return None
    # A self-directed or Toucan-directed "social" act is not a quest-relevant act at all — it
    # never counts, in any mode, so it is never stored. (Actor-only events have target None.)
    if target is not None and (target == actor or target == _TOUCAN_SENDER):
        return UNSUBSCRIBED

    try:
        async with session.begin_nested():
            return await _record(
                session,
                actor=actor,
                event_type=event_type,
                dedupe_key=dedupe_key,
                target=target,
                reference_id=reference_id,
                occurred_at=occurred_at or _utc_now(),
                subscribed=subscribed,
            )
    except Exception:
        _logger.exception(
            "quest event recording failed actor=%s event_type=%s reference_id=%s", actor, event_type, reference_id
        )
        return None


async def _record(
    session: AsyncSession,
    *,
    actor: str,
    event_type: str,
    dedupe_key: str,
    target: str | None,
    reference_id: str | None,
    occurred_at: datetime,
    subscribed: tuple[QuestDefinition, ...],
) -> QuestRecordResult:
    # 1. The ledger row, behind UNIQUE(event_type, dedupe_key). Its own savepoint so a duplicate
    #    unwinds only this INSERT and leaves the caller's transaction (and ours) healthy.
    try:
        async with session.begin_nested():
            session.add(
                QuestEvent(
                    actor_email=actor,
                    event_type=event_type,
                    dedupe_key=dedupe_key[:255],
                    target_email=target,
                    reference_id=reference_id[:64] if reference_id else None,
                    occurred_at=occurred_at,
                )
            )
            await session.flush()
    except IntegrityError:
        return DUPLICATE

    # 2. Progress, recomputed from the ledger per subscribed quest. Never a blind increment.
    updated: list[str] = []
    completed: list[str] = []
    for definition in subscribed:
        row = await get_or_create_progress(session, actor=actor, quest_id=definition.id, period_key=DEFAULT_PERIOD_KEY)
        if row.completed_at is not None:
            continue  # once completed, always completed — later events cannot reopen or refarm

        if definition.mode == MODE_UNIQUE_COUNT:
            if target is None:
                continue  # an event without a counterpart cannot advance a unique-count quest
            count = await _distinct_target_count(session, actor=actor, event_type=event_type)
        else:
            count = 1

        if count == row.count and count < definition.target:
            continue  # e.g. a repeat DM to an already-counted coworker: nothing changed
        row.count = min(count, definition.target)
        if count >= definition.target:
            row.completed_at = occurred_at
            completed.append(definition.id)
        updated.append(definition.id)

    # 3. Missions: same ledger, period-bounded recount, progress rows under real period keys.
    updated_missions, completed_missions = await advance_missions(
        session, actor=actor, event_type=event_type, occurred_at=occurred_at
    )

    await session.flush()
    return QuestRecordResult(
        stored=True,
        updated_quest_ids=tuple(updated),
        completed_quest_ids=tuple(completed),
        updated_missions=updated_missions,
        completed_missions=completed_missions,
    )


async def _distinct_target_count(session: AsyncSession, *, actor: str, event_type: str) -> int:
    stmt = select(func.count(func.distinct(QuestEvent.target_email))).where(
        QuestEvent.actor_email == actor,
        QuestEvent.event_type == event_type,
        QuestEvent.target_email.isnot(None),
    )
    return int((await session.execute(stmt)).scalar_one() or 0)
