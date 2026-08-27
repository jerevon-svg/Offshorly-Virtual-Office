from __future__ import annotations
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import BaseModel


class Message(BaseModel):
    """Mirrors frontend `ChatMessage` (services/chat/types.ts). `sender_email` is the Atlas
    identity string — no local users table (Atlas owns users/presence/rooms/people)."""

    __tablename__ = "messages"

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sender_email: Mapped[str] = mapped_column(String(255), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False, server_default=func.now()
    )
    # @mentions V1: canonical (lowercased) emails of conversation participants the sender
    # mentioned, server-validated against actual membership at insert time (see
    # repositories/chat.py's insert_message) — never derived by re-parsing `text` after the
    # fact. Nullable/JSON so pre-mentions rows (mentioned_emails IS NULL) stay compatible; every
    # read site treats null the same as an empty list.
    mentioned_emails: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
