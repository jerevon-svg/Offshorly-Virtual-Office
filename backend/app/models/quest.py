from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Quest Foundation — the two tables behind "authoritative VO action → validated quest event →
# materialized progress". Deliberately NOT activity_events: that table's module rule forbids it
# from becoming a general activity log, and these rows serve a different question ("what has this
# person accomplished") with a different reader (the quest engine and, later, XP/Coins ledgers).
#
# WHAT MAY BE WRITTEN: the semantic fact that an actor performed one quest-relevant action —
# who, which event type, a natural idempotency key, an optional counterpart (target_email), an
# opaque reference id, and when. Never message text, never Toucan content, never a payload blob.
#
# WHO WRITES: services/quests/engine.py's record_quest_event, and nothing else. Feature code never
# touches these models directly — it emits an event with a server-derived actor and lets the
# engine decide whether any quest cares.


class QuestEvent(BaseModel):
    """One validated occurrence of a quest-relevant action. Rows are only written for event
    types some registered quest subscribes to, so this is a filtered ledger, not raw analytics.

    Idempotency is UNIQUE(event_type, dedupe_key): the natural key is namespaced by its event
    domain so a message id and a request id that happen to collide can never shadow each other.
    A duplicate (retry, repeated socket emit, reconnect re-assert) is a no-op, not an error."""

    __tablename__ = "quest_events"
    __table_args__ = (
        Index("ux_quest_events_type_dedupe", "event_type", "dedupe_key", unique=True),
        # "this actor's events of this type" is the progress recount read — served directly.
        Index("ix_quest_events_actor_type", "actor_email", "event_type"),
    )

    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    # The counterpart of the action when it has one (the DM recipient, the recognised
    # coworker). Unique-count quests count DISTINCT values of this column. Nullable for actions
    # without a counterpart (a check-in, a Toucan question).
    target_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Opaque correlation handle for support/debug work (message id, request id, ...). Never
    # shown to users and never required to be resolvable.
    reference_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class QuestProgress(BaseModel):
    """Materialized progress of one actor on one quest within one period. `period_key` is the
    seam for Daily/Weekly Missions and is the empty string for every once/unique_count quest in
    this checkpoint — no timezone or reset semantics are chosen here."""

    __tablename__ = "quest_progress"
    __table_args__ = (
        Index("ux_quest_progress_actor_quest_period", "actor_email", "quest_id", "period_key", unique=True),
    )

    actor_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    quest_id: Mapped[str] = mapped_column(String(64), nullable=False)
    period_key: Mapped[str] = mapped_column(String(32), nullable=False, server_default="")
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
