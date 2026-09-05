from __future__ import annotations

from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.whiteboard import Whiteboard

# Whiteboard W1/W2 persistence. Authorization is NOT done here — every function trusts its
# arguments; the router pairs each call with chat_repo.is_participant on the board's
# conversation (same split as message reactions).


def _summary(row: Whiteboard) -> dict[str, Any]:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "title": row.title,
        "version": row.version,
        "created_by_email": row.created_by_email,
        "updated_by_email": row.updated_by_email,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _full(row: Whiteboard) -> dict[str, Any]:
    return {**_summary(row), "document": row.document}


async def list_for_conversation(session: AsyncSession, conversation_id: str) -> list[dict[str, Any]]:
    """Summaries only (no document) — newest first, id as a deterministic tiebreak."""
    stmt = (
        select(Whiteboard)
        .where(Whiteboard.conversation_id == conversation_id)
        .order_by(Whiteboard.updated_at.desc(), Whiteboard.id)
    )
    return [_summary(r) for r in (await session.execute(stmt)).scalars().all()]


async def get_by_id(session: AsyncSession, board_id: str) -> dict[str, Any] | None:
    row = await session.get(Whiteboard, board_id)
    return _full(row) if row is not None else None


async def create(
    session: AsyncSession, *, conversation_id: str, title: str, creator_email: str
) -> dict[str, Any]:
    email = creator_email.strip().lower()
    row = Whiteboard(
        conversation_id=conversation_id,
        title=title,
        document=None,
        version=1,
        created_by_email=email,
        updated_by_email=email,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _full(row)


async def save_document(
    session: AsyncSession,
    *,
    board_id: str,
    document: dict[str, Any],
    expected_version: int,
    editor_email: str,
) -> dict[str, Any] | None:
    """Optimistic save: only lands when the stored version equals `expected_version`, then bumps
    it. Returns the fresh row, or None when the version did not match (caller answers 409 —
    the board itself is known to exist because the router already loaded it for the access
    check). Last-write-wins-with-detection is all W1/W2 needs; realtime merge is W3."""
    stmt = (
        update(Whiteboard)
        .where(Whiteboard.id == board_id, Whiteboard.version == expected_version)
        .values(
            document=document,
            version=expected_version + 1,
            updated_by_email=editor_email.strip().lower(),
        )
    )
    result = await session.execute(stmt)
    if result.rowcount != 1:
        await session.rollback()
        return None
    await session.commit()
    row = await session.get(Whiteboard, board_id)
    await session.refresh(row)
    return _full(row)
