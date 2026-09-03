from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import and_, case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation, ConversationParticipant
from app.models.message import Message
from app.models.reaction import MessageReaction

# Faithful port of backend/src/repo/conversations.ts + backend/src/repo/messages.ts onto the
# scaffold's async SQLAlchemy models. Conversations/messages are returned as plain dicts (not
# ORM instances) from the read paths so callers (routers, socket handlers) don't need to worry
# about detached-instance access after a session closes.


def _as_aware_utc(dt: datetime | None) -> datetime | None:
    """SQLite has no native tz-aware storage — a DateTime(timezone=True) column round-trips as
    naive on read-back even though it was written aware, while values still held on an
    in-session ORM object (never re-fetched) stay aware. Normalize both sides to aware UTC
    before comparing so `>`/`>=` never raises `can't compare offset-naive and offset-aware
    datetimes` depending on where a given datetime happened to come from."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


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
        "type": conv.type,
        "title": conv.title,
    }


async def find_group_by_exact_members(
    session: AsyncSession, member_emails: set[str]
) -> str | None:
    """Returns the id of an existing `type == "group"` conversation whose CURRENT participant
    set is EXACTLY `member_emails` (not a subset, not a superset), or None if none exists.
    No-commit read. Used by accept_join_request to reuse an already-formed group for a member
    set instead of creating a redundant duplicate (membership only ever grows in this system,
    so an exact match is stable). If multiple duplicates exist (pre-existing data), the
    most-recently-active one wins (last_message_at DESC), with id ASC as a deterministic final
    tie-break."""
    members = {e.strip().lower() for e in member_emails}
    if len(members) < 2:
        return None
    n = len(members)
    members_list = list(members)

    result = await session.execute(
        select(Conversation.id)
        .join(ConversationParticipant, ConversationParticipant.conversation_id == Conversation.id)
        .where(Conversation.type == "group")
        .group_by(Conversation.id)
        .having(
            and_(
                func.count(ConversationParticipant.id) == n,
                func.sum(
                    case((ConversationParticipant.participant_email.in_(members_list), 1), else_=0)
                ) == n,
            )
        )
        # Ordering by last_message_at (not itself in GROUP BY) is only legal under PostgreSQL's
        # strict GROUP BY functional-dependency rules because it's functionally dependent on the
        # grouped primary key (Conversation.id) — don't change the group-by key in a future
        # refactor without re-checking this.
        .order_by(Conversation.last_message_at.desc(), Conversation.id.asc())
    )
    row = result.first()
    return row[0] if row else None


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


async def add_participant_if_missing(session: AsyncSession, conversation_id: str, email: str) -> None:
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
    (see `_get_or_create_conversation`/`add_participant_if_missing` for the race handling)."""
    a = email_a.strip().lower()
    b = email_b.strip().lower()
    key = dm_key(a, b)

    conv = await _get_or_create_conversation(session, key)

    existing_emails = set(await _participant_ids(session, conv.id))
    for email in (a, b):
        if email not in existing_emails:
            await add_participant_if_missing(session, conv.id, email)

    await session.commit()

    result_conv = await get_conversation_by_id(session, conv.id)
    if result_conv is None:
        raise RuntimeError(f"Failed to upsert conversation {conv.id}")
    return result_conv


async def get_dm_conversation_id(session: AsyncSession, email_a: str, email_b: str) -> str | None:
    """Read-only twin of upsert_conversation: the id of the DM between two emails if one already
    exists, else None. Never creates anything — for callers that must not leave an empty
    conversation behind (a proposal that may still be cancelled)."""
    result = await session.execute(select(Conversation.id).where(Conversation.dm_key == dm_key(email_a, email_b)))
    row = result.first()
    return row[0] if row else None


