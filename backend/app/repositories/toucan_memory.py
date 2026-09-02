from __future__ import annotations

from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.toucan import ToucanMemory, ToucanResource

# Toucan T4 — important memory persistence. Same house style and same one rule as
# repositories/toucan.py: every lookup that can reach a memory takes `owner_email` and filters
# on it in the same SELECT. There is no get_memory_by_id(session, id) to reach for by accident;
# the only way to touch a memory is to prove ownership in the query itself. Someone else's id
# behaves exactly like a missing one.
#
# WHAT THIS MODULE WILL NOT DO, by design: extract memories from anything. Its only writers are
# the explicit remember/save chat command and POST /toucan/memories — both carry text the user
# typed as a deliberate act of saving. No function here reads conversations, messages, office
# context or anything else it could "learn" from.

# Server-side caps — the authority, as always. MEMORY_ANSWER_LIMIT bounds the chat answer to
# "What do you remember?" (recent memories, newest first); MAX_MEMORIES_RETURNED bounds the REST
# list. Both exist so a hoarder's memory list can never turn one request into an unbounded scan
# or payload.
MAX_MEMORY_CONTENT_CHARS = 1000
MAX_MEMORIES_RETURNED = 50
DEFAULT_MEMORIES_RETURNED = 25
MEMORY_ANSWER_LIMIT = 20

# Python-layer vocabulary, same convention as ToucanMessage.role.
MEMORY_KINDS = ("fact", "note")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def content_key(content: str) -> str:
    """The equality key "forget that X" matches on: whitespace-collapsed, casefolded, trailing
    sentence punctuation dropped. DETERMINISTIC exact matching, not fuzzy similarity — "forget
    that the demo is friday" deletes the memory saved as "the demo is Friday." and nothing that
    merely resembles it. Deleting the wrong memory silently would be far worse than asking the
    user to repeat the exact wording."""
    collapsed = " ".join(content.split())
    return collapsed.casefold().rstrip(".!")


def _clamp(content: str) -> str:
    return content[:MAX_MEMORY_CONTENT_CHARS]


def memory_to_dict(memory: ToucanMemory) -> dict[str, Any]:
    return {
        "id": memory.id,
        "kind": memory.kind,
        "content": memory.content,
        "created_at": memory.created_at,
        "updated_at": memory.updated_at,
    }


async def save_memory(
    session: AsyncSession, *, owner_email: str, content: str, kind: str = "note"
) -> dict[str, Any]:
    """One explicit memory for the caller. `content` is the user's own words, verbatim apart
    from the size clamp; `kind` falls back to "note" rather than erroring so a future command
    wording cannot brick saving by inventing a label."""
    row = ToucanMemory(
        owner_email=normalize_email(owner_email),
        kind=kind if kind in MEMORY_KINDS else "note",
        content=_clamp(content),
    )
    session.add(row)
    await session.flush()
    return memory_to_dict(row)


async def list_memories(
    session: AsyncSession, *, owner_email: str, limit: int = DEFAULT_MEMORIES_RETURNED
) -> list[dict[str, Any]]:
    """The caller's own memories, newest first, bounded."""
    capped = max(1, min(limit, MAX_MEMORIES_RETURNED))
    result = await session.execute(
        select(ToucanMemory)
        .where(ToucanMemory.owner_email == normalize_email(owner_email))
        .order_by(ToucanMemory.created_at.desc(), ToucanMemory.id.desc())
        .limit(capped)
    )
    return [memory_to_dict(m) for m in result.scalars().all()]


async def _sever_resource_links(session: AsyncSession, memory_ids: list[str]) -> None:
    """Detach any of the owner's resources pointing at these memories. Explicit rather than
    relying on the FK's ON DELETE SET NULL — SQLite here runs without PRAGMA foreign_keys, same
    reasoning as delete_conversation's explicit child delete."""
    if not memory_ids:
        return
    await session.execute(
        update(ToucanResource)
        .where(ToucanResource.memory_id.in_(memory_ids))
        .values(memory_id=None)
    )


async def delete_memory(session: AsyncSession, *, memory_id: str, owner_email: str) -> bool:
    """ID-addressed, ownership-proved delete. False covers both "no such memory" and "belongs to
    somebody else" — indistinguishable on purpose, and the router turns both into 404."""
    result = await session.execute(
        select(ToucanMemory).where(
            ToucanMemory.id == memory_id,
            ToucanMemory.owner_email == normalize_email(owner_email),
        )
    )
    memory = result.scalar_one_or_none()
    if memory is None:
        return False
    await _sever_resource_links(session, [memory.id])
    await session.delete(memory)
    await session.flush()
    return True


async def forget_by_content(
    session: AsyncSession, *, owner_email: str, content: str
) -> int:
    """The chat command's delete: remove every one of the CALLER'S memories whose content_key
    equals the given text's, and report how many went. Exact-key equality over the caller's own
    rows only — never a substring, never a similarity score, never anyone else's rows. Multiple
    matches are literal duplicates of the same saved sentence, so deleting all of them is what
    the user meant."""
    key = content_key(content)
    if not key:
        return 0
    result = await session.execute(
        select(ToucanMemory).where(ToucanMemory.owner_email == normalize_email(owner_email))
    )
    doomed = [m for m in result.scalars().all() if content_key(m.content) == key]
    if not doomed:
        return 0
    ids = [m.id for m in doomed]
    await _sever_resource_links(session, ids)
    await session.execute(delete(ToucanMemory).where(ToucanMemory.id.in_(ids)))
    await session.flush()
    return len(ids)
