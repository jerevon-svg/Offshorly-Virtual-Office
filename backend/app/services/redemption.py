from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.redemption import (
    STATUS_APPROVED,
    STATUS_CANCELLED,
    STATUS_FULFILLED,
    STATUS_PENDING,
    STATUS_REJECTED,
    RewardRedemption,
)
from app.models.reward import RewardGrant
from app.services.quests.rewards import load_progression

# Reward Redemption V1.
#
# CATALOG lives in code (like quest/mission/badge definitions): stable ids, no admin authoring.
# Every item here is a DEMO/EXAMPLE reward — fulfilment is a manual status change by an approver,
# and nothing in this module reads or writes HR/Atlas data (time-off items included).
#
# COINS: reward_grants is the ONLY ledger. redeem() inserts a negative row, reject/cancel inserts a
# positive refund row. Balance = SUM(coins), exactly as load_progression already computes it.
#
# SAFETY: per-actor serialisation (Postgres advisory lock; SQLite is single-writer) around the
# balance check + debit insert so two concurrent spends cannot both pass; the debit row's unique
# key (actor, item, "r:<idempotency key>") makes replays/double-clicks collapse to one spend; the
# refund row's unique key ("f:<key>") plus the status check make refunds exactly-once.

SOURCE_REDEEM = "redeem"
SOURCE_REFUND = "refund"
IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,30}$")

CATEGORY_VOUCHER = "voucher"
CATEGORY_PERK = "perk"
CATEGORY_TIME_OFF = "time_off"
CATEGORY_CUSTOM = "custom"
CATEGORIES = (CATEGORY_VOUCHER, CATEGORY_PERK, CATEGORY_TIME_OFF, CATEGORY_CUSTOM)


@dataclass(frozen=True)
class CatalogItem:
    id: str
    title: str
    description: str
    cost: int
    category: str
    requires_approval: bool = True
    active: bool = True

    def __post_init__(self) -> None:
        if self.cost < 1:
            raise ValueError(f"catalog item {self.id}: cost must be >= 1")
        if self.category not in CATEGORIES:
            raise ValueError(f"catalog item {self.id}: unknown category {self.category!r}")
        if self.category == CATEGORY_TIME_OFF and not self.requires_approval:
            raise ValueError(f"catalog item {self.id}: time-off rewards always require approval")


# Demo catalog. Costs are tuned so a week of missions affords a small item.
CATALOG: tuple[CatalogItem, ...] = (
    CatalogItem("playlist_pick", "Pick the Office Playlist (demo)", "Choose the shared playlist for one afternoon.", 40, CATEGORY_CUSTOM, requires_approval=False),
    CatalogItem("coffee_voucher", "Coffee Voucher (demo)", "One coffee on the company, fulfilled by an approver.", 60, CATEGORY_VOUCHER, requires_approval=False),
    CatalogItem("desk_plant", "Desk Plant (demo)", "A small plant for your desk, delivered by Ops.", 120, CATEGORY_PERK),
    CatalogItem("early_out_pass", "Early-Out Pass, 1 hour (demo)", "Leave one hour early on an agreed day. Needs manager approval; nothing is filed for you.", 200, CATEGORY_TIME_OFF),
    CatalogItem("lunch_voucher", "₱500 Lunch Voucher (demo)", "A lunch voucher, fulfilled by an approver.", 250, CATEGORY_VOUCHER),
    CatalogItem("half_day_leave", "Half-Day Leave (demo)", "Half a day off on an agreed date. Needs manager approval; file the leave yourself as usual.", 500, CATEGORY_TIME_OFF),
)
_BY_ID: dict[str, CatalogItem] = {c.id: c for c in CATALOG}
if len(_BY_ID) != len(CATALOG):
    raise RuntimeError("duplicate catalog item id")


def catalog() -> tuple[CatalogItem, ...]:
    return tuple(sorted((c for c in CATALOG if c.active), key=lambda c: (c.cost, c.id)))


