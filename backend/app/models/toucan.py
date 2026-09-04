from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Toucan T1 — PERSISTENT CONVERSATIONS, and nothing more.
#
# WHAT THESE TWO TABLES ARE ALLOWED TO HOLD (the privacy boundary, restated as schema):
#   * the question the user typed into the Toucan panel
#   * the answer the deterministic office assistant gave back
#   * enough metadata to find that conversation again (owner, timestamps, a title derived
#     from the user's own first message)
#
# WHAT THEY MUST NEVER HOLD, no matter how convenient it would be later:
#   * the office context snapshot the answer was built from (roster rows, room presence, call
#     state, positions) — that is rebuilt live per request in services/toucan/context.py and is
#     deliberately never written down
#   * Atlas bearer tokens, or anything else derived from the caller's credential
#   * normal VO chat message bodies, LiveKit media, or Cliq data
#   * embeddings, extracted facts, summaries or any other "memory" representation. T1 persists
#     a transcript. It does not remember anything ABOUT the user.


class ToucanConversation(BaseModel):
    """One Toucan session's worth of transcript, owned by exactly one person.

    `owner_email` is written ONLY from get_current_email (the verified bearer identity) — the
    request body has no owner field and forbids extras, so it can never be supplied by a
    caller. Every read and write goes through a repository helper that filters on it, so
    ownership is enforced in one place rather than per-endpoint."""

    __tablename__ = "toucan_conversations"

    owner_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)

    # Human-readable label, derived from the FIRST USER MESSAGE of the conversation (truncated —
    # see repositories/toucan.py's derive_title). Deterministic string slicing, not a generated
    # or AI-written summary. Null until the conversation has its first user message.
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)


class ToucanMessage(BaseModel):
    """One turn. `role` is "user" or "assistant" — the two roles the panel renders.

    NOTE the role vocabulary differs from the wire's T0 history ("user" | "toucan"): the stored
    vocabulary is the one the spec fixed, and the router translates at the edge, so the existing
    /toucan/ask history contract is untouched."""

    __tablename__ = "toucan_messages"
    # Reading one conversation is always "this conversation, oldest turn first" — the composite
    # index serves that ORDER BY directly. Declared here as well as in the migration so
    # `alembic revision --autogenerate` sees no phantom drift.
    __table_args__ = (
        Index("ix_toucan_messages_conversation_created", "conversation_id", "created_at"),
    )

    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("toucan_conversations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # "user" | "assistant". No DB CHECK constraint — this codebase validates enums at the Python
    # layer only (same as Conversation.type).
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)


# --- T2: the absence window ---------------------------------------------------------------
#
# T2 asks Toucan a question T0 and T1 could not: "what happened while I was gone?" Answering it
# needs a durable answer to "when was I last here?", and this codebase had none. Every presence
# signal it owns is in-memory and per-process — app/services/offline_lineup.py's explicit
# checkout lineup, room_presence, spatial_sessions — so all of them forget everything on a
# restart, which is exactly the case "several days away" has to survive. The one durable
# timestamp that looked close, employee_positions.updated_at, means "when this person last
# finished walking somewhere", not "when we last saw them", and is cold-loaded at boot on
# purpose (see models/position.py), so it would report a stale walk as recent presence.
#
# Hence one small row per person, written from the socket layer, holding two timestamps and
# nothing else.


class ToucanAttentionCursor(BaseModel):
    """When we last saw this person, and when their current absence began.

    Does NOT extend the uuid-PK convention meaningfully — there is exactly one row per email,
    upserted in place. It still carries BaseModel's id/created_at/updated_at because
    `created_at` is load-bearing: it is the honest floor for the absence window the very first
    time somebody uses Toucan ("since I started keeping track"), so that a brand-new user is
    told what the number means instead of being handed a silently wrong one.

    Holds no content of any kind. Two timestamps and an email."""

    __tablename__ = "toucan_attention_cursors"

    # Natural key, normalized (lowercased/stripped) by the repository before every read and
    # write. Unique because a second row for the same person would split their history.
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)

    # The most recent moment the server observed this person either ARRIVE or LEAVE: a socket
    # connect, an explicit check-in, an explicit checkout, or their LAST socket going away.
    # Departures matter as much as arrivals here — without them, somebody who closes their
    # laptop at 17:00 without checking out leaves this at whenever that morning's session
    # started, and the next day's absence would be measured from the wrong end of a working day.
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # THE ABSENCE BOUNDARY, frozen. Set to the PREVIOUS value of last_seen_at at the moment a
    # gap of at least ABSENCE_GAP_SECONDS is detected ON A RETURN — arrivals only, never
    # departures (see repositories/toucan_activity.py's _touch for why letting a departure
    # freeze it would mistake a long working day for a long absence). It has to be frozen rather
    # than derived, because the instant somebody reconnects `last_seen_at` moves to now and the
    # boundary is gone. Null until this person's first observed absence.
    away_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# --- T4: important memory ------------------------------------------------------------------
#
# T4 gives Toucan the one kind of durability T1 deliberately refused: facts the user EXPLICITLY
# asked it to keep ("Remember that the demo is Friday"). The refusal itself has not moved an
# inch — nothing is ever extracted, summarised or inferred. A row appears in this table through
# exactly two doors, both of which start with the user typing an explicit remember/save command:
# the deterministic chat command in services/toucan/memory_commands.py, and POST /toucan/memories.
# An ordinary Toucan question, a chat message, an office snapshot — none of those can reach here.


