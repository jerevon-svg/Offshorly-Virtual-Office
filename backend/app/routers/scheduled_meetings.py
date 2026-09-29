from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.realtime.state import sio
from app.schemas.scheduled_meetings import (
    CreateScheduledMeetingIn,
    RespondScheduledMeetingIn,
    RoomAvailabilityOut,
    RoomBookingOut,
    ScheduledMeetingOut,
    UpdateScheduledMeetingIn,
)
from app.services import meeting_briefing
from app.services import scheduled_meetings as service

# Scheduled Meetings V1 REST layer — the same dependency pattern as every router here: identity from
# get_current_email, a per-request AsyncSession from get_db. Thin by design; every rule is in
# services/scheduled_meetings.py.
#
# REALTIME is one payload-free nudge, `scheduled_meetings_changed`, broadcast after every committed
# change: each client re-asks /mine and /rooms/today under its OWN identity, so the server's privacy
# rules decide what it sees and nothing private ever travels in the event. An edit or cancel also
# re-broadcasts meeting_presence, whose `booking` field describes a live room's booking.

router = APIRouter(prefix="/scheduled-meetings", tags=["scheduled-meetings"])
_logger = logging.getLogger(__name__)


async def _announce(*, presence: bool = False) -> None:
    try:
        await sio.emit("scheduled_meetings_changed", {})
        if presence:
            # Imported here: socket.py imports the routers' neighbours at load, not the other way round.
            from app.realtime.socket import _broadcast_meeting_presence

            await _broadcast_meeting_presence()
    except Exception:  # noqa: BLE001 - the change is committed; a lost nudge is healed by the next fetch
        _logger.exception("scheduled meetings broadcast failed")


@router.post("", response_model=ScheduledMeetingOut, status_code=201, response_model_by_alias=True)
async def create_scheduled_meeting(
    body: CreateScheduledMeetingIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ScheduledMeetingOut:
    out = await service.create(db, body, email)
    await _announce()
    return out


@router.get("/mine", response_model=list[ScheduledMeetingOut], response_model_by_alias=True)
async def list_my_scheduled_meetings(
    starts_at: datetime | None = Query(default=None, alias="from"),
    ends_at: datetime | None = Query(default=None, alias="to"),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[ScheduledMeetingOut]:
    return await service.list_mine(db, email, starts_at, ends_at)


@router.get("/rooms/availability", response_model=list[RoomAvailabilityOut], response_model_by_alias=True)
async def room_availability(
    starts_at: datetime = Query(alias="startsAt"),
    ends_at: datetime = Query(alias="endsAt"),
    _email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[RoomAvailabilityOut]:
    return await service.availability(db, starts_at, ends_at)


@router.get("/rooms/today", response_model=list[RoomBookingOut], response_model_by_alias=True)
async def rooms_today(
    starts_at: datetime | None = Query(default=None, alias="from"),
    ends_at: datetime | None = Query(default=None, alias="to"),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[RoomBookingOut]:
    return await service.floor_bookings(db, email, starts_at, ends_at)


@router.patch("/{meeting_id}", response_model=ScheduledMeetingOut, response_model_by_alias=True)
async def update_scheduled_meeting(
    meeting_id: str,
    body: UpdateScheduledMeetingIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ScheduledMeetingOut:
    out = await service.update(db, meeting_id, body, email)
    await _announce(presence=True)
    return out


@router.delete("/{meeting_id}", response_model=ScheduledMeetingOut, response_model_by_alias=True)
async def cancel_scheduled_meeting(
    meeting_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ScheduledMeetingOut:
    out = await service.cancel(db, meeting_id, email)
    await _announce(presence=True)
    return out


@router.patch("/{meeting_id}/response", response_model=ScheduledMeetingOut, response_model_by_alias=True)
async def respond_to_scheduled_meeting(
    meeting_id: str,
    body: RespondScheduledMeetingIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ScheduledMeetingOut:
    out = await service.respond(db, meeting_id, email, body.response)
    await _announce()
    return out


# PHASE 9C — the pre-meeting briefing (services/meeting_briefing.py). A booking the caller is not on is 404, the
# same as every other read of it; its history is gated per past Meeting Session inside the service.


class BriefingAvailabilityIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=meeting_briefing.MAX_AVAILABILITY_IDS)


@router.post("/briefings/availability")
async def briefing_availability(
    body: BriefingAvailabilityIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return {"available": await meeting_briefing.availability(db, body.ids, email)}


@router.get("/{meeting_id}/briefing")
async def meeting_briefing_read(
    meeting_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> dict:
    out = await meeting_briefing.briefing(db, meeting_id, email)
    if out is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return out
