from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z

# camelCase wire shapes for the "Request Entry / Knock" room-lock request flow — mirrors
# app/schemas/requests.py's conventions (populate_by_name aliasing, to_iso_z for datetimes).
# Deliberately a separate schema module from requests.py's Ask-to-Join shapes (see
# app/models/room_request.py's docstring for why the two stay logically separate).


class CreateRoomRequestIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    room_id: str = Field(alias="roomId")


class ResolveRoomRequestIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    decision: Literal["accept", "decline"]


class RoomRequestOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    room_id: str = Field(alias="roomId")
    requester_email: str = Field(alias="requesterEmail")
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
    def from_dict(cls, d: dict) -> RoomRequestOut:
        return cls(
            id=d["id"],
            room_id=d["room_id"],
            requester_email=d["requester_email"],
            state=d["state"],
            resolver_email=d["resolver_email"],
            resolved_at=d["resolved_at"],
            created_at=d["created_at"],
            updated_at=d["updated_at"],
        )