def get_item(item_id: str) -> CatalogItem | None:
    return _BY_ID.get(item_id)


def approver_emails() -> frozenset[str]:
    return frozenset(e.strip().lower() for e in settings.REWARD_APPROVER_EMAILS.split(",") if e.strip())


def is_approver(email: str) -> bool:
    return email.strip().lower() in approver_emails()


class RedemptionError(Exception):
    status_code = 400


class UnknownItem(RedemptionError):
    status_code = 404


class BadIdempotencyKey(RedemptionError):
    status_code = 400


class InsufficientCoins(RedemptionError):
    status_code = 409


class InvalidTransition(RedemptionError):
    status_code = 409


class NotFound(RedemptionError):
    status_code = 404


class NotAllowed(RedemptionError):
    status_code = 403


async def lock_actor(session: AsyncSession, actor: str) -> None:
    """Serialise Coin-changing work for the rest of the transaction, BEFORE the balance is read.
    Postgres: per-actor transaction-scoped advisory lock. SQLite: plain reads do not open a
    transaction, so two connections could both read the same balance and both debit; BEGIN
    IMMEDIATE takes the single write lock up front so the second waits (busy_timeout) and then
    reads the post-commit balance. Inside an already-open transaction (tests) it is a no-op."""
    dialect = session.bind.dialect.name if session.bind is not None else ""
    if dialect == "postgresql":
        await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:a))"), {"a": actor})
    elif dialect == "sqlite":
        try:
            await session.execute(text("BEGIN IMMEDIATE"))
        except OperationalError:
            pass  # "cannot start a transaction within a transaction" — one writer already, fine


@dataclass(frozen=True)
class RedeemResult:
    redemption: RewardRedemption
    created_now: bool  # False = replay of an earlier request with the same idempotency key


async def _by_idempotency(session: AsyncSession, *, actor: str, key: str) -> RewardRedemption | None:
    stmt = select(RewardRedemption).where(RewardRedemption.actor_email == actor, RewardRedemption.idempotency_key == key)
    return (await session.execute(stmt)).scalar_one_or_none()


async def redeem(
    session: AsyncSession, *, actor_email: str, item_id: str, idempotency_key: str, now: datetime | None = None
) -> RedeemResult:
    """Spend Coins on `item_id` exactly once per (actor, idempotency_key). MUST be the only write in
    its request: the losing side of a race rolls the session back to re-read the winner."""
    actor = actor_email.strip().lower()
    key = idempotency_key.strip()
    if not IDEMPOTENCY_KEY_RE.match(key):
        raise BadIdempotencyKey("idempotencyKey must be 8-30 chars of [A-Za-z0-9_-]")
    item = get_item(item_id.strip())
    if item is None or not item.active:
        raise UnknownItem("Unknown or inactive reward")
    now = now or datetime.now(timezone.utc)

    await lock_actor(session, actor)
    existing = await _by_idempotency(session, actor=actor, key=key)
    if existing is not None:
        return RedeemResult(existing, created_now=False)

    balance = (await load_progression(session, actor=actor)).coins
    if balance < item.cost:
        raise InsufficientCoins(f"Not enough Coins: {balance} available, {item.cost} needed")

    debit = RewardGrant(
        actor_email=actor, source=SOURCE_REDEEM, quest_id=item.id, period_key=f"r:{key}", xp=0, coins=-item.cost, granted_at=now
    )
    try:
        async with session.begin_nested():
            session.add(debit)
            await session.flush()
        redemption = RewardRedemption(
            actor_email=actor,
            item_id=item.id,
            cost=item.cost,
            status=STATUS_PENDING if item.requires_approval else STATUS_APPROVED,
            idempotency_key=key,
            debit_grant_id=debit.id,
        )
        async with session.begin_nested():
            session.add(redemption)
            await session.flush()
        return RedeemResult(redemption, created_now=True)
    except (IntegrityError, OperationalError):
        # Concurrent replay of the same key (other tab/double-click): the winner's rows exist. Drop
        # our transaction (stale snapshot / lock) and hand back the winner.
        await session.rollback()
        existing = await _by_idempotency(session, actor=actor, key=key)
        if existing is None:  # pragma: no cover - the unique indexes guarantee the winner exists
            raise
        return RedeemResult(existing, created_now=False)