async def list_group_titles_for_user(session: AsyncSession, email: str) -> list[dict]:
    """Minimal group metadata for one member: [{id, title}] for every GROUP conversation the
    email participates in. Deliberately nothing else — no counts, no last message, no other
    members — so a caller that only needs to resolve a group by name learns only that."""
    self_email = email.strip().lower()
    result = await session.execute(
        select(Conversation.id, Conversation.title)
        .join(ConversationParticipant, ConversationParticipant.conversation_id == Conversation.id)
        .where(ConversationParticipant.participant_email == self_email, Conversation.type == "group")
        .order_by(Conversation.title, Conversation.id)
    )
    return [{"id": row[0], "title": row[1]} for row in result.all()]


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
) -> bool:
    """Returns True iff the watermark actually advanced (participant row exists AND the new
    value is strictly later than the existing one) — callers (e.g. socket.py) use this to only
    fan out a read_receipt event on a genuine change, not on every redundant re-ack."""
    self_email = email.strip().lower()
    result = await session.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.participant_email == self_email,
        )
    )
    participant = result.scalar_one_or_none()
    if participant is None:
        return False
    # Monotonic guard: never let a stale/out-of-order ack move the watermark backward — a
    # regression here would incorrectly "un-read" messages under the derived-status logic
    # compute_message_receipts relies on.
    existing = _as_aware_utc(participant.last_read_at)
    if existing is None or _as_aware_utc(up_to_sent_at) > existing:
        participant.last_read_at = up_to_sent_at
        return True
    return False


async def mark_delivered(
    session: AsyncSession, conversation_id: str, email: str, up_to_sent_at: datetime
) -> bool:
    """Sibling to mark_read above, same monotonic guard and same True-iff-advanced return
    contract — see its docstring."""
    self_email = email.strip().lower()
    result = await session.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.participant_email == self_email,
        )
    )
    participant = result.scalar_one_or_none()
    if participant is None:
        return False
    existing = _as_aware_utc(participant.last_delivered_at)
    if existing is None or _as_aware_utc(up_to_sent_at) > existing:
        participant.last_delivered_at = up_to_sent_at
        return True
    return False


async def get_participant_watermarks(
    session: AsyncSession, conversation_id: str
) -> dict[str, tuple[datetime | None, datetime | None]]:
    """One query returning {email: (last_delivered_at, last_read_at)} for every participant in
    a conversation — DMs have 2 entries, groups can have arbitrarily many."""
    result = await session.execute(
        select(
            ConversationParticipant.participant_email,
            ConversationParticipant.last_delivered_at,
            ConversationParticipant.last_read_at,
        ).where(ConversationParticipant.conversation_id == conversation_id)
    )
    return {row[0]: (row[1], row[2]) for row in result.all()}


def compute_message_receipts(
    message: Message, watermarks: dict[str, tuple[datetime | None, datetime | None]]
) -> tuple[list[str], list[str]]:
    """Derived, not stored — see unread_count's derivation off last_read_at for the same
    pattern. Returns (delivered_to, read_by): sorted lists of every recipient email (i.e. every
    watermark entry OTHER than the sender) whose delivered/read watermark has caught up to (>=)
    this message's own sent_at. `read_by` is NOT guaranteed to be a subset of `delivered_to` — a
    client that acks read without ever acking delivered is possible, don't assert containment."""
    sent_at = _as_aware_utc(message.sent_at)
    delivered_to: list[str] = []
    read_by: list[str] = []
    for recipient_email, (last_delivered_at, last_read_at) in watermarks.items():
        if recipient_email == message.sender_email:
            continue
        delivered_cmp = _as_aware_utc(last_delivered_at)
        if delivered_cmp is not None and delivered_cmp >= sent_at:
            delivered_to.append(recipient_email)
        read_cmp = _as_aware_utc(last_read_at)
        if read_cmp is not None and read_cmp >= sent_at:
            read_by.append(recipient_email)
    return (sorted(delivered_to), sorted(read_by))


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


async def _compute_mention_count(
    session: AsyncSession, conversation_id: str, self_email: str, last_read_at: datetime | None
) -> int:
    """Sibling to _compute_unread, same watermark-derived (not stored) approach: counts unread
    peer messages whose validated mentioned_emails includes self_email. Filtered in Python
    rather than a DB-specific JSON "contains" operator, keeping this portable across SQLite
    (dev/tests) and Postgres — acceptable for V1's "lightweight" scope (one column fetched over
    the same already-small unread set _compute_unread scans)."""
    conditions = [
        Message.conversation_id == conversation_id,
        Message.sender_email != self_email,
    ]
    if last_read_at is not None:
        conditions.append(Message.sent_at > last_read_at)
    result = await session.execute(select(Message.mentioned_emails).where(and_(*conditions)))
    return sum(1 for (mentioned,) in result.all() if mentioned and self_email in mentioned)


