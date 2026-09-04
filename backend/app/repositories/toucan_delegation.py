from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.toucan import ToucanDelegation
from app.services.toucan.delegation import (
    DELEGATION_MAX_MINUTES,
    END_AT_TIME,
    END_UNTIL_RETURN,
    SCOPE_DM,
    clamp_duration,
)

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

ENDED_EXPIRED = "expired"
ENDED_CANCELLED = "cancelled"
ENDED_REPLACED = "replaced"
ENDED_RETURNED = "returned"

# A2.2 — an optional async hook every ending goes through (expired, replaced, cancelled), so the
# realtime layer can tell the OWNER without this module importing it. Storage stays authoritative;
# the hook only observes.
EndedHook = Callable[[ToucanDelegation], Awaitable[None]] | None


async def _notify(on_ended: EndedHook, rows: list[ToucanDelegation]) -> None:
    if on_ended is None:
        return
    for row in rows:
        await on_ended(row)


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


async def _end(session: AsyncSession, delegation: ToucanDelegation, *, reason: str, now: datetime) -> bool:
    """End a row ATOMICALLY: one conditional UPDATE that only wins while the row is still active.
    Two lifecycle paths discovering the same expiry (a sweep tick and a lazy read, say) therefore
    produce ONE ending and ONE delegation_ended — the loser sees rowcount 0 and stays silent."""
    result = await session.execute(
        update(ToucanDelegation)
        .where(ToucanDelegation.id == delegation.id, ToucanDelegation.status == DELEGATION_ACTIVE)
        .values(status=DELEGATION_ENDED, ended_at=now, ended_reason=reason)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        return False
    delegation.status = DELEGATION_ENDED
    delegation.ended_at = now
    delegation.ended_reason = reason
    return True


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


async def _live_rows(
    session: AsyncSession, owners: Iterable[str], now: datetime, on_ended: EndedHook = None
) -> list[ToucanDelegation]:
    """Active rows that are ALSO within their window. Stale ones are ended in place (lazy
    expiry) and committed, so the next reader — or the next process — sees the same truth."""
    now = _as_aware_utc(now)
    rows = await _active_rows(session, owners)
    live: list[ToucanDelegation] = []
    expired: list[ToucanDelegation] = []
    for row in rows:
        if is_expired(row, now):
            if await _end(session, row, reason=ENDED_EXPIRED, now=now):
                expired.append(row)
        else:
            live.append(row)
    if expired:
        await session.commit()
        await _notify(on_ended, expired)
    return live


async def get_active_delegation(
    session: AsyncSession, *, owner_email: str, now: datetime | None = None, on_ended: EndedHook = None
) -> ToucanDelegation | None:
    """This owner's one active, unexpired delegation, or None."""
    live = await _live_rows(session, [owner_email], now or _utc_now(), on_ended)
    return live[0] if live else None


async def active_delegations_for_owners(
    session: AsyncSession, owners: Iterable[str], *, now: datetime | None = None, on_ended: EndedHook = None
) -> list[ToucanDelegation]:
    """The live delegations among a conversation's participants — what the DM/group trigger asks."""
    return await _live_rows(session, owners, now or _utc_now(), on_ended)


async def start_delegation(
    session: AsyncSession,
    *,
    owner_email: str,
    duration_minutes: int | None = None,
    ends_at: datetime | None = None,
    end_condition: str = END_AT_TIME,
    scope: str = SCOPE_DM,
    now: datetime | None = None,
    on_ended: EndedHook = None,
) -> tuple[ToucanDelegation, bool]:
    """Create the owner's active delegation, ending any previous active one first (reason
    "replaced"). Returns (row, replaced_previous).

    Three windows, one hard cap: `hard_cap_at` is ALWAYS now + DELEGATION_MAX_MINUTES.
      * duration_minutes → at_time, expires_at = now + clamped duration
      * ends_at (UTC)    → at_time, expires_at = min(ends_at, hard cap); an end already behind
                           `now` raises ValueError — the caller refuses rather than guesses
      * until_return     → expires_at None; only a return signal or the hard cap ends it"""
    owner = normalize_email(owner_email)
    current = _as_aware_utc(now) or _utc_now()
    hard_cap_at = current + timedelta(minutes=DELEGATION_MAX_MINUTES)
    if end_condition == END_UNTIL_RETURN:
        expires_at: datetime | None = None
    elif ends_at is not None:
        expires_at = min(_as_aware_utc(ends_at), hard_cap_at)
        if expires_at <= current:
            raise ValueError("delegation end time has already passed")
    elif duration_minutes is not None:
        expires_at = current + timedelta(minutes=clamp_duration(int(duration_minutes)))
    else:
        raise ValueError("an at_time delegation needs a duration or an end time")
    replaced_rows = []
    for previous in await _active_rows(session, [owner]):
        if await _end(session, previous, reason=ENDED_REPLACED, now=current):
            replaced_rows.append(previous)
    replaced = bool(replaced_rows)
    row = ToucanDelegation(
        owner_email=owner,
        status=DELEGATION_ACTIVE,
        end_condition=end_condition,
        scope=scope,
        starts_at=current,
        expires_at=expires_at,
        hard_cap_at=hard_cap_at,
        reply_count=0,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    await _notify(on_ended, replaced_rows)
    return row, replaced


async def end_delegation(
    session: AsyncSession,
    *,
    owner_email: str,
    reason: str = ENDED_CANCELLED,
    now: datetime | None = None,
    on_ended: EndedHook = None,
) -> ToucanDelegation | None:
    """End the owner's active delegation (manual cancel by default). Returns the ended row, or
    None when nothing was active — an already-expired row is reported as None too, having been
    ended with its own reason by the lazy check."""
    current = now or _utc_now()
    live = await _live_rows(session, [owner_email], current, on_ended)
    if not live:
        return None
    row = live[0]
    if not await _end(session, row, reason=reason, now=current):
        return None
    await session.commit()
    await session.refresh(row)
    await _notify(on_ended, [row])
    return row


async def end_until_return_for_owner(
    session: AsyncSession, *, owner_email: str, now: datetime | None = None, on_ended: EndedHook = None
) -> ToucanDelegation | None:
    """THE ONE RETURN PATH. Every signal that the owner is back (a chat message they sent, a
    Toucan question, an explicit check-in, a reconnect after a proven absence) lands here: end
    the owner's live delegation with reason "returned" — but ONLY an until_return one. A timed
    delegation is left alone: the owner asked for a window, not for presence tracking."""
    current = _as_aware_utc(now) or _utc_now()
    live = await _live_rows(session, [owner_email], current, on_ended)
    targets = [row for row in live if row.end_condition == END_UNTIL_RETURN]
    if not targets:
        return None
    row = targets[0]
    if not await _end(session, row, reason=ENDED_RETURNED, now=current):
        return None
    await session.commit()
    await session.refresh(row)
    await _notify(on_ended, [row])
    return row


async def expire_stale_delegations(
    session: AsyncSession, *, now: datetime | None = None, on_ended: EndedHook = None, limit: int = 500
) -> list[ToucanDelegation]:
    """The periodic sweep's one query: every ACTIVE row, checked against the clock in Python (the
    same is_expired the lazy path uses, so the two walls can never disagree). Ends the stale
    ones atomically and reports each once. Safe on an empty table."""
    current = _as_aware_utc(now) or _utc_now()
    result = await session.execute(
        select(ToucanDelegation).where(ToucanDelegation.status == DELEGATION_ACTIVE).limit(limit)
    )
    ended: list[ToucanDelegation] = []
    for row in result.scalars().all():
        if is_expired(row, current) and await _end(session, row, reason=ENDED_EXPIRED, now=current):
            ended.append(row)
    if ended:
        await session.commit()
        await _notify(on_ended, ended)
    return ended


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
