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


def serialize_message_dict(
    message, delivered_at: datetime | None = None, read_at: datetime | None = None
) -> dict:
    """Plain-dict serializer used by the socket layer (app/realtime/socket.py), which emits raw
    JSON-able payloads rather than FastAPI response models. `deliveredAt`/`readAt` are derived
    watermark comparisons (see app/repositories/chat.py's compute_message_receipts) — null means
    not yet delivered/read, never a status enum string."""
    return {
        "id": message.id,
        "conversationId": message.conversation_id,
        "senderId": message.sender_email,
        "text": message.text,
        "sentAt": to_iso_z(message.sent_at),
        "deliveredAt": to_iso_z(delivered_at) if delivered_at is not None else None,
        "readAt": to_iso_z(read_at) if read_at is not None else None,
    }


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    conversation_id: str = Field(alias="conversationId")
    sender_id: str = Field(alias="senderId")
    text: str
    sent_at: datetime = Field(alias="sentAt")
    # Derived watermark timestamps, not stored per-message — see
    # app/repositories/chat.py's compute_message_receipts. Null = not yet delivered/read.
    delivered_at: datetime | None = Field(default=None, alias="deliveredAt")
    read_at: datetime | None = Field(default=None, alias="readAt")

    @field_serializer("sent_at")
    def _serialize_sent_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @field_serializer("delivered_at")
    def _serialize_delivered_at(self, dt: datetime | None) -> str | None:
        return to_iso_z(dt) if dt is not None else None

    @field_serializer("read_at")
    def _serialize_read_at(self, dt: datetime | None) -> str | None:
        return to_iso_z(dt) if dt is not None else None


class ConversationOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    participant_ids: list[str] = Field(alias="participantIds")
    last_message_at: datetime = Field(alias="lastMessageAt")
    # Only populated on the list endpoint (GET /conversations) — absent (excluded via
    # response_model_exclude_none) on POST /conversations, matching
    # backend/src/repo/conversations.ts's Conversation.unreadCount semantics.
    unread_count: int | None = Field(default=None, alias="unreadCount")

    @field_serializer("last_message_at")
    def _serialize_last_message_at(self, dt: datetime) -> str:
        return to_iso_z(dt)


class CreateConversationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    peer_email: str | None = Field(default=None, alias="peerEmail")


class MarkReadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    up_to_sent_at: str | None = Field(default=None, alias="upToSentAt")


class UnreadCountOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    unread_count: int = Field(alias="unreadCount")
