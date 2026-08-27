from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer

# Exact camelCase wire shapes expected by frontend/src/services/chat/types.ts and
# RealChatService.ts. `sentAt`/`lastMessageAt` are always ISO-8601 UTC strings with a literal
# "Z" suffix (not "+00:00") — see `to_iso_z` below.


def to_iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def serialize_message_dict(message, delivered_to: list[str], read_by: list[str]) -> dict:
    """Plain-dict serializer used by the socket layer (app/realtime/socket.py), which emits raw
    JSON-able payloads rather than FastAPI response models. `deliveredTo`/`readBy` are per-reader
    email lists derived from watermark comparisons (see app/repositories/chat.py's
    compute_message_receipts) — an empty list means nobody yet, never null."""
    return {
        "id": message.id,
        "conversationId": message.conversation_id,
        "senderId": message.sender_email,
        "text": message.text,
        "sentAt": to_iso_z(message.sent_at),
        "deliveredTo": list(delivered_to),
        "readBy": list(read_by),
    }


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    conversation_id: str = Field(alias="conversationId")
    sender_id: str = Field(alias="senderId")
    text: str
    sent_at: datetime = Field(alias="sentAt")
    # Per-reader email lists, not stored per-message — see
    # app/repositories/chat.py's compute_message_receipts. Empty list = nobody yet, never null.
    delivered_to: list[str] = Field(default_factory=list, alias="deliveredTo")
    read_by: list[str] = Field(default_factory=list, alias="readBy")

    @field_serializer("sent_at")
    def _serialize_sent_at(self, dt: datetime) -> str:
        return to_iso_z(dt)


class ConversationOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    participant_ids: list[str] = Field(alias="participantIds")
    last_message_at: datetime = Field(alias="lastMessageAt")
    # Only populated on the list endpoint (GET /conversations) — absent (excluded via
    # response_model_exclude_none) on POST /conversations, matching
    # backend/src/repo/conversations.ts's Conversation.unreadCount semantics.
    unread_count: int | None = Field(default=None, alias="unreadCount")
    # "dm" | "group" — see app/models/conversation.py's Conversation.type. Defaults to "dm" for
    # any pre-Stage-2 caller that hasn't started passing it explicitly.
    type: str = Field(default="dm")
    # Group display name; null for DMs (peer identity derives from participants instead).
    title: str | None = Field(default=None)

    @field_serializer("last_message_at")
    def _serialize_last_message_at(self, dt: datetime) -> str:
        return to_iso_z(dt)


class CreateConversationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    peer_email: str | None = Field(default=None, alias="peerEmail")


class CreateGroupConversationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # Other members to add alongside the caller (derived server-side via get_current_email) —
    # never includes the caller's own email explicitly, though a duplicate is harmless (deduped
    # by the router before hitting the repo layer).
    participant_emails: list[str] = Field(default_factory=list, alias="participantEmails")
    title: str | None = Field(default=None)


class MarkReadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    up_to_sent_at: str | None = Field(default=None, alias="upToSentAt")


class UnreadCountOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    unread_count: int = Field(alias="unreadCount")
