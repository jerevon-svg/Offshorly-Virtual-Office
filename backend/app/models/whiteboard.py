from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Whiteboard(BaseModel):
    """One persistent whiteboard attached to a conversation — 1:1 DM or group (W1/W2).

    Access is inherited, never stored here: a caller may see/edit a board iff they are a
    participant of `conversation_id` (app/repositories/chat.py's is_participant). The canvas is
    stored as one opaque tldraw editor snapshot (`document`, JSON) — the server never interprets
    shapes. `version` is an optimistic-concurrency counter: a save must present the version it
    loaded, else the router answers 409 (see repositories/whiteboards.py save_document)."""

    __tablename__ = "whiteboards"

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    document: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
