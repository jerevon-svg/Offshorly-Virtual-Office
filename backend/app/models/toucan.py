from __future__ import annotations

from sqlalchemy import ForeignKey, Index, String, Text
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
