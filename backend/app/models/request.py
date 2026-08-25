from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ConversationRequest(BaseModel):
    """"Ask to join" / group-formation request. `kind` distinguishes request flavors (e.g.
    join-group, create-group). No users table — requester/resolver identity is an email string,
    same convention as `ConversationParticipant.participant_email`."""

    __tablename__ = "conversation_requests"

    __table_args__ = (
        Index(
            "uq_pending_request",
            "kind",
            "conversation_id",
            "requester_email",
            unique=True,
            sqlite_where=text("state = 'pending'"),
            postgresql_where=text("state = 'pending'"),
        ),
    )

    kind: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

    conversation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    requester_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending", index=True)
    resolver_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result_conversation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
