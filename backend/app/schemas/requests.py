from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z

# camelCase wire shapes for the "Ask to Join + Group Conversation" request flow — mirrors
# app/schemas/chat.py's conventions (populate_by_name aliasing, to_iso_z for datetimes).


class CreateRequestIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: str
    conversation_id: str | None = Field(default=None, alias="conversationId")
    payload: dict[str, Any] | None = Field(default=None)


class ResolveRequestIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    decision: Literal["accept", "decline"]


class RequestOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    kind: str
    conversation_id: str | None = Field(default=None, alias="conversationId")
    requester_email: str = Field(alias="requesterEmail")
    state: str
    resolver_email: str | None = Field(default=None, alias="resolverEmail")
    result_conversation_id: str | None = Field(default=None, alias="resultConversationId")
    payload: dict[str, Any] | None = Field(default=None)
    resolved_at: datetime | None = Field(default=None, alias="resolvedAt")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_serializer("resolved_at")
    def _serialize_resolved_at(self, dt: datetime | None) -> str | None:
        return to_iso_z(dt) if dt is not None else None

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @field_serializer("updated_at")
    def _serialize_updated_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RequestOut:
        return cls(
            id=d["id"],
            kind=d["kind"],
            conversation_id=d["conversation_id"],
            requester_email=d["requester_email"],
            state=d["state"],
            resolver_email=d["resolver_email"],
            result_conversation_id=d["result_conversation_id"],
            payload=d["payload"],
            resolved_at=d["resolved_at"],
            created_at=d["created_at"],
            updated_at=d["updated_at"],
        )
