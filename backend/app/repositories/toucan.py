from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.toucan import ToucanConversation, ToucanMessage, ToucanResource

# Toucan T1 persistence — plain-dict returns, same house style as repositories/talk_requests.py.
#
# THE ONE RULE THIS MODULE EXISTS TO ENFORCE: every lookup that can reach a conversation takes
# `owner_email` and filters on it in the same SELECT. There is deliberately no
# `get_conversation_by_id(session, id)` for a router to reach for by accident — the only way to
# obtain a conversation is to prove ownership in the query itself. A caller asking for someone
# else's id gets None, which the router turns into a 404 (not a 403: a 403 would confirm the id
# exists, which is itself a leak).

# Server-side caps. These are the authority — the client's own limits are a convenience so it
# does not eat a 422, never a substitute for these.
MAX_STORED_CONTENT_CHARS = 4000
MAX_CONVERSATIONS_RETURNED = 50
DEFAULT_CONVERSATIONS_RETURNED = 20
MAX_MESSAGES_RETURNED = 200
TITLE_CHARS = 60


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def derive_title(first_user_message: str) -> str:
    """A conversation's label is the opening question, whitespace-collapsed and cut to
    TITLE_CHARS. Pure string slicing of text the user typed themselves — no summarizer, no
    model, nothing derived from office context."""
    collapsed = " ".join(first_user_message.split())
    if len(collapsed) <= TITLE_CHARS:
        return collapsed
    return collapsed[: TITLE_CHARS - 1].rstrip() + "…"


def _clamp(content: str) -> str:
    """Last line of defence on stored size. The question is already bounded by the request
    schema; the answer is server-generated and short. This exists so no future answer path can
    write an unbounded blob into the transcript."""
    return content[:MAX_STORED_CONTENT_CHARS]


def conversation_to_dict(conv: ToucanConversation) -> dict[str, Any]:
    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at,
        "updated_at": conv.updated_at,
    }


def message_to_dict(msg: ToucanMessage) -> dict[str, Any]:
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "role": msg.role,
        "content": msg.content,
        "created_at": msg.created_at,
    }


async def create_conversation(session: AsyncSession, *, owner_email: str) -> ToucanConversation:
    """A brand-new, empty conversation for the caller. Empty is a legitimate state: the panel's
    "New conversation" action creates one immediately so that a refresh straight afterwards
    restores the NEW conversation rather than silently reopening the old one."""
    conv = ToucanConversation(owner_email=normalize_email(owner_email), title=None)
    session.add(conv)
    await session.flush()
    return conv


async def get_conversation(
    session: AsyncSession, *, conversation_id: str, owner_email: str
) -> ToucanConversation | None:
    """Ownership-scoped fetch. Returns None both for "no such conversation" and for "belongs to
    somebody else" — the caller cannot tell those apart, which is the point."""
    result = await session.execute(
        select(ToucanConversation).where(
            ToucanConversation.id == conversation_id,
            ToucanConversation.owner_email == normalize_email(owner_email),
        )
    )
    return result.scalar_one_or_none()