async def mention_count(session: AsyncSession, conversation_id: str, email: str) -> int:
    """Derived, not stored — same last_read_at watermark unread_count uses, further filtered to
    messages that mention `email`."""
    self_email = email.strip().lower()
    result = await session.execute(
        select(ConversationParticipant.last_read_at).where(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.participant_email == self_email,
        )
    )
    last_read_at = result.scalar_one_or_none()
    return await _compute_mention_count(session, conversation_id, self_email, last_read_at)


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
        last_read_at = last_read_by_conv.get(conv.id)
        count = await _compute_unread(session, conv.id, self_email, last_read_at)
        mentions = await _compute_mention_count(session, conv.id, self_email, last_read_at)
        out.append(
            {
                "id": conv.id,
                "last_message_at": conv.last_message_at,
                "participant_ids": parts_by_conv.get(conv.id, []),
                "unread_count": count,
                "mention_count": mentions,
                "type": conv.type,
                "title": conv.title,
            }
        )
    return out


async def _create_group_conversation(
    session: AsyncSession, member_emails: set[str], title: str | None
) -> str:
    """No-commit core: creates a group Conversation + participant rows, flushes, returns the new
    conversation id. Caller owns the transaction/commit. Raises ValueError if fewer than 2 unique
    members."""
    members = {e.strip().lower() for e in member_emails}
    if len(members) < 2:
        raise ValueError("A group conversation requires at least 2 unique participants")

    conv = Conversation(type="group", title=title, dm_key=None, last_message_at=datetime.now(timezone.utc))
    session.add(conv)
    await session.flush()

    for email in members:
        await add_participant_if_missing(session, conv.id, email)

    return conv.id


async def set_group_title_if_empty(session: AsyncSession, conversation_id: str, title: str) -> bool:
    """Give an UNTITLED group a title; never overwrite one somebody already chose. Returns True
    when the title was applied. Commits. Used by the create-group endpoint's exact-member reuse
    branch so re-creating an existing but nameless group with a name finally names it."""
    result = await session.execute(select(Conversation).where(Conversation.id == conversation_id))
    conv = result.scalar_one_or_none()
    if conv is None or conv.type != "group" or (conv.title or "").strip():
        return False
    conv.title = title
    await session.commit()
    return True


async def create_group_conversation(
    session: AsyncSession, creator_email: str, participant_emails: list[str], title: str | None
) -> dict:
    """Creates a new group conversation with the creator plus every given participant email
    (deduped, normalized). Raises ValueError if the deduped membership set has fewer than 2
    people — routers translate that to a 400. Thin commit-owning wrapper around
    `_create_group_conversation` — kept as its own function so accept_join_request (which must
    do the group-creation and other side effects inside ONE transaction) can call the no-commit
    core directly instead."""
    creator = creator_email.strip().lower()
    members = {creator} | {e.strip().lower() for e in participant_emails}

    new_id = await _create_group_conversation(session, members, title)
    await session.commit()

    result_conv = await get_conversation_by_id(session, new_id)
    if result_conv is None:
        raise RuntimeError(f"Failed to create group conversation {new_id}")
    return result_conv


