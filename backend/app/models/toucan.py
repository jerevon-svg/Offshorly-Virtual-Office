from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
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