async def get_latest_conversation(
    session: AsyncSession, *, owner_email: str
) -> ToucanConversation | None:
    """The conversation the panel reopens on summon/refresh. `updated_at` is bumped on every
    appended turn (see append_exchange), so "latest" means most recently talked in, with
    created_at/id as deterministic tie-breakers for conversations created in the same tick."""
    result = await session.execute(
        select(ToucanConversation)
        .where(ToucanConversation.owner_email == normalize_email(owner_email))
        .order_by(
            ToucanConversation.updated_at.desc(),
            ToucanConversation.created_at.desc(),
            ToucanConversation.id.desc(),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_conversations(
    session: AsyncSession, *, owner_email: str, limit: int = DEFAULT_CONVERSATIONS_RETURNED
) -> list[dict[str, Any]]:
    capped = max(1, min(limit, MAX_CONVERSATIONS_RETURNED))
    result = await session.execute(
        select(ToucanConversation)
        .where(ToucanConversation.owner_email == normalize_email(owner_email))
        .order_by(
            ToucanConversation.updated_at.desc(),
            ToucanConversation.created_at.desc(),
            ToucanConversation.id.desc(),
        )
        .limit(capped)
    )
    return [conversation_to_dict(c) for c in result.scalars().all()]


async def list_messages(
    session: AsyncSession, *, conversation_id: str, limit: int = MAX_MESSAGES_RETURNED
) -> list[dict[str, Any]]:
    """The MOST RECENT `limit` turns, returned oldest-first for direct rendering.

    Bounded on purpose: a long-lived conversation must not turn one GET into an unbounded
    payload. Selecting newest-first then reversing keeps the tail (the part the panel is
    scrolled to) rather than the head."""
    capped = max(1, min(limit, MAX_MESSAGES_RETURNED))
    result = await session.execute(
        select(ToucanMessage)
        .where(ToucanMessage.conversation_id == conversation_id)
        .order_by(ToucanMessage.created_at.desc(), ToucanMessage.id.desc())
        .limit(capped)
    )
    newest_first = list(result.scalars().all())
    return [message_to_dict(m) for m in reversed(newest_first)]


async def append_exchange(
    session: AsyncSession,
    *,
    conversation: ToucanConversation,
    question: str,
    answer: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Persist one full exchange — the user's question AND the assistant's final reply — as two
    rows, and mark the conversation as the most recently used one.

    Both rows are written in the same unit of work as part of the request's transaction (the
    get_db dependency commits once), so a transcript can never end up holding a question with no
    answer or an answer with no question.

    `updated_at` is assigned explicitly rather than left to the mixin's onupdate: appending
    children does not by itself make the parent row dirty, so without this the conversation
    would never move to the front of "latest"."""
    user_row = ToucanMessage(
        conversation_id=conversation.id, role="user", content=_clamp(question)
    )
    assistant_row = ToucanMessage(
        conversation_id=conversation.id, role="assistant", content=_clamp(answer)
    )
    session.add_all([user_row, assistant_row])

    if not conversation.title:
        conversation.title = derive_title(question)
    conversation.updated_at = _utc_now()

    await session.flush()
    return message_to_dict(user_row), message_to_dict(assistant_row)


async def append_assistant_message(
    session: AsyncSession,
    *,
    conversation: ToucanConversation,
    content: str,
) -> dict[str, Any]:
    """Persist ONE assistant-only row — T8's confirm/cancel outcome line, which follows a
    structural button press rather than a typed question, so there is no user row to pair it
    with. Same clamp, same explicit updated_at bump as append_exchange."""
    assistant_row = ToucanMessage(
        conversation_id=conversation.id, role="assistant", content=_clamp(content)
    )
    session.add(assistant_row)
    conversation.updated_at = _utc_now()
    await session.flush()
    return message_to_dict(assistant_row)


async def delete_conversation(
    session: AsyncSession, *, conversation_id: str, owner_email: str
) -> bool:
    """Hard-delete one of the caller's own conversations, messages first.

    Children are deleted explicitly rather than relying on the FK's ON DELETE CASCADE: SQLite
    only honours that with `PRAGMA foreign_keys=ON`, which this app does not set (see
    app/database.py's pragmas), so on the dev/test database a cascade would silently orphan
    every message row."""
    conv = await get_conversation(
        session, conversation_id=conversation_id, owner_email=owner_email
    )
    if conv is None:
        return False
    await session.execute(delete(ToucanMessage).where(ToucanMessage.conversation_id == conv.id))
    # T4: detach (never delete) any resource references pointing here — a resource belongs to
    # the owner, not to the conversation it was attached from. Explicit for the same reason the
    # message delete above is: SQLite runs without PRAGMA foreign_keys, so the FK's ON DELETE
    # SET NULL would not fire.
    await session.execute(
        update(ToucanResource)
        .where(ToucanResource.conversation_id == conv.id)
        .values(conversation_id=None)
    )
    await session.delete(conv)
    await session.flush()
    return True
