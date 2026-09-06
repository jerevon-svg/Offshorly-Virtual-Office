from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Progression & Rewards V1 — one append-only ledger. A row is one successful Claim of one
# completed quest_progress row (a permanent quest has period_key "", a mission has its period
# key). UNIQUE(actor, quest_id, period_key) IS the claim: the INSERT either wins or collides, so
# a double-click, a second tab, a retry after reconnect all resolve to the same single grant
# without any read-then-write race. Balances (XP, Coins) are SUMs over this ledger, never a
# separately maintained counter that could drift, and the amounts are pinned at grant time so a
# later change to the reward table never rewrites history. Level is derived from XP in code.


class RewardGrant(BaseModel):
    __tablename__ = "reward_grants"
    __table_args__ = (
        Index("ux_reward_grants_actor_quest_period", "actor_email", "quest_id", "period_key", unique=True),
        Index("ix_reward_grants_actor_email", "actor_email"),
    )

    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(8), nullable=False)  # "quest" | "mission"
    quest_id: Mapped[str] = mapped_column(String(64), nullable=False)
    period_key: Mapped[str] = mapped_column(String(32), nullable=False, server_default="")
    xp: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    coins: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
