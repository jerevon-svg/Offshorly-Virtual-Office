from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z

# camelCase wire shapes for the "Request Permission to Talk" person-level DND request flow —
# mirrors app/schemas/room_requests.py's conventions. Deliberately a separate schema module (see
# app/models/talk_request.py's docstring for why the two stay logically separate).


class CreateTalkRequestIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target_email: str = Field(alias="targetEmail")
    kind: Literal["chat", "approach"] = "chat"


class ResolveTalkRequestIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    decision: Literal["accept", "decline"]


class TalkRequestOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    target_email: str = Field(alias="targetEmail")
    requester_email: str = Field(alias="requesterEmail")
    kind: str
    state: str
    resolver_email: str | None = Field(default=None, alias="resolverEmail")
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
    def from_dict(cls, d: dict) -> TalkRequestOut:
        return cls(
            id=d["id"],
            target_email=d["target_email"],
            requester_email=d["requester_email"],
            kind=d["kind"],
            state=d["state"],
            resolver_email=d["resolver_email"],
            resolved_at=d["resolved_at"],
            created_at=d["created_at"],
            updated_at=d["updated_at"],
        )