async def insert_message(
    session: AsyncSession,
    conversation_id: str,
    sender_email: str,
    text: str,
    mentioned_emails: list[str] | None = None,
) -> Message:
    # Sender is always the server-verified identity — a client-sent sender id is never trusted.
    # Truncate to millisecond precision at insert time (not just on wire serialization) so the
    # stored sent_at always exactly matches whatever a client later echoes back as a watermark
    # (see to_iso_z, which serializes with timespec="milliseconds") — otherwise
    # compute_message_receipts/_compute_unread compare a truncated watermark against a
    # full-microsecond sent_at and the message can never resolve to delivered/read.
    now = datetime.now(timezone.utc)
    sent_at = now.replace(microsecond=(now.microsecond // 1000) * 1000)

    # @mentions V1: never trust the client's claimed mentions — a real mention must resolve to an
    # actual conversation participant. Intersect against the real participant list (one extra
    # query, only when the caller actually sent any candidates) rather than parsing @DisplayName
    # out of `text` after the fact.
    validated_mentions: list[str] | None = None
    if mentioned_emails:
        participants_result = await session.execute(
            select(ConversationParticipant.participant_email).where(
                ConversationParticipant.conversation_id == conversation_id
            )
        )
        participant_emails = {row[0] for row in participants_result.all()}
        candidates = {e.strip().lower() for e in mentioned_emails if isinstance(e, str) and e.strip()}
        validated = sorted(candidates & participant_emails)
        validated_mentions = validated or None

    message = Message(
        conversation_id=conversation_id,
        sender_email=sender_email.strip().lower(),
        text=text,
        sent_at=sent_at,
        mentioned_emails=validated_mentions,
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


# --- Message reactions -------------------------------------------------------------------
# Deliberately self-contained: nothing below writes to `messages`, `conversations` or
# `conversation_participants`, so reactions can never move last_message_at, the
# delivered/read watermarks, or the message rows _compute_unread/_compute_mention_count scan.

# V1 keeps a small server-side allowlist rather than accepting arbitrary client strings —
# same "validate at the Python layer, not with a DB CHECK" convention Conversation.type uses.
# Mirrored by REACTION_EMOJIS in frontend/src/components/Chat/MessageReactions.tsx; keep the
# two in sync.
ALLOWED_REACTION_EMOJIS: tuple[str, ...] = ("👍", "❤️", "😂", "😮", "😢", "🎉")


async def get_message_conversation_id(session: AsyncSession, message_id: str) -> str | None:
    """The conversation a message belongs to, or None if the message doesn't exist. Callers
    pair this with is_participant to authorize a reaction — a reactor must belong to the
    message's OWN conversation, never merely to some conversation."""
    result = await session.execute(select(Message.conversation_id).where(Message.id == message_id))
    row = result.first()
    return row[0] if row else None


async def add_reaction(session: AsyncSession, message_id: str, reactor_email: str, emoji: str) -> bool:
    """Idempotent add. Returns True iff a row was actually inserted — callers (socket.py) use
    this to skip re-broadcasting a no-op double-click. Authorization is the CALLER's job (see
    get_message_conversation_id + is_participant); this function trusts its arguments."""
    email = reactor_email.strip().lower()
    try:
        # SAVEPOINT so a uq_message_reaction violation unwinds only this insert rather than
        # poisoning the outer transaction — same idiom as add_participant_if_missing, and
        # portable across SQLite and Postgres unlike INSERT ... ON CONFLICT.
        async with session.begin_nested():
            session.add(MessageReaction(message_id=message_id, reactor_email=email, emoji=emoji))
            await session.flush()
        return True
    except IntegrityError:
        # This exact (message, user, emoji) already exists — the DB constraint makes a duplicate
        # impossible, and the desired end state is already true. Nothing to do.
        return False


async def remove_reaction(session: AsyncSession, message_id: str, reactor_email: str, emoji: str) -> bool:
    """Removes ONLY the caller's own reaction (the reactor_email predicate is what makes this
    safe — a participant can never delete someone else's). Returns True iff a row was deleted."""
    email = reactor_email.strip().lower()
    result = await session.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.reactor_email == email,
            MessageReaction.emoji == emoji,
        )
    )
    reaction = result.scalar_one_or_none()
    if reaction is None:
        return False
    await session.delete(reaction)
    return True


def _group_reactions(rows: list[MessageReaction]) -> list[dict]:
    """Groups a single message's reaction rows into the wire shape
    [{emoji, count, reactors}] — one entry per distinct emoji, reactors sorted for a stable
    render order. Insertion order of first appearance is preserved so chips don't reshuffle
    as counts change."""
    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(row.emoji, []).append(row.reactor_email)
    return [
        {"emoji": emoji, "count": len(reactors), "reactors": sorted(reactors)}
        for emoji, reactors in grouped.items()
    ]


async def get_reactions_for_messages(
    session: AsyncSession, message_ids: list[str]
) -> dict[str, list[dict]]:
    """Batch loader — ONE query for a whole page of history, keyed by message id. Mirrors
    repositories/feed.py's get_reactions_for_posts. Messages with no reactions are simply
    absent from the returned dict; every read site defaults them to []. Avoids the N+1 a
    per-message fetch inside the serialization loop would create."""
    if not message_ids:
        return {}
    result = await session.execute(
        select(MessageReaction)
        .where(MessageReaction.message_id.in_(message_ids))
        # Deterministic ordering so _group_reactions' first-appearance chip order is stable
        # across requests rather than depending on the DB's physical row order.
        .order_by(MessageReaction.created_at.asc(), MessageReaction.id.asc())
    )
    by_message: dict[str, list[MessageReaction]] = {}
    for row in result.scalars().all():
        by_message.setdefault(row.message_id, []).append(row)
    return {mid: _group_reactions(rows) for mid, rows in by_message.items()}


async def get_reactions_for_message(session: AsyncSession, message_id: str) -> list[dict]:
    """Single-message convenience wrapper over the batch loader."""
    return (await get_reactions_for_messages(session, [message_id])).get(message_id, [])
