from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room_request import RoomEntryRequest

# "Request Entry / Knock" repository — plain-dict returns and savepoint-based conflict handling,
# same house style as app/repositories/requests.py (see create_request there for the identical
# idempotent-create pattern this mirrors).


def _request_to_dict(req: RoomEntryRequest) -> dict[str, Any]:
    return {
        "id": req.id,
        "room_id": req.room_id,
        "requester_email": req.requester_email,
        "state": req.state,
        "resolver_email": req.resolver_email,
        "resolved_at": req.resolved_at,
        "created_at": req.created_at,
        "updated_at": req.updated_at,
    }


async def create_request(
    session: AsyncSession,
    *,
    room_id: str,
    requester_email: str,
) -> dict[str, Any]:
    """Idempotent create — mirrors requests_repo.create_request. If a pending row for
    (room_id, requester_email) already exists, `uq_pending_room_request` raises IntegrityError on
    insert; re-select and return that existing row instead of raising, so a duplicate Knock never
    creates a second pending request (see feature spec's duplicate-request edge case)."""
    email = requester_email.strip().lower()

    try:
        async with session.begin_nested():
            req = RoomEntryRequest(room_id=room_id, requester_email=email)
            session.add(req)
            await session.flush()
    except IntegrityError:
        result = await session.execute(
            select(RoomEntryRequest).where(
                RoomEntryRequest.room_id == room_id,
                RoomEntryRequest.requester_email == email,
                RoomEntryRequest.state == "pending",
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
    """Race-safe conditional update — only succeeds if the row is still pending at the moment of
    the UPDATE. Mirrors requests_repo.resolve_request. Returns True iff this call actually
    transitioned the row (won the race against a second occupant resolving concurrently)."""
    if new_state not in ("accepted", "declined", "cancelled"):
        raise ValueError(f"Invalid new_state for resolve_request: {new_state!r}")

    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(RoomEntryRequest)
        .where(RoomEntryRequest.id == request_id, RoomEntryRequest.state == "pending")
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
    """Requester-only cancel — race-safe against a concurrent resolve, same pattern as
    requests_repo.cancel_request."""
    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(RoomEntryRequest)
        .where(
            RoomEntryRequest.id == request_id,
            RoomEntryRequest.requester_email == requester_email.strip().lower(),
            RoomEntryRequest.state == "pending",
        )
        .values(state="cancelled", resolved_at=now, updated_at=now)
    )
    changed = result.rowcount > 0
    await session.commit()
    return changed


async def cancel_pending_for_room(session: AsyncSession, *, room_id: str) -> list[dict[str, Any]]:
    """Cancels every still-pending request targeting `room_id` (e.g. the room became unlocked —
    every remaining DND occupant left or turned DND off — while a request was outstanding; see
    feature spec's "room becomes unlocked while request is pending" edge case). Returns the
    requests that were actually transitioned, so callers can fan out a cancellation notice to
    each requester."""
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(RoomEntryRequest).where(
            RoomEntryRequest.room_id == room_id, RoomEntryRequest.state == "pending"
        )
    )
    pending = result.scalars().all()
    if not pending:
        return []

    await session.execute(
        update(RoomEntryRequest)
        .where(
            RoomEntryRequest.room_id == room_id,
            RoomEntryRequest.state == "pending",
        )
        .values(state="cancelled", resolved_at=now, updated_at=now)
    )
    await session.commit()

    return [
        {**_request_to_dict(req), "state": "cancelled", "resolved_at": now, "resolver_email": None}
        for req in pending
    ]


async def list_pending_for_room(session: AsyncSession, room_id: str) -> list[dict[str, Any]]:
    result = await session.execute(
        select(RoomEntryRequest)
        .where(RoomEntryRequest.room_id == room_id, RoomEntryRequest.state == "pending")
        .order_by(RoomEntryRequest.created_at.asc())
    )
    return [_request_to_dict(req) for req in result.scalars().all()]


async def get_request_by_id(session: AsyncSession, request_id: str) -> dict[str, Any] | None:
    result = await session.execute(
        select(RoomEntryRequest).where(RoomEntryRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    return _request_to_dict(req) if req is not None else None
