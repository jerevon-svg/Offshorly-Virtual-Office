from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation, ConversationParticipant
from app.models.message import Message

# Faithful port of backend/src/repo/conversations.ts + backend/src/repo/messages.ts onto the
# scaffold's async SQLAlchemy models. Conversations/messages are returned as plain dicts (not
# ORM instances) from the read paths so callers (routers, socket handlers) don't need to worry
# about detached-instance access after a session closes.


def dm_key(email_a: str, email_b: str) -> str:
    """Same deterministic scheme the Node repo and client-side mock use, just used here purely
    as a server-side lookup key (see Conversation.dm_key) — the frontend never derives or
    depends on this string, only on the opaque `id`."""
    lo = sorted([email_a.strip().lower(), email_b.strip().lower()])
    return f"conv-{lo[0]}__{lo[1]}"


async def _participant_ids(session: AsyncSession, conversation_id: str) -> list[str]:
    result = await session.execute(
        select(ConversationParticipant.participant_email).where(
            ConversationParticipant.conversation_id == conversation_id
        )
    )
    return [row[0] for row in result.all()]


async def get_conversation_by_id(session: AsyncSession, conversation_id: str) -> dict | None:
    result = await session.execute(select(Conversation).where(Conversation.id == conversation_id))
    conv = result.scalar_one_or_none()
    if conv is None:
        return None
    return {
        "id": conv.id,
        "last_message_at": conv.last_message_at,
        "participant_ids": await _participant_ids(session, conv.id),
    }


async def _get_or_create_conversation(session: AsyncSession, key: str) -> Conversation:
    result = await session.execute(select(Conversation).where(Conversation.dm_key == key))
    conv = result.scalar_one_or_none()
    if conv is not None:
        return conv

    try:
        # SAVEPOINT (begin_nested) so a unique-constraint violation only unwinds this insert,
        # not the whole outer transaction/session — portable across SQLite and Postgres, unlike
        # a Postgres-only `INSERT ... ON CONFLICT`. The construct+add must happen INSIDE the
        # nested block: adding before begin_nested() lets the pending INSERT get flushed into
        # the outer transaction, so a conflict corrupts the whole session instead of being
        # contained by the savepoint.
        async with session.begin_nested():
            conv = Conversation(dm_key=key, last_message_at=datetime.now(timezone.utc))
            session.add(conv)
            await session.flush()
    except IntegrityError:
        # Lost the race: a concurrent call committed a Conversation with this dm_key between
        # our SELECT and our INSERT. The UNIQUE constraint on dm_key guarantees a row now
        # exists for this key — converge on it instead of blowing up.
        result = await session.execute(select(Conversation).where(Conversation.dm_key == key))
        conv = result.scalar_one_or_none()
        if conv is None:
            raise
    return conv


async def _add_participant_if_missing(session: AsyncSession, conversation_id: str, email: str) -> None:
    try:
        async with session.begin_nested():
            session.add(ConversationParticipant(conversation_id=conversation_id, participant_email=email))
            await session.flush()
    except IntegrityError:
        # Lost the race: a concurrent call already inserted this exact (conversation_id, email)
        # participant row (uq_conversation_participant). Row exists either way — nothing to do.
        pass


async def upsert_conversation(session: AsyncSession, email_a: str, email_b: str) -> dict:
    """Upserts a conversation + both participant rows for a DM between two emails. Idempotent —
    safe to call every time a chat is opened, including concurrently for the same email pair
    (see `_get_or_create_conversation`/`_add_participant_if_missing` for the race handling)."""
    a = email_a.strip().lower()
    b = email_b.strip().lower()
    key = dm_key(a, b)

    conv = await _get_or_create_conversation(session, key)

    existing_emails = set(await _participant_ids(session, conv.id))
    for email in (a, b):
        if email not in existing_emails:
            await _add_participant_if_missing(session, conv.id, email)

    await session.commit()

    result_conv = await get_conversation_by_id(session, conv.id)
    if result_conv is None:
        raise RuntimeError(f"Failed to upsert conversation {conv.id}")
    return result_conv


async def is_participant(session: AsyncSession, conversation_id: str, email: str) -> bool:
    self_email = email.strip().lower()
    result = await session.execute(
        select(ConversationParticipant.id).where(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.participant_email == self_email,
        )
    )
    return result.first() is not None


