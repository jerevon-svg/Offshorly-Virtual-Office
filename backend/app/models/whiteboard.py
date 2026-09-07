from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Whiteboard(BaseModel):
    """One persistent whiteboard in exactly ONE scope: a conversation (1:1 DM or group — W1/W2)
    or an office room (W4; `room_id` is the flat room id the frontend already uses for presence
    and room requests, e.g. "design-team", or OFFICE_ROOM_ID for the office-wide board).

    Access is inherited, never stored here (see app/services/whiteboard_access.py): a
    conversation board is visible iff the caller is a participant (app/repositories/chat.py's
    is_participant); a room board is visible to every authenticated office user. The canvas is
    stored as one opaque editor document (`document`, JSON; Excalidraw file format since the
    tldraw → Excalidraw migration) — the server never interprets shapes. `version` is an
    optimistic-concurrency counter: a save must present the version it loaded, else the router
    answers 409 (see repositories/whiteboards.py save_document)."""

    __tablename__ = "whiteboards"
    __table_args__ = (
        # Exactly one scope — never both, never neither.
        CheckConstraint("(conversation_id IS NULL) <> (room_id IS NULL)", name="ck_whiteboards_one_scope"),
    )

    conversation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=True
    )
    room_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    document: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
