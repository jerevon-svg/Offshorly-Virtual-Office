from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z

# camelCase wire shapes for Scheduled Meetings V1 — same conventions as schemas/room_requests.py
# (populate_by_name aliasing, to_iso_z for datetimes). Timestamps in are parsed by pydantic and must
# carry an offset; the service rejects naive ones and normalises everything to UTC.


class CreateScheduledMeetingIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str
    room_id: str = Field(alias="roomId")
    starts_at: datetime = Field(alias="startsAt")
    ends_at: datetime = Field(alias="endsAt")
    is_private: bool = Field(default=False, alias="isPrivate")
    invitee_emails: list[str] = Field(default_factory=list, alias="inviteeEmails")


class UpdateScheduledMeetingIn(BaseModel):
    """Every field optional; omitted means unchanged. `inviteeEmails`, when given, REPLACES the list
    (the organizer is always kept, and a retained invitee keeps their response)."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = None
    room_id: str | None = Field(default=None, alias="roomId")
    starts_at: datetime | None = Field(default=None, alias="startsAt")
    ends_at: datetime | None = Field(default=None, alias="endsAt")
    is_private: bool | None = Field(default=None, alias="isPrivate")
    invitee_emails: list[str] | None = Field(default=None, alias="inviteeEmails")


class RespondScheduledMeetingIn(BaseModel):
    response: Literal["accepted", "declined"]


class InviteeOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    response: str


class ScheduledMeetingOut(BaseModel):
    """The full meeting — only ever returned to its organizer and invitees."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    room_id: str = Field(alias="roomId")
    organizer_email: str = Field(alias="organizerEmail")
    starts_at: datetime = Field(alias="startsAt")
    ends_at: datetime = Field(alias="endsAt")
    is_private: bool = Field(alias="isPrivate")
    status: str
    invitees: list[InviteeOut]
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_serializer("starts_at", "ends_at", "created_at", "updated_at")
    def _iso(self, dt: datetime) -> str:
        return to_iso_z(dt)


class RoomBookingOut(BaseModel):
    """One booking as the WHOLE FLOOR may see it (signage). For a private meeting the viewer is not
    invited to, everything but the room, the window and the private flag is null."""

    model_config = ConfigDict(populate_by_name=True)

    id: str | None
    room_id: str = Field(alias="roomId")
    starts_at: datetime = Field(alias="startsAt")
    ends_at: datetime = Field(alias="endsAt")
    is_private: bool = Field(alias="isPrivate")
    title: str | None
    organizer_email: str | None = Field(alias="organizerEmail")
    viewer_is_invitee: bool = Field(alias="viewerIsInvitee")

    @field_serializer("starts_at", "ends_at")
    def _iso(self, dt: datetime) -> str:
        return to_iso_z(dt)


class RoomAvailabilityOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    room_id: str = Field(alias="roomId")
    name: str
    capacity: int
    available: bool
