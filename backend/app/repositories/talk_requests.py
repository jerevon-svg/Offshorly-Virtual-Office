from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.talk_request import TalkRequest
from app.services.dnd_policy import DECLINE_COOLDOWN_SECONDS

# "Request Permission to Talk" repository — plain-dict returns and savepoint-based conflict
# handling, same house style as app/repositories/room_requests.py.


def _request_to_dict(req: TalkRequest) -> dict[str, Any]:
    return {
        "id": req.id,
        "target_email": req.target_email,
        "requester_email": req.requester_email,
        "kind": req.kind,
        "state": req.state,
        "resolver_email": req.resolver_email,
        "resolved_at": req.resolved_at,
        "created_at": req.created_at,
        "updated_at": req.updated_at,
    }


async def get_cooldown_until(
    session: AsyncSession, *, target_email: str, requester_email: str
) -> datetime | None:
    """Anti-spam: if this exact (target, requester) pair's most recent request was DECLINED
    within the last DECLINE_COOLDOWN_SECONDS, returns the moment the cooldown lifts
    (resolved_at + cooldown) — server-authoritative, so the frontend can derive a countdown
    locally without polling. Returns None if there's no active cooldown."""
    result = await session.execute(
        select(TalkRequest)
        .where(
            TalkRequest.target_email == target_email,
            TalkRequest.requester_email == requester_email,
            TalkRequest.state == "declined",
        )
        .order_by(TalkRequest.resolved_at.desc())
        .limit(1)
    )
    last_decline = result.scalar_one_or_none()
    if last_decline is None or last_decline.resolved_at is None:
        return None

    cooldown_until = last_decline.resolved_at + timedelta(seconds=DECLINE_COOLDOWN_SECONDS)
    now = datetime.now(timezone.utc)
    resolved_at = last_decline.resolved_at
    if resolved_at.tzinfo is None:
        resolved_at = resolved_at.replace(tzinfo=timezone.utc)
        cooldown_until = resolved_at + timedelta(seconds=DECLINE_COOLDOWN_SECONDS)
    return cooldown_until if cooldown_until > now else None


async def create_request(
    session: AsyncSession,
    *,
    target_email: str,
    requester_email: str,
    kind: str,
) -> dict[str, Any]:
    """Idempotent create — mirrors room_requests_repo.create_request. If a pending row for
    (target_email, requester_email) already exists, `uq_pending_talk_request` raises
    IntegrityError on insert; re-select and return that existing row instead of raising, so a
    duplicate "Request Permission to Talk" click never creates a second pending request."""
    target = target_email.strip().lower()
    requester = requester_email.strip().lower()

    try:
        async with session.begin_nested():
            req = TalkRequest(target_email=target, requester_email=requester, kind=kind)
            session.add(req)
            await session.flush()
    except IntegrityError:
        result = await session.execute(
            select(TalkRequest).where(
                TalkRequest.target_email == target,
                TalkRequest.requester_email == requester,
                TalkRequest.state == "pending",
            )
        )
        req = result.scalar_one_or_none()
        if req is None:
            raise
        await session.commit()
        return _request_to_dict(req)

    await session.commit()
    return _request_to_dict(req)


async def resolve_request(
    session: AsyncSession,
    *,
    request_id: str,
    resolver_email: str,
    new_state: str,
) -> bool:
    """Race-safe conditional update — mirrors room_requests_repo.resolve_request. Returns True
    iff this call actually transitioned the row."""
    if new_state not in ("accepted", "declined", "cancelled"):
        raise ValueError(f"Invalid new_state for resolve_request: {new_state!r}")

    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(TalkRequest)
        .where(TalkRequest.id == request_id, TalkRequest.state == "pending")
        .values(
            state=new_state,
            resolver_email=resolver_email.strip().lower() if resolver_email else None,
            resolved_at=now,
            updated_at=now,
        )
    )
    changed = result.rowcount > 0
    await session.commit()
    return changed


async def cancel_request(session: AsyncSession, *, request_id: str, requester_email: str) -> bool:
    """Requester-only cancel — race-safe against a concurrent resolve."""
    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(TalkRequest)
        .where(
            TalkRequest.id == request_id,
            TalkRequest.requester_email == requester_email.strip().lower(),
            TalkRequest.state == "pending",
        )
        .values(state="cancelled", resolved_at=now, updated_at=now)
    )
    changed = result.rowcount > 0
    await session.commit()
    return changed


async def cancel_pending_for_target(session: AsyncSession, *, target_email: str) -> list[dict[str, Any]]:
    """Cancels every still-pending request targeting `target_email` (e.g. they turned DND off —
    any outstanding "request permission to talk" against them is now moot). Returns the requests
    that were actually transitioned, so callers can notify each requester."""
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(TalkRequest).where(TalkRequest.target_email == target_email, TalkRequest.state == "pending")
    )
    pending = result.scalars().all()
    if not pending:
        return []

    await session.execute(
        update(TalkRequest)
        .where(TalkRequest.target_email == target_email, TalkRequest.state == "pending")
        .values(state="cancelled", resolved_at=now, updated_at=now)
    )
    await session.commit()

    return [
        {**_request_to_dict(req), "state": "cancelled", "resolved_at": now, "resolver_email": None}
        for req in pending
    ]


async def list_pending_for_target(session: AsyncSession, target_email: str) -> list[dict[str, Any]]:
    result = await session.execute(
        select(TalkRequest)
        .where(TalkRequest.target_email == target_email, TalkRequest.state == "pending")
        .order_by(TalkRequest.created_at.asc())
    )
    return [_request_to_dict(req) for req in result.scalars().all()]


async def get_request_by_id(session: AsyncSession, request_id: str) -> dict[str, Any] | None:
    result = await session.execute(select(TalkRequest).where(TalkRequest.id == request_id))
    req = result.scalar_one_or_none()
    return _request_to_dict(req) if req is not None else None
