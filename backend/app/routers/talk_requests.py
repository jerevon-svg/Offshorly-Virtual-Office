from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.realtime.socket import dnd_registry, sio, user_room
from app.repositories import talk_requests as talk_requests_repo
from app.schemas.chat import to_iso_z
from app.schemas.talk_requests import (
    CreateTalkRequestIn,
    ResolveTalkRequestIn,
    TalkRequestOut,
)

# "Request Permission to Talk" REST layer — mirrors routers/room_requests.py's dependency
# pattern. Kept as a separate router/table from both Ask-to-Join and Request Entry (see
# app/models/talk_request.py's docstring): the target is a specific DND person, and only that
# person may resolve.

router = APIRouter(tags=["talk-requests"])

_DECISION_TO_STATE = {"accept": "accepted", "decline": "declined"}


@router.post("/talk-requests", response_model=TalkRequestOut, status_code=201)
async def create_talk_request(
    body: CreateTalkRequestIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> TalkRequestOut:
    target_email = body.target_email.strip().lower()
    if not target_email:
        raise HTTPException(status_code=400, detail="targetEmail is required")
    if target_email == email.strip().lower():
        raise HTTPException(status_code=400, detail="Cannot request permission to talk to yourself")
    if not dnd_registry.is_dnd(target_email):
        raise HTTPException(status_code=400, detail="Target is not currently in Do Not Disturb")

    cooldown_until = await talk_requests_repo.get_cooldown_until(
        db, target_email=target_email, requester_email=email
    )
    if cooldown_until is not None:
        raise HTTPException(
            status_code=429,
            detail={"error": "Recently declined — try again later", "cooldownUntil": to_iso_z(cooldown_until)},
        )

    req = await talk_requests_repo.create_request(
        db, target_email=target_email, requester_email=email, kind=body.kind
    )
    out = TalkRequestOut.from_dict(req)

    await sio.emit("talk_request_created", out.model_dump(by_alias=True), room=user_room(target_email))

    return out


@router.get("/talk-requests/pending", response_model=list[TalkRequestOut])
async def list_pending_talk_requests(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[TalkRequestOut]:
    """Pending "request permission to talk" requests targeting the signed-in user — mirrors
    Ask-to-Join/Request-Entry's GET .../pending reconnect precedent."""
    reqs = await talk_requests_repo.list_pending_for_target(db, email)
    return [TalkRequestOut.from_dict(r) for r in reqs]


@router.post("/talk-requests/{request_id}/resolve", response_model=TalkRequestOut)
async def resolve_talk_request(
    request_id: str,
    body: ResolveTalkRequestIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> TalkRequestOut:
    req = await talk_requests_repo.get_request_by_id(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["target_email"] != email.strip().lower():
        raise HTTPException(status_code=403, detail="Not the target of this request")

    new_state = _DECISION_TO_STATE[body.decision]
    changed = await talk_requests_repo.resolve_request(
        db, request_id=request_id, resolver_email=email, new_state=new_state
    )
    if not changed:
        raise HTTPException(status_code=409, detail="Request has already been resolved")

    updated = await talk_requests_repo.get_request_by_id(db, request_id)
    out = TalkRequestOut.from_dict(updated) if updated else TalkRequestOut.from_dict(req)

    # Fan out to the requester (their result) AND the target's own other tabs/sockets, so a
    # second open tab's stale prompt clears too — same reasoning as room_requests's fan-out.
    for recipient in {req["requester_email"], req["target_email"]}:
        await sio.emit("talk_request_resolved", out.model_dump(by_alias=True), room=user_room(recipient))

    return out


@router.post("/talk-requests/{request_id}/cancel", response_model=TalkRequestOut)
async def cancel_talk_request(
    request_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> TalkRequestOut:
    req = await talk_requests_repo.get_request_by_id(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["requester_email"] != email.strip().lower():
        raise HTTPException(status_code=403, detail="Not the requester of this request")

    changed = await talk_requests_repo.cancel_request(db, request_id=request_id, requester_email=email)
    if not changed:
        raise HTTPException(status_code=409, detail="Request has already been resolved")

    updated = await talk_requests_repo.get_request_by_id(db, request_id)
    out = TalkRequestOut.from_dict(updated) if updated else TalkRequestOut.from_dict(req)

    for recipient in {req["requester_email"], req["target_email"]}:
        await sio.emit("talk_request_cancelled", out.model_dump(by_alias=True), room=user_room(recipient))

    return out
