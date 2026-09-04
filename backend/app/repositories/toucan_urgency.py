from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.toucan import ToucanDelegation, ToucanUrgentFlag

# Toucan A3 — urgency flag persistence. Same house rule as every other Toucan repository: every
# read that can reach a flag takes `owner_email` and filters on it in the same SELECT. Somebody
# else's flags behave exactly like none.
#
# IDEMPOTENT BY SCHEMA: the unique index on (delegation, conversation, requester) means the
# second "yes" is the same flag as the first. record_urgent_flag reports whether it CREATED the
# row, so the caller sends its confirmation and its owner event once, never twice — including
# when two evaluations of two rapid messages race, where the loser hits the constraint and simply
# re-reads the winner's row.


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def _find(
    session: AsyncSession, *, delegation_id: str, conversation_id: str, requester_email: str
) -> ToucanUrgentFlag | None:
    result = await session.execute(
        select(ToucanUrgentFlag).where(
            ToucanUrgentFlag.delegation_id == delegation_id,
            ToucanUrgentFlag.conversation_id == conversation_id,
            ToucanUrgentFlag.requester_email == requester_email,
        )
    )
    return result.scalar_one_or_none()


async def record_urgent_flag(
    session: AsyncSession,
    *,
    delegation: ToucanDelegation,
    conversation_id: str,
    requester_email: str,
    message_reference: str | None = None,
    now: datetime | None = None,
) -> tuple[ToucanUrgentFlag, bool]:
    """Record that `requester_email` declared their message in `conversation_id` urgent while
    `delegation` was covering its owner. Returns (row, created). Never stores content."""
    requester = normalize_email(requester_email)
    existing = await _find(
        session, delegation_id=delegation.id, conversation_id=conversation_id, requester_email=requester
    )
    if existing is not None:
        return existing, False
    row = ToucanUrgentFlag(
        delegation_id=delegation.id,
        owner_email=normalize_email(delegation.owner_email),
        conversation_id=conversation_id,
        requester_email=requester,
        message_reference=message_reference,
        flagged_at=_as_aware_utc(now) or _utc_now(),
        seen_at=None,
    )
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent evaluation won the unique index. Its row is the flag; nothing new happened.
        await session.rollback()
        winner = await _find(
            session, delegation_id=delegation.id, conversation_id=conversation_id, requester_email=requester
        )
        if winner is None:  # pragma: no cover — defensive; the constraint implies a winner exists
            raise
        return winner, False
    await session.refresh(row)
    return row, True


async def count_unseen_for_delegation(session: AsyncSession, *, delegation_id: str, owner_email: str) -> int:
    """The number the owner's banner shows: this delegation's flags the owner has not opened."""
    result = await session.execute(
        select(func.count())
        .select_from(ToucanUrgentFlag)
        .where(
            ToucanUrgentFlag.delegation_id == delegation_id,
            ToucanUrgentFlag.owner_email == normalize_email(owner_email),
            ToucanUrgentFlag.seen_at.is_(None),
        )
    )
    return int(result.scalar_one() or 0)


async def count_unseen_for_owner(session: AsyncSession, *, owner_email: str) -> int:
    """Every unseen flag this owner has, across delegations — what the attention digest counts."""
    result = await session.execute(
        select(func.count())
        .select_from(ToucanUrgentFlag)
        .where(ToucanUrgentFlag.owner_email == normalize_email(owner_email), ToucanUrgentFlag.seen_at.is_(None))
    )
    return int(result.scalar_one() or 0)


async def list_unseen(session: AsyncSession, *, owner_email: str, limit: int = 50) -> list[ToucanUrgentFlag]:
    """This owner's unseen flags, newest first — the return card."""
    result = await session.execute(
        select(ToucanUrgentFlag)
        .where(ToucanUrgentFlag.owner_email == normalize_email(owner_email), ToucanUrgentFlag.seen_at.is_(None))
        .order_by(ToucanUrgentFlag.flagged_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def mark_seen(
    session: AsyncSession, *, owner_email: str, flag_ids: list[str] | None = None, now: datetime | None = None
) -> int:
    """Mark this owner's unseen flags seen — the given ids, or all of them when `flag_ids` is None.
    Ids belonging to another owner are ignored, not errors. Returns how many rows changed."""
    conditions = [ToucanUrgentFlag.owner_email == normalize_email(owner_email), ToucanUrgentFlag.seen_at.is_(None)]
    if flag_ids is not None:
        ids = [i for i in flag_ids if i]
        if not ids:
            return 0
        conditions.append(ToucanUrgentFlag.id.in_(ids))
    result = await session.execute(
        update(ToucanUrgentFlag)
        .where(*conditions)
        .values(seen_at=_as_aware_utc(now) or _utc_now())
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    return int(result.rowcount or 0)


def flag_to_dict(row: ToucanUrgentFlag) -> dict:
    return {
        "id": row.id,
        "delegation_id": row.delegation_id,
        "conversation_id": row.conversation_id,
        "requester_email": row.requester_email,
        "flagged_at": _as_aware_utc(row.flagged_at),
        "seen_at": _as_aware_utc(row.seen_at),
    }
