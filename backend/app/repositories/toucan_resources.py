from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.toucan import ToucanConversation, ToucanMemory, ToucanResource

# Toucan T4 — resource REFERENCES, not files. This repository persists metadata about things
# that live elsewhere (a URL today; an object-storage key once that layer exists — the codebase
# has none at T4). It cannot store content: the model has no byte column, `locator` is bounded
# at 1024 chars, and the request schema forbids extra fields, so there is no path by which a
# file body — base64'd or otherwise — can end up in SQLite.
#
# Ownership works exactly as in repositories/toucan.py and toucan_memory.py: every reachable row
# is reached through a query that filters on owner_email. The optional links to a conversation
# or a memory are verified against the SAME owner before a resource row is written, so a
# resource can never point into somebody else's data — a foreign id is simply "not found".

MAX_RESOURCES_RETURNED = 50
DEFAULT_RESOURCES_RETURNED = 25
MAX_DISPLAY_NAME_CHARS = 255
MAX_LOCATOR_CHARS = 1024
MAX_MEDIA_TYPE_CHARS = 127


def normalize_email(email: str) -> str:
    return email.strip().lower()


def resource_to_dict(resource: ToucanResource) -> dict[str, Any]:
    return {
        "id": resource.id,
        "conversation_id": resource.conversation_id,
        "memory_id": resource.memory_id,
        "display_name": resource.display_name,
        "locator": resource.locator,
        "media_type": resource.media_type,
        "created_at": resource.created_at,
        "updated_at": resource.updated_at,
    }


async def _owns_conversation(
    session: AsyncSession, *, conversation_id: str, owner_email: str
) -> bool:
    result = await session.execute(
        select(ToucanConversation.id).where(
            ToucanConversation.id == conversation_id,
            ToucanConversation.owner_email == owner_email,
        )
    )
    return result.scalar_one_or_none() is not None


async def _owns_memory(session: AsyncSession, *, memory_id: str, owner_email: str) -> bool:
    result = await session.execute(
        select(ToucanMemory.id).where(
            ToucanMemory.id == memory_id,
            ToucanMemory.owner_email == owner_email,
        )
    )
    return result.scalar_one_or_none() is not None


async def create_resource(
    session: AsyncSession,
    *,
    owner_email: str,
    display_name: str,
    locator: str | None = None,
    media_type: str | None = None,
    conversation_id: str | None = None,
    memory_id: str | None = None,
) -> dict[str, Any] | None:
    """Register one reference for the caller. Returns None — which the router turns into 404 —
    when either optional link names a conversation/memory the caller does not own; "somebody
    else's" and "nonexistent" are the same answer, as everywhere in Toucan."""
    email = normalize_email(owner_email)
    if conversation_id is not None and not await _owns_conversation(
        session, conversation_id=conversation_id, owner_email=email
    ):
        return None
    if memory_id is not None and not await _owns_memory(
        session, memory_id=memory_id, owner_email=email
    ):
        return None

    row = ToucanResource(
        owner_email=email,
        conversation_id=conversation_id,
        memory_id=memory_id,
        display_name=display_name[:MAX_DISPLAY_NAME_CHARS],
        locator=locator[:MAX_LOCATOR_CHARS] if locator else None,
        media_type=media_type[:MAX_MEDIA_TYPE_CHARS] if media_type else None,
    )
    session.add(row)
    await session.flush()
    return resource_to_dict(row)


async def list_resources(
    session: AsyncSession, *, owner_email: str, limit: int = DEFAULT_RESOURCES_RETURNED
) -> list[dict[str, Any]]:
    capped = max(1, min(limit, MAX_RESOURCES_RETURNED))
    result = await session.execute(
        select(ToucanResource)
        .where(ToucanResource.owner_email == normalize_email(owner_email))
        .order_by(ToucanResource.created_at.desc(), ToucanResource.id.desc())
        .limit(capped)
    )
    return [resource_to_dict(r) for r in result.scalars().all()]


async def delete_resource(
    session: AsyncSession, *, resource_id: str, owner_email: str
) -> bool:
    result = await session.execute(
        select(ToucanResource).where(
            ToucanResource.id == resource_id,
            ToucanResource.owner_email == normalize_email(owner_email),
        )
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        return False
    await session.delete(resource)
    await session.flush()
    return True
