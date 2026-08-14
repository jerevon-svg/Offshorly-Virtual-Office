from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Conversation(BaseModel):
    """Mirrors frontend `Conversation` (services/chat/types.ts). Participants live in the
    associated `conversation_participants` table below rather than as an inline id array."""

    __tablename__ = "conversations"

    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Deterministic key for a DM pair — `conv-{sorted-lowercased-emails-joined}` (see
    # app/repositories/chat.py `dm_key`). Used for idempotent upsert-by-pair; the frontend never
    # derives or relies on this, only on the opaque `id` (BaseModel's UUID PK).
    dm_key: Mapped[str | None] = mapped_column(String(600), unique=True, index=True, nullable=True)


class ConversationParticipant(BaseModel):
    """Join row: one per (conversation, participant email). Identity is an email string —
    Atlas is the source of truth for people, not a local users table."""

    __tablename__ = "conversation_participants"
    __table_args__ = (
        UniqueConstraint("conversation_id", "participant_email", name="uq_conversation_participant"),
    )

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    participant_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)

    # Read-receipt cursor: null means "never read anything in this conversation" (unread count
    # then counts every peer message). Mirrors backend/src/repo/conversations.ts's
    # conversation_participants.last_read_at.
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
