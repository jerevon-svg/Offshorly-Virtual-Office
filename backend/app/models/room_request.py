from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class RoomEntryRequest(BaseModel):
    """"Request Entry" / Knock request against a DND-locked office room. Deliberately a separate
    table/lifecycle from ConversationRequest ("Ask to Join") — a room has no `conversations` row
    to foreign-key against, and its authorization is against live spatial/DND state (see
    app/services/room_presence.py + app/services/dnd_registry.py), not conversation membership.
    `room_id` is the flat rects/teamRooms-namespace room id (frontend's office-layout.ts `rooms`,
    e.g. "design-team") — the same id scheme doorStandForRoom keys off, and the same one
    RoomPresenceRegistry entries use, so a request always joins cleanly against live occupancy."""

    __tablename__ = "room_entry_requests"

    __table_args__ = (
        Index(
            "uq_pending_room_request",
            "room_id",
            "requester_email",
            unique=True,
            sqlite_where=text("state = 'pending'"),
            postgresql_where=text("state = 'pending'"),
        ),
    )

    room_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    requester_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending", index=True)
    resolver_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
