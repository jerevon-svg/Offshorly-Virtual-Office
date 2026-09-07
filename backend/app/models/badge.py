from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Badge Progression V1 — permanent, server-authoritative achievements with four tiers
# (1 Bronze, 2 Silver, 3 Gold, 4 Platinum). A badge is a MONOTONIC per-actor metric recomputed
# from storage that already exists (quest_events, quest_progress) plus four thresholds; there is
# no separate tracking and no blind increment.
#
# badge_progress is the read model: the actor's current metric and tier per badge. badge_awards is
# the append-only fact: one row per (actor, badge, tier) the moment the threshold was crossed.
# UNIQUE(actor, badge, tier) makes awarding idempotent under retries and concurrency, and is what a
# future Reward Redemption references. Badges pay no XP/Coins in V1 and have no Claim.
#
# WHO WRITES: services/quests/badges.py (from the quest engine's savepoint, and the one-time
# read-side backfill), nothing else.


class BadgeProgress(BaseModel):
    __tablename__ = "badge_progress"
    __table_args__ = (
        Index("ux_badge_progress_actor_badge", "actor_email", "badge_id", unique=True),
        Index("ix_badge_progress_actor_email", "actor_email"),
    )

    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    badge_id: Mapped[str] = mapped_column(String(64), nullable=False)
    metric: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    tier: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class BadgeAward(BaseModel):
    __tablename__ = "badge_awards"
    __table_args__ = (
        Index("ux_badge_awards_actor_badge_tier", "actor_email", "badge_id", "tier", unique=True),
        Index("ix_badge_awards_actor_email", "actor_email"),
    )

    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    badge_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tier: Mapped[int] = mapped_column(Integer, nullable=False)
    # The metric value that crossed the threshold — kept so history survives threshold edits.
    metric: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
