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
