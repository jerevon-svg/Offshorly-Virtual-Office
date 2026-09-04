from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.toucan import ToucanDelegation
from app.services.toucan.delegation import SCOPE_DM, clamp_duration

# Toucan A2.1 — delegation persistence. Same house rule as every other Toucan repository: every
# lookup that can reach a delegation takes `owner_email` (or an explicit participant list) and
# filters on it in the same SELECT. Someone else's delegation behaves exactly like a missing one.
#
# LAZY EXPIRY IS THE ONLY EXPIRY at A2.1: there is no sweeper. Every read that could return an
# active row first compares it against `now`; a stale row is marked ended (reason "expired")
# right there and reported as absent. Because the row is durable, a restart changes nothing —
# the same comparison produces the same answer on the next read.

DELEGATION_ACTIVE = "active"
DELEGATION_ENDED = "ended"

END_AT_TIME = "at_time"

ENDED_EXPIRED = "expired"
ENDED_CANCELLED = "cancelled"
ENDED_REPLACED = "replaced"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(dt: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes for DateTime(timezone=True) columns; Postgres hands
    back aware ones. Same normalization the other repositories apply."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_expired(delegation: ToucanDelegation, now: datetime) -> bool:
    expires_at = _as_aware_utc(delegation.expires_at)
    hard_cap_at = _as_aware_utc(delegation.hard_cap_at)
    return (expires_at is not None and now >= expires_at) or (hard_cap_at is not None and now >= hard_cap_at)


def _end(delegation: ToucanDelegation, *, reason: str, now: datetime) -> None:
    delegation.status = DELEGATION_ENDED
    delegation.ended_at = now
    delegation.ended_reason = reason


async def _active_rows(session: AsyncSession, owners: Iterable[str]) -> list[ToucanDelegation]:
    emails = sorted({normalize_email(e) for e in owners if e})
    if not emails:
        return []
    result = await session.execute(
        select(ToucanDelegation).where(
            ToucanDelegation.owner_email.in_(emails),
            ToucanDelegation.status == DELEGATION_ACTIVE,
        )
    )
    return list(result.scalars().all())


async def _live_rows(session: AsyncSession, owners: Iterable[str], now: datetime) -> list[ToucanDelegation]:
    """Active rows that are ALSO within their window. Stale ones are ended in place (lazy
    expiry) and committed, so the next reader — or the next process — sees the same truth."""
    now = _as_aware_utc(now)
    rows = await _active_rows(session, owners)
    live: list[ToucanDelegation] = []
    expired_any = False
    for row in rows:
        if is_expired(row, now):
            _end(row, reason=ENDED_EXPIRED, now=now)
            expired_any = True
        else:
            live.append(row)
    if expired_any:
        await session.commit()
    return live


async def get_active_delegation(
    session: AsyncSession, *, owner_email: str, now: datetime | None = None
) -> ToucanDelegation | None:
    """This owner's one active, unexpired delegation, or None."""
    live = await _live_rows(session, [owner_email], now or _utc_now())
    return live[0] if live else None


async def active_delegations_for_owners(
    session: AsyncSession, owners: Iterable[str], *, now: datetime | None = None
) -> list[ToucanDelegation]:
    """The live delegations among a conversation's participants — what the DM trigger asks."""
    return await _live_rows(session, owners, now or _utc_now())


async def start_delegation(
    session: AsyncSession,
    *,
    owner_email: str,
    duration_minutes: int,
    scope: str = SCOPE_DM,
    now: datetime | None = None,
) -> tuple[ToucanDelegation, bool]:
    """Create the owner's active delegation, ending any previous active one first (reason
    "replaced"). Returns (row, replaced_previous). The duration is clamped here as well as at
    parse time, so the row can never encode a window the product does not allow."""
    owner = normalize_email(owner_email)
    current = now or _utc_now()
    replaced = False
    for previous in await _active_rows(session, [owner]):
        _end(previous, reason=ENDED_REPLACED, now=current)
        replaced = True
    minutes = clamp_duration(int(duration_minutes))
    row = ToucanDelegation(
        owner_email=owner,
        status=DELEGATION_ACTIVE,
        end_condition=END_AT_TIME,
        scope=scope,
        starts_at=current,
        expires_at=current + timedelta(minutes=minutes),
        hard_cap_at=current + timedelta(minutes=clamp_duration(10**9)),
        reply_count=0,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row, replaced


async def end_delegation(
    session: AsyncSession, *, owner_email: str, reason: str = ENDED_CANCELLED, now: datetime | None = None
) -> ToucanDelegation | None:
    """End the owner's active delegation (manual cancel by default). Returns the ended row, or
    None when nothing was active — an already-expired row is reported as None too, having been
    ended with its own reason by the lazy check."""
    current = now or _utc_now()
    live = await _live_rows(session, [owner_email], current)
    if not live:
        return None
    row = live[0]
    _end(row, reason=reason, now=current)
    await session.commit()
    await session.refresh(row)
    return row


async def record_reply(session: AsyncSession, delegation: ToucanDelegation) -> None:
    delegation.reply_count = (delegation.reply_count or 0) + 1
    await session.commit()


async def list_delegations(session: AsyncSession, *, owner_email: str) -> list[ToucanDelegation]:
    """Audit view: every delegation this owner ever had, newest first."""
    result = await session.execute(
        select(ToucanDelegation)
        .where(ToucanDelegation.owner_email == normalize_email(owner_email))
        .order_by(ToucanDelegation.starts_at.desc())
    )
    return list(result.scalars().all())
