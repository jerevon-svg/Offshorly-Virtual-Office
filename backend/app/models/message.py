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
    # PHASE 7D — WHAT THIS ROW IS. "text" is an ordinary message somebody typed; anything else is a
    # SYSTEM RECORD the server wrote about something that happened in this conversation, and carries no
    # authored content at all (`text` is "").
    #
    # WHY IT LIVES HERE rather than in a table of its own: a missed call belongs to the conversation
    # between those two people, and `messages` + `conversation_participants.last_read_at` already answer
    # "is it durable", "does it survive a relogin", "is it unread" and "where does it appear". A second
    # store would mean reimplementing all four (see activity_event.py's rule about diverging answers).
    #
    # READERS MUST BRANCH ON THIS. A non-text row has no body to render, must not become an avatar
    # speech bubble, must not be counted as a message anybody sent, and must not earn quest progress.
    # Every such site is listed in the Phase 7D consumer audit; the two that bite are
    # OfficeMap/Vo3dOverlay's talking-bubble handler and toucan_activity's message counter.
    #
    # No DB CHECK constraint — this codebase validates enums at the Python layer only (same as
    # Conversation.type and ToucanMessage.role). Server_default keeps every pre-7D row a plain message.
    # `default` AND `server_default`, deliberately both: server_default fills EXISTING rows at migration
    # time and any insert that omits the column, while default gives a freshly-constructed ORM object the
    # value immediately — without it `Message(...).kind` is None until the row is reloaded, and every
    # reader branching on kind would see None instead of "text" for an ordinary message.
    kind: Mapped[str] = mapped_column(
        String(24), nullable=False, default="text", server_default="text", index=True
    )
    # Structured detail for a system row, never for a "text" one. For KIND_CALL_MISSED:
    # {"callType": "spatial", "reason": "busy" | "timeout" | "offline" | "caller_left"}. Deliberately
    # NOT free text: the row is a fact, and the wording of it belongs to the client that renders it.
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)


# The kinds this codebase defines. Constants rather than an enum column so adding one later needs no
# migration — but a new kind is only justified when it is genuinely a conversation event with no author.
KIND_TEXT = "text"
KIND_CALL_MISSED = "call_missed"