async def touch_conversation(session: AsyncSession, conversation_id: str, sent_at: datetime) -> None:
    result = await session.execute(select(Conversation).where(Conversation.id == conversation_id))
    conv = result.scalar_one_or_none()
    if conv is not None:
        conv.last_message_at = sent_at


async def mark_read(
    session: AsyncSession, conversation_id: str, email: str, up_to_sent_at: datetime
) -> None:
    self_email = email.strip().lower()
    result = await session.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.participant_email == self_email,
        )
    )
    participant = result.scalar_one_or_none()
    if participant is not None:
        participant.last_read_at = up_to_sent_at


async def _compute_unread(
    session: AsyncSession, conversation_id: str, self_email: str, last_read_at: datetime | None
) -> int:
    conditions = [
        Message.conversation_id == conversation_id,
        Message.sender_email != self_email,
    ]
    if last_read_at is not None:
        conditions.append(Message.sent_at > last_read_at)
    result = await session.execute(select(func.count()).select_from(Message).where(and_(*conditions)))
    return int(result.scalar_one())


async def unread_count(session: AsyncSession, conversation_id: str, email: str) -> int:
    """Derived, not stored — see backend/src/repo/conversations.ts's `unreadCount`. Null
    last_read_at (never read) counts every peer message."""
    self_email = email.strip().lower()
    result = await session.execute(
        select(ConversationParticipant.last_read_at).where(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.participant_email == self_email,
        )
    )
    last_read_at = result.scalar_one_or_none()
    return await _compute_unread(session, conversation_id, self_email, last_read_at)


async def list_conversations_for_user(session: AsyncSession, email: str) -> list[dict]:
    """All conversations a given email participates in, most-recently-active first. Each row
    also carries `unread_count` — own-messages excluded, computed per-conversation against that
    conversation's own last_read_at cursor."""
    self_email = email.strip().lower()

    my_rows_result = await session.execute(
        select(ConversationParticipant).where(ConversationParticipant.participant_email == self_email)
    )
    my_rows = my_rows_result.scalars().all()
    if not my_rows:
        return []

    last_read_by_conv = {row.conversation_id: row.last_read_at for row in my_rows}
    conv_ids = list(last_read_by_conv.keys())

    convs_result = await session.execute(
        select(Conversation)
        .where(Conversation.id.in_(conv_ids))
        .order_by(Conversation.last_message_at.desc())
    )
    convs = convs_result.scalars().all()

    all_parts_result = await session.execute(
        select(ConversationParticipant).where(ConversationParticipant.conversation_id.in_(conv_ids))
    )
    parts_by_conv: dict[str, list[str]] = {}
    for row in all_parts_result.scalars().all():
        parts_by_conv.setdefault(row.conversation_id, []).append(row.participant_email)

    out: list[dict] = []
    for conv in convs:
        count = await _compute_unread(session, conv.id, self_email, last_read_by_conv.get(conv.id))
        out.append(
            {
                "id": conv.id,
                "last_message_at": conv.last_message_at,
                "participant_ids": parts_by_conv.get(conv.id, []),
                "unread_count": count,
            }
        )
    return out


async def insert_message(session: AsyncSession, conversation_id: str, sender_email: str, text: str) -> Message:
    # Sender is always the server-verified identity — a client-sent sender id is never trusted.
    message = Message(
        conversation_id=conversation_id,
        sender_email=sender_email.strip().lower(),
        text=text,
        sent_at=datetime.now(timezone.utc),
    )
    session.add(message)
    await session.flush()
    return message


async def list_messages(
    session: AsyncSession,
    conversation_id: str,
    since: datetime | None = None,
    before: datetime | None = None,
    limit: int | None = None,
) -> list[Message]:
    conditions = [Message.conversation_id == conversation_id]
    if since is not None:
        conditions.append(Message.sent_at > since)
    if before is not None:
        conditions.append(Message.sent_at < before)

    effective_limit = limit if limit is not None else 200
    clamped_limit = min(max(effective_limit, 1), 500)

    result = await session.execute(
        select(Message).where(and_(*conditions)).order_by(Message.sent_at.asc()).limit(clamped_limit)
    )
    return list(result.scalars().all())
