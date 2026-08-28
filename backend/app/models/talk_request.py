from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class TalkRequest(BaseModel):
    """"Request Permission to Talk" — person-level DND interruption request. Separate
    table/lifecycle from both ConversationRequest (Ask to Join) and RoomEntryRequest (Request
    Entry): the target is a specific DND *person*, not a conversation or a room, and resolution
    authority is exactly that one person (not "any participant"/"any DND occupant"). `kind`
    records which spatial action the requester was attempting ("chat" | "approach") so an Allow
    can resume that exact action rather than a generic "talk".

    The 15-minute decline-cooldown (feature policy, see app/services/dnd_policy.py) is derived
    from this same table rather than a separate throttle store: repositories/talk_requests.py's
    get_cooldown_until looks up the most recent DECLINED row for (target_email, requester_email)
    and reports its resolved_at + cooldown window — server-authoritative, no extra state."""

    __tablename__ = "talk_requests"

    __table_args__ = (
        Index(
            "uq_pending_talk_request",
            "target_email",
            "requester_email",
            unique=True,
            sqlite_where=text("state = 'pending'"),
            postgresql_where=text("state = 'pending'"),
        ),
    )

    target_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    requester_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default="chat")
    state: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending", index=True)
    resolver_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
