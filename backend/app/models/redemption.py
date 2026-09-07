from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Reward Redemption V1 — the request/approval record for spending Coins on a catalog item.
#
# THE COINS THEMSELVES NEVER LIVE HERE. reward_grants stays the one Coin ledger: a redemption
# writes a negative row (source="redeem", quest_id=<item_id>, period_key="r:<idempotency key>")
# and a reject/cancel writes a positive refund row (source="refund", period_key="f:<same key>").
# The ledger's UNIQUE(actor, quest_id, period_key) makes both exactly-once under retries and
# concurrency; this table only carries the workflow state and points at those two rows.
#
# Statuses: pending → approved → fulfilled; pending → rejected | cancelled (refunded). Time-off
# style items are just catalog entries with requires_approval=True — nothing here touches HR/Atlas.

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_FULFILLED = "fulfilled"
STATUS_REJECTED = "rejected"
STATUS_CANCELLED = "cancelled"
STATUSES = (STATUS_PENDING, STATUS_APPROVED, STATUS_FULFILLED, STATUS_REJECTED, STATUS_CANCELLED)


class RewardRedemption(BaseModel):
    __tablename__ = "reward_redemptions"
    __table_args__ = (
        Index("ux_reward_redemptions_actor_idem", "actor_email", "idempotency_key", unique=True),
        Index("ix_reward_redemptions_actor_email", "actor_email"),
    )

    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    cost: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(32), nullable=False)
    debit_grant_id: Mapped[str] = mapped_column(String(36), nullable=False)
    refund_grant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