async def _refund(session: AsyncSession, redemption: RewardRedemption, *, now: datetime) -> None:
    """Exactly-once refund: unique (actor, item, "f:<key>") arbitrates; a collision means it exists."""
    refund = RewardGrant(
        actor_email=redemption.actor_email,
        source=SOURCE_REFUND,
        quest_id=redemption.item_id,
        period_key=f"f:{redemption.idempotency_key}",
        xp=0,
        coins=redemption.cost,
        granted_at=now,
    )
    try:
        async with session.begin_nested():
            session.add(refund)
            await session.flush()
        redemption.refund_grant_id = refund.id
    except IntegrityError:
        stmt = select(RewardGrant.id).where(
            RewardGrant.actor_email == redemption.actor_email,
            RewardGrant.quest_id == redemption.item_id,
            RewardGrant.period_key == f"f:{redemption.idempotency_key}",
        )
        redemption.refund_grant_id = (await session.execute(stmt)).scalar_one()


async def cancel(session: AsyncSession, *, actor_email: str, redemption_id: str, now: datetime | None = None) -> RewardRedemption:
    """Owner cancels a PENDING redemption; Coins come back exactly once."""
    actor = actor_email.strip().lower()
    now = now or datetime.now(timezone.utc)
    await lock_actor(session, actor)
    row = await session.get(RewardRedemption, redemption_id)
    if row is None or row.actor_email != actor:
        raise NotFound("Redemption not found")
    if row.status != STATUS_PENDING:
        raise InvalidTransition(f"Cannot cancel a {row.status} redemption")
    await _refund(session, row, now=now)
    row.status = STATUS_CANCELLED
    row.decided_by = actor
    row.decided_at = now
    await session.flush()
    return row


_TRANSITIONS = {
    STATUS_APPROVED: (STATUS_PENDING,),
    STATUS_REJECTED: (STATUS_PENDING,),
    STATUS_FULFILLED: (STATUS_APPROVED,),
}


async def decide(
    session: AsyncSession, *, approver_email: str, redemption_id: str, status: str, note: str | None, now: datetime | None = None
) -> RewardRedemption:
    """Approver moves a redemption: pending→approved|rejected, approved→fulfilled. Rejecting refunds
    exactly once. Fulfilment is a status change only — no voucher/HR system is touched."""
    approver = approver_email.strip().lower()
    if not is_approver(approver):
        raise NotAllowed("Not a reward approver")
    if status not in _TRANSITIONS:
        raise InvalidTransition(f"Unknown decision {status!r}")
    now = now or datetime.now(timezone.utc)
    owner = (await session.execute(select(RewardRedemption.actor_email).where(RewardRedemption.id == redemption_id))).scalar_one_or_none()
    if owner is None:
        raise NotFound("Redemption not found")
    await lock_actor(session, owner)
    row = await session.get(RewardRedemption, redemption_id, populate_existing=True)
    if row is None:  # pragma: no cover
        raise NotFound("Redemption not found")
    if row.status not in _TRANSITIONS[status]:
        raise InvalidTransition(f"Cannot move a {row.status} redemption to {status}")
    if status == STATUS_REJECTED:
        await _refund(session, row, now=now)
    row.status = status
    row.note = (note or "").strip()[:500] or None
    row.decided_by = approver
    row.decided_at = now
    await session.flush()
    return row


async def list_mine(session: AsyncSession, *, actor_email: str) -> list[RewardRedemption]:
    actor = actor_email.strip().lower()
    stmt = select(RewardRedemption).where(RewardRedemption.actor_email == actor).order_by(RewardRedemption.created_at.desc())
    return list((await session.execute(stmt)).scalars().all())
