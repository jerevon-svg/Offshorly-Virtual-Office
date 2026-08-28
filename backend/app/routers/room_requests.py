from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.realtime.socket import (
    dnd_registry,
    is_room_locked,
    room_presence,
    sio,
    user_room,
)
from app.repositories import room_requests as room_requests_repo
from app.schemas.room_requests import (
    CreateRoomRequestIn,
    ResolveRoomRequestIn,
    RoomRequestOut,
)

# "Request Entry / Knock" REST layer — mirrors routers/requests.py's dependency pattern
# (server-derived identity via get_current_email, a per-request AsyncSession via get_db).
# Kept as a separate router/table from Ask-to-Join (see app/models/room_request.py's docstring):
# authorization here is against live spatial/DND state (RoomPresenceRegistry + DndRegistry in
# app/realtime/socket.py), not conversation participancy.

router = APIRouter(tags=["room-requests"])

_DECISION_TO_STATE = {"accept": "accepted", "decline": "declined"}


def _eligible_resolvers(room_id: str) -> list[str]:
    """Current DND occupants of room_id — the only people allowed to Allow/Decline a knock
    against it (feature spec section 5: "Any current DND occupant of that room")."""
    return [email for email in room_presence.occupants(room_id) if dnd_registry.is_dnd(email)]


@router.post("/room-requests", response_model=RoomRequestOut, status_code=201)
async def create_room_request(
    body: CreateRoomRequestIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> RoomRequestOut:
    room_id = body.room_id.strip()
    if not room_id:
        raise HTTPException(status_code=400, detail="roomId is required")
    if not is_room_locked(room_id):
        raise HTTPException(status_code=400, detail="Room is not currently locked")

    req = await room_requests_repo.create_request(db, room_id=room_id, requester_email=email)
    out = RoomRequestOut.from_dict(req)

    # Notify only current DND occupants of the room (the eligible resolvers) — mirrors
    # create_request's participant fan-out in routers/requests.py, scoped to spatial/DND state
    # instead of conversation membership.
    for resolver_email in _eligible_resolvers(room_id):
        await sio.emit("room_request_created", out.model_dump(by_alias=True), room=user_room(resolver_email))

    return out


@router.get("/room-requests/pending", response_model=list[RoomRequestOut])
async def list_pending_room_requests(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[RoomRequestOut]:
    """Pending Knock requests targeting the room the signed-in user currently occupies — lets a
    DND occupant who just reconnected (or opened a second tab) see an outstanding prompt live,
    following the same reconnect precedent as Ask-to-Join's GET /requests/pending."""
    room_id = room_presence.room_of(email)
    if room_id is None:
        return []
    reqs = await room_requests_repo.list_pending_for_room(db, room_id)
    return [RoomRequestOut.from_dict(r) for r in reqs]


@router.post("/room-requests/{request_id}/resolve", response_model=RoomRequestOut)
async def resolve_room_request(
    request_id: str,
    body: ResolveRoomRequestIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> RoomRequestOut:
    req = await room_requests_repo.get_request_by_id(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")

    if email not in _eligible_resolvers(req["room_id"]):
        raise HTTPException(status_code=403, detail="Not a DND occupant of this room")

    new_state = _DECISION_TO_STATE[body.decision]
    changed = await room_requests_repo.resolve_request(
        db, request_id=request_id, resolver_email=email, new_state=new_state
    )
    if not changed:
        raise HTTPException(status_code=409, detail="Request has already been resolved")

    updated = await room_requests_repo.get_request_by_id(db, request_id)
    out = RoomRequestOut.from_dict(updated) if updated else RoomRequestOut.from_dict(req)

    # Fan out to the requester (so they get their Allow/Decline result live) AND every current
    # occupant of the room (so a second DND occupant's still-open prompt for the same request
    # clears too, per the feature spec's "first valid decision resolves the request" rule).
    recipients = set(room_presence.occupants(req["room_id"]))
    recipients.add(req["requester_email"])
    for recipient in recipients:
        await sio.emit("room_request_resolved", out.model_dump(by_alias=True), room=user_room(recipient))

    return out


@router.post("/room-requests/{request_id}/cancel", response_model=RoomRequestOut)
async def cancel_room_request(
    request_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> RoomRequestOut:
    req = await room_requests_repo.get_request_by_id(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["requester_email"] != email.strip().lower():
        raise HTTPException(status_code=403, detail="Not the requester of this request")

    changed = await room_requests_repo.cancel_request(db, request_id=request_id, requester_email=email)
    if not changed:
        raise HTTPException(status_code=409, detail="Request has already been resolved")

    updated = await room_requests_repo.get_request_by_id(db, request_id)
    out = RoomRequestOut.from_dict(updated) if updated else RoomRequestOut.from_dict(req)

    recipients = set(room_presence.occupants(req["room_id"]))
    recipients.add(req["requester_email"])
    for recipient in recipients:
        await sio.emit("room_request_cancelled", out.model_dump(by_alias=True), room=user_room(recipient))

    return out