class ToucanMemory(BaseModel):
    """One durable fact the owner explicitly asked Toucan to remember.

    `owner_email` is written ONLY from get_current_email, exactly as ToucanConversation's is —
    the request body has no owner field and forbids extras. Every repository helper filters on
    it in the same SELECT, so another user's memory is indistinguishable from one that does not
    exist.

    Deliberately NOT here: any link to the conversation the command was typed in (a memory
    outlives and floats above conversations — that is its entire point), any source snippet,
    any embedding or derived representation. `content` is the user's own words, verbatim."""

    __tablename__ = "toucan_memories"
    # "this owner's memories, newest first" is the only read shape — served directly.
    __table_args__ = (
        Index("ix_toucan_memories_owner_created", "owner_email", "created_at"),
    )

    owner_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)

    # "fact" (remember that ...) | "note" (save this note: ...). Python-layer vocabulary, no DB
    # CHECK — same convention as ToucanMessage.role.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)

    # The user's own words, clamped at the repository (see repositories/toucan_memory.py).
    content: Mapped[str] = mapped_column(Text, nullable=False)


# --- T4: resource references ----------------------------------------------------------------
#
# The FOUNDATION for future file understanding (T7), and only the foundation. This codebase has
# no object storage and no attachment abstraction anywhere (checked at T4), so this table
# honestly stores METADATA AND REFERENCES ONLY: a name the owner gave the thing, an optional
# locator (a URL today; an object-storage key once that layer exists), and optional links into
# the owner's own Toucan conversations/memories. There is no byte-content column of any kind —
# adding one, or smuggling base64 through `locator`, is exactly what the size bound and the
# tests exist to refuse. Actual binary upload waits for the planned object-storage layer.


class ToucanResource(BaseModel):
    """A persistent reference to an external thing the owner attached to their Toucan world.

    Owner-scoped like everything else Toucan persists. The two foreign keys are OPTIONAL links
    into the same owner's data — the repository verifies ownership of the target before writing
    either — and are severed (set NULL) when the target is deleted, so a resource row can never
    dangle into another user's id space."""

    __tablename__ = "toucan_resources"

    owner_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)

    # Optional attachment points. ondelete="SET NULL" for engines that enforce FKs; SQLite here
    # does not (no PRAGMA foreign_keys), so the repositories also sever these explicitly on
    # delete — same reasoning as delete_conversation's explicit child delete.
    conversation_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("toucan_conversations.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    memory_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("toucan_memories.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    display_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # WHERE the thing lives, never WHAT it contains: a URL today, an object-storage key later.
    # Nullable because a resource can be registered before its storage location exists. Bounded
    # tightly enough that a file body cannot be smuggled through it.
    locator: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # MIME type when known ("application/pdf"). Metadata about the reference, not content.
    media_type: Mapped[str | None] = mapped_column(String(127), nullable=True)


# --- A2.1: explicit temporary delegation ----------------------------------------------------
#
# A2 lets a person say "handle my messages for 2 hours" and have Toucan answer their DMs while
# they are away — clearly as Toucan, never as them. The row below is the durable fact that such
# a delegation exists, so it survives a backend restart and ends on time without a scheduler:
# every read checks `expires_at`/`hard_cap_at` and lazily marks a stale row ended.
#
# It holds NO content: who delegated, when it started, when it ends, how it ended, how many
# automatic replies were sent, and the owner's own optional note (unused at A2.1, reserved for
# A2.4's explicitly authorised wording). Nothing about the conversations Toucan replied in.


class ToucanDelegation(BaseModel):
    """One explicit, temporary "handle my messages" grant, owned by exactly one person.

    `owner_email` is written ONLY from get_current_email at confirm time — the proposal carries no
    owner and the request body has no owner field. At most one row per owner is `active`; starting
    another ends the previous one. Ended rows are kept for audit, never deleted."""

    __tablename__ = "toucan_delegations"
    __table_args__ = (Index("ix_toucan_delegations_owner_status", "owner_email", "status"),)

    owner_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    # "active" | "ended". Python-layer vocabulary, no DB CHECK — same convention as the rest.
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # A2.1 ships "at_time" only; "until_return" arrives with A2.3.
    end_condition: Mapped[str] = mapped_column(String(16), nullable=False)
    # A2.1 ships "dm" only; groups arrive with A2.2.
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Null is reserved for a future until_return condition; at_time rows always carry it.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The absolute ceiling regardless of condition — a delegation can never outlive this.
    hard_cap_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "expired" | "cancelled" | "replaced" (A2.3 adds "returned").
    ended_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # The owner's own words, if they gave any. Reserved; A2.1 never writes it.
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    reply_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class ToucanUrgentFlag(BaseModel):
    """A3 — one requester's declaration that a message left under a delegation is urgent.

    METADATA ONLY, by construction: which delegation, whose it was, which conversation, who
    declared it, an opaque handle to the message that carried the declaration, and when. No
    text, no body, no preview — the owner opens the conversation to read it. Exactly one row per
    (delegation, conversation, requester): a second "yes" changes nothing. `seen_at` is written
    only by the owner's own open/dismiss, never by Toucan."""

    __tablename__ = "toucan_delegation_urgent_flags"
    __table_args__ = (
        Index(
            "ux_toucan_urgent_flags_delegation_conversation_requester",
            "delegation_id",
            "conversation_id",
            "requester_email",
            unique=True,
        ),
        Index("ix_toucan_urgent_flags_owner_seen", "owner_email", "seen_at"),
    )

    delegation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("toucan_delegations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalised from the delegation so every owner-scoped read is one indexed SELECT.
    owner_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    requester_email: Mapped[str] = mapped_column(String(255), nullable=False)
    # Opaque correlation handle to the declaring message. Never resolved into content here.
    message_reference: Mapped[str | None] = mapped_column(String(36), nullable=True)
    flagged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
