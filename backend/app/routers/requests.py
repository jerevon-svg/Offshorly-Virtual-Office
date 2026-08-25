from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.realtime.socket import sio, user_room
from app.repositories import chat as chat_repo
from app.repositories import requests as requests_repo
from app.schemas.requests import CreateRequestIn, RequestOut, ResolveRequestIn

# "Ask to Join + Group Conversation" REST layer — mirrors routers/chat.py's dependency pattern
# (server-derived identity via get_current_email, a per-request AsyncSession via get_db).

router = APIRouter(tags=["requests"])

_DECISION_TO_STATE = {"accept": "accepted", "decline": "declined"}


@router.post("/requests", response_model=RequestOut, status_code=201)
async def create_request(
    body: CreateRequestIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> RequestOut:
    if not body.kind or not body.kind.strip():
        raise HTTPException(status_code=400, detail="kind is required")

    req = await requests_repo.create_request(
        db,
        kind=body.kind.strip(),
        requester_email=email,
        conversation_id=body.conversation_id,
        payload=body.payload,
    )

    # Notify every participant of the target conversation (mirrors the unread_count push
    # pattern in socket.py) so the ask-to-join prompt can show up live, not just on next poll.
    if req["conversation_id"] is not None:
        conv = await chat_repo.get_conversation_by_id(db, req["conversation_id"])
        participants = conv["participant_ids"] if conv else []
        out = RequestOut.from_dict(req)
        for participant_email in participants:
            await sio.emit(
                "request_created",
                out.model_dump(by_alias=True),
                room=user_room(participant_email),
            )

    return RequestOut.from_dict(req)


@router.get("/requests/pending", response_model=list[RequestOut])
async def list_pending_requests(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[RequestOut]:
    reqs = await requests_repo.list_pending_for_participant(db, email)
    return [RequestOut.from_dict(r) for r in reqs]


@router.post("/requests/{request_id}/resolve", response_model=RequestOut)
async def resolve_request(
    request_id: str,
    body: ResolveRequestIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> RequestOut:
    req = await requests_repo.get_request_by_id(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")

    conversation_id = req["conversation_id"]
    if conversation_id is None:
        # No create-group-request flow exists yet in this stage, so a null conversation_id here
        # shouldn't be reachable in practice — there's no conversation to authorize membership
        # against, so this can't be resolved via this endpoint. Fail closed rather than crash.
        raise HTTPException(status_code=400, detail="Request has no associated conversation")

    is_participant = await chat_repo.is_participant(db, conversation_id, email)
    if not is_participant:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")

    new_state = _DECISION_TO_STATE[body.decision]

    if new_state == "accepted" and req["kind"] == "join_group":
        # Single-transaction accept: conditional state flip + participant-add commit together,
        # so a crash mid-way can never leave the request "accepted" without the requester
        # actually being a participant (see accept_join_request docstring).
        updated = await requests_repo.accept_join_request(
            db,
            request_id=request_id,
            conversation_id=conversation_id,
            requester_email=req["requester_email"],
            resolver_email=email,
        )
        if updated is None:
            raise HTTPException(status_code=409, detail="Request has already been resolved")
    else:
        result_conversation_id = conversation_id if new_state == "accepted" else None
        changed = await requests_repo.resolve_request(
            db,
            request_id=request_id,
            resolver_email=email,
            new_state=new_state,
            result_conversation_id=result_conversation_id,
        )
        if not changed:
            raise HTTPException(status_code=409, detail="Request has already been resolved")
        updated = await requests_repo.get_request_by_id(db, request_id)

    out = RequestOut.from_dict(updated) if updated else RequestOut.from_dict(req)

    # If accepting a join_group request against a DM upgraded it into a brand-new group
    # conversation (see accept_join_request's docstring), migrate every already-connected socket
    # of the new members into the new conversation's room and tell all three clients live — the
    # old DM room/history is untouched, but clients still watching that stale room need to know
    # to switch over rather than just polling for it.
    if new_state == "accepted" and req["kind"] == "join_group" and updated is not None:
        new_cid = updated["result_conversation_id"]
        if new_cid is not None and new_cid != conversation_id:
            new_conv = await chat_repo.get_conversation_by_id(db, new_cid)
            members = new_conv["participant_ids"] if new_conv else []
            for member in members:
                for sid, _ in list(sio.manager.get_participants("/", user_room(member))):
                    await sio.enter_room(sid, new_cid)
            payload = {
                "oldConversationId": conversation_id,
                "newConversationId": new_cid,
                "participants": members,
            }
            for member in members:
                await sio.emit("conversation_upgraded", payload, room=user_room(member))

    # Fan out to every participant of the target conversation (mirrors create_request's
    # broadcast) so stale prompts on OTHER participants' screens also clear, not just the
    # requester's. For an accepted join_group request, the requester has just been added as a
    # participant by accept_join_request(), so re-loading participants here picks them up too.
    conv = await chat_repo.get_conversation_by_id(db, conversation_id)
    recipients = set(conv["participant_ids"]) if conv else set()
    recipients.add(req["requester_email"])
    for participant_email in recipients:
        await sio.emit(
            "request_resolved",
            out.model_dump(by_alias=True),
            room=user_room(participant_email),
        )

    return out


@router.post("/requests/{request_id}/cancel", response_model=RequestOut)
async def cancel_request(
    request_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> RequestOut:
    req = await requests_repo.get_request_by_id(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if req["requester_email"] != email.strip().lower():
        raise HTTPException(status_code=403, detail="Not the requester of this request")

    changed = await requests_repo.cancel_request(db, request_id=request_id, requester_email=email)
    if not changed:
        raise HTTPException(status_code=409, detail="Request has already been resolved")

    updated = await requests_repo.get_request_by_id(db, request_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Request not found")
    out = RequestOut.from_dict(updated)

    # Same fan-out as resolve_request: notify every participant of the target conversation,
    # not just the requester, so their stale prompts clear too.
    recipients = {updated["requester_email"]}
    if updated["conversation_id"] is not None:
        conv = await chat_repo.get_conversation_by_id(db, updated["conversation_id"])
        if conv:
            recipients.update(conv["participant_ids"])
    for participant_email in recipients:
        await sio.emit(
            "request_cancelled",
            out.model_dump(by_alias=True),
            room=user_room(participant_email),
        )

    return out
