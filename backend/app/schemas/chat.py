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
    message, delivered_to: list[str], read_by: list[str], reactions: list[dict] | None = None
) -> dict:
    """Plain-dict serializer used by the socket layer (app/realtime/socket.py), which emits raw
    JSON-able payloads rather than FastAPI response models. `deliveredTo`/`readBy` are per-reader
    email lists derived from watermark comparisons (see app/repositories/chat.py's
    compute_message_receipts) — an empty list means nobody yet, never null. `mentionedEmails` is
    always a list (never null on the wire) even though the column is nullable — pre-mentions rows
    and messages with no mentions both serialize to []. `reactions` is likewise always a list —
    grouped [{emoji, count, reactors}] entries (see repositories/chat.py's
    get_reactions_for_messages); pre-reactions rows and messages nobody reacted to both
    serialize to [], which is what keeps every existing message backward compatible."""
    return {
        "id": message.id,
        "conversationId": message.conversation_id,
        "senderId": message.sender_email,
        "text": message.text,
        "sentAt": to_iso_z(message.sent_at),
        "deliveredTo": list(delivered_to),
        "readBy": list(read_by),
        "mentionedEmails": list(message.mentioned_emails or []),
        "reactions": [
            {"emoji": r["emoji"], "count": r["count"], "reactors": list(r["reactors"])}
            for r in (reactions or [])
        ],
    }


class MessageReactionOut(BaseModel):
    """One emoji's worth of reactions on a message, already aggregated server-side so the
    client never counts rows itself. `reactors` is the sorted list of participant emails who
    hold this emoji — cheap to include (the repo already has them) and it powers the chip's
    hover tooltip."""

    model_config = ConfigDict(populate_by_name=True)

    emoji: str
    count: int
    reactors: list[str] = Field(default_factory=list)


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
    # @mentions V1 — server-validated participant emails (see insert_message). Empty list, never
    # null, for both "no mentions" and pre-mentions-feature rows.
    mentioned_emails: list[str] = Field(default_factory=list, alias="mentionedEmails")
    # Grouped emoji reactions — one entry per distinct emoji. Same "always a list, never null"
    # convention as mentioned_emails above: a message nobody reacted to serializes as [].
    reactions: list[MessageReactionOut] = Field(default_factory=list)

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
    # Mirrors unread_count's "only populated on the list endpoint" convention — count of unread
    # messages that mention the caller (see repositories/chat.py's mention_count). Feature spec
    # section 15: "lightweight indicator/count where the existing conversation list can support
    # it cleanly" — this IS that list.
    mention_count: int | None = Field(default=None, alias="mentionCount")
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
