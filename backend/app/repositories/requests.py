from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import ConversationParticipant
from app.models.request import ConversationRequest
from app.repositories.chat import (
    _create_group_conversation,
    add_participant_if_missing,
    find_group_by_exact_members,
    get_conversation_by_id,
)

# "Ask to join" / group-formation request repository. Plain-dict returns and savepoint-based
# conflict handling — same house style as app/repositories/chat.py (see
# _get_or_create_conversation/_add_participant_if_missing there).


def _request_to_dict(req: ConversationRequest) -> dict[str, Any]:
    return {
        "id": req.id,
        "kind": req.kind,
        "conversation_id": req.conversation_id,
        "requester_email": req.requester_email,
        "state": req.state,
        "resolver_email": req.resolver_email,
        "result_conversation_id": req.result_conversation_id,
        "payload": req.payload,
        "resolved_at": req.resolved_at,
        "created_at": req.created_at,
        "updated_at": req.updated_at,
    }


async def create_request(
    session: AsyncSession,
    *,
    kind: str,
    requester_email: str,
    conversation_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Idempotent create — matches this codebase's DM-upsert philosophy. If a pending row for
    (kind, conversation_id, requester_email) already exists, `uq_pending_request` raises
    IntegrityError on insert; re-select and return that existing row instead of raising.

    NOTE: `uq_pending_request` does NOT dedupe when conversation_id is NULL (NULL != NULL for
    unique-index purposes) — a caller creating a request with no conversation yet won't get
    DB-level idempotency here. No create-group-request flow exists yet in this stage, so that
    case isn't exercised in practice; a future stage that adds one will need its own dedupe."""
    email = requester_email.strip().lower()

    try:
        async with session.begin_nested():
            req = ConversationRequest(
                kind=kind,
                conversation_id=conversation_id,
                requester_email=email,
                payload=payload,
            )
            session.add(req)
            await session.flush()
    except IntegrityError:
        result = await session.execute(
            select(ConversationRequest).where(
                ConversationRequest.kind == kind,
                ConversationRequest.conversation_id == conversation_id,
                ConversationRequest.requester_email == email,
                ConversationRequest.state == "pending",
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
    result_conversation_id: str | None = None,
) -> bool:
    """Race-safe conditional update — only succeeds if the row is still pending at the moment of
    the UPDATE. `new_state` must be "accepted" or "declined". Returns True iff this call actually
    transitioned the row (i.e. won the race); False if it was already resolved by someone else."""
    if new_state not in ("accepted", "declined"):
        raise ValueError(f"Invalid new_state for resolve_request: {new_state!r}")

    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(ConversationRequest)
        .where(ConversationRequest.id == request_id, ConversationRequest.state == "pending")
        .values(
            state=new_state,
            resolver_email=resolver_email.strip().lower(),
            result_conversation_id=result_conversation_id,
            resolved_at=now,
            updated_at=now,
        )
    )
    changed = result.rowcount > 0
    await session.commit()
    return changed


async def accept_join_request(
    session: AsyncSession,
    *,
    request_id: str,
    conversation_id: str,
    requester_email: str,
    resolver_email: str,
) -> dict[str, Any] | None:
    """Atomic accept for a `join_group` request: conditional UPDATE (same race-safe pattern as
    `resolve_request` — only transitions a still-pending row), then branches on the target
    conversation's type, all inside ONE transaction with a single commit at the end. This closes
    the gap where resolve_request() and add_participant_if_missing() used to commit separately —
    a crash mid-way could leave a request `state=accepted` with no participant row ever added.

    If the target conversation is a DM, a 3rd person joining must NOT be added directly into
    that DM (which would silently turn a 1:1 into a 3-person conversation while keeping the same
    dm_key/history) — instead a brand-new group conversation is created with the DM's original
    participants plus the requester, and the DM itself is left completely untouched. If the
    target is already a group (or anything else), the requester is simply added as a participant
    of that same conversation, as before.

    Returns the updated request dict (whose `result_conversation_id` reflects wherever the
    requester actually landed — the new group id in the DM-upgrade case, or the original
    conversation_id otherwise), or None if the row was no longer pending (already resolved by
    someone else) — in which case nothing else was written."""
    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(ConversationRequest)
        .where(ConversationRequest.id == request_id, ConversationRequest.state == "pending")
        .values(
            state="accepted",
            resolver_email=resolver_email.strip().lower(),
            resolved_at=now,
            updated_at=now,
        )
    )
    if result.rowcount == 0:
        await session.commit()
        return None

    target = await get_conversation_by_id(session, conversation_id)
    requester = requester_email.strip().lower()

    if target is not None and target["type"] == "dm":
        members = set(target["participant_ids"]) | {requester}
        existing_gid = await find_group_by_exact_members(session, members)
        if existing_gid is not None:
            # Reuse the already-formed group for this exact member set instead of spawning a
            # redundant duplicate. requester is already in `members` (hence in the matched
            # group by exact-set equality), so this add is a defensive no-op — kept for safety.
            await add_participant_if_missing(session, existing_gid, requester)
            result_cid = existing_gid
        else:
            result_cid = await _create_group_conversation(session, members, title=None)
    else:
        # Already a group (or defensive fallback if the conversation vanished) — add the
        # requester to the existing conversation, never touch a DM here.
        await add_participant_if_missing(session, conversation_id, requester)
        result_cid = conversation_id

    await session.execute(
        update(ConversationRequest)
        .where(ConversationRequest.id == request_id)
        .values(result_conversation_id=result_cid, updated_at=now)
    )
    await session.commit()

    updated = await get_request_by_id(session, request_id)
    return updated


async def cancel_request(session: AsyncSession, *, request_id: str, requester_email: str) -> bool:
    """Requester-only cancel — race-safe against a concurrent resolve, same pattern as
    resolve_request. Returns True iff this call actually transitioned the row."""
    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(ConversationRequest)
        .where(
            ConversationRequest.id == request_id,
            ConversationRequest.requester_email == requester_email.strip().lower(),
            ConversationRequest.state == "pending",
        )
        .values(state="cancelled", resolved_at=now, updated_at=now)
    )
    changed = result.rowcount > 0
    await session.commit()
    return changed


async def list_pending_for_participant(session: AsyncSession, email: str) -> list[dict[str, Any]]:
    """Pending requests scoped to conversations `email` participates in. Requests with a NULL
    conversation_id (no create-group-request flow exists yet in this stage) are out of scope for
    this listing by construction — the join below only matches rows with a real conversation_id."""
    self_email = email.strip().lower()
    result = await session.execute(
        select(ConversationRequest)
        .join(
            ConversationParticipant,
            ConversationParticipant.conversation_id == ConversationRequest.conversation_id,
        )
        .where(
            ConversationRequest.state == "pending",
            ConversationParticipant.participant_email == self_email,
        )
        .order_by(ConversationRequest.created_at.asc())
    )
    return [_request_to_dict(req) for req in result.scalars().all()]


async def expire_stale(session: AsyncSession, *, older_than: datetime) -> int:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(ConversationRequest)
        .where(ConversationRequest.state == "pending", ConversationRequest.created_at < older_than)
        .values(state="expired", resolved_at=now, updated_at=now)
    )
    count = result.rowcount
    await session.commit()
    return count


async def get_request_by_id(session: AsyncSession, request_id: str) -> dict[str, Any] | None:
    result = await session.execute(
        select(ConversationRequest).where(ConversationRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    return _request_to_dict(req) if req is not None else None
