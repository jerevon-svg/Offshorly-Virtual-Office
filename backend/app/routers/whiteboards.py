from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.realtime.state import call_registry
from app.repositories import chat as chat_repo
from app.repositories import whiteboards as wb_repo
from app.schemas.calls import CallTokenOut
from app.services.livekit_tokens import livekit_config, mint_voice_token
from app.services.whiteboard_access import can_access, normalize_room_id
from app.schemas.whiteboard import (
    WhiteboardCreateIn,
    WhiteboardOut,
    WhiteboardSaveIn,
    WhiteboardSummaryOut,
)

# Whiteboard W1/W2 (+ W4) REST. Two scopes, one board type, one access rule
# (services/whiteboard_access.can_access — shared with the realtime join):
#  - /conversations/{id}/whiteboards: permission inherited wholesale from chat — the caller must
#    be a participant (chat_repo.is_participant, the same check /conversations/{id}/messages
#    uses). Any conversation type qualifies — a 1:1 DM (which the spatial 1:1 window resolves to
#    as well, via the deterministic dm_key, so both surfaces see the same boards) or a group.
#  - /rooms/{room_id}/whiteboards: office room boards (W4), open to every authenticated user.
# /whiteboards/{id} serves both. No board-level roles exist.

router = APIRouter(tags=["whiteboards"])

_NOT_PARTICIPANT = "Not a participant in this conversation"


async def _require_participant(db: AsyncSession, conversation_id: str, email: str) -> None:
    conv = await chat_repo.get_conversation_by_id(db, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if not await chat_repo.is_participant(db, conversation_id, email):
        raise HTTPException(status_code=403, detail=_NOT_PARTICIPANT)


async def _load_board_for(db: AsyncSession, board_id: str, email: str) -> dict:
    board = await wb_repo.get_by_id(db, board_id)
    if board is None:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    if not await can_access(db, board, email):
        raise HTTPException(status_code=403, detail=_NOT_PARTICIPANT)
    return board


def _require_room_id(raw: str) -> str:
    room_id = normalize_room_id(raw)
    if room_id is None:
        raise HTTPException(status_code=422, detail="Invalid room id")
    return room_id


@router.get(
    "/conversations/{conversation_id}/whiteboards",
    response_model=list[WhiteboardSummaryOut],
    response_model_by_alias=True,
)
async def list_whiteboards(
    conversation_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
):
    await _require_participant(db, conversation_id, email)
    return await wb_repo.list_for_conversation(db, conversation_id)


@router.post(
    "/conversations/{conversation_id}/whiteboards",
    response_model=WhiteboardOut,
    response_model_by_alias=True,
    status_code=201,
)
async def create_whiteboard(
    conversation_id: str,
    body: WhiteboardCreateIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
):
    await _require_participant(db, conversation_id, email)
    return await wb_repo.create(
        db, conversation_id=conversation_id, title=body.title.strip(), creator_email=email
    )


@router.get(
    "/rooms/{room_id}/whiteboards",
    response_model=list[WhiteboardSummaryOut],
    response_model_by_alias=True,
)
async def list_room_whiteboards(
    room_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
):
    del email  # authenticated is enough — see services/whiteboard_access.py
    return await wb_repo.list_for_room(db, _require_room_id(room_id))


@router.post(
    "/rooms/{room_id}/whiteboards",
    response_model=WhiteboardOut,
    response_model_by_alias=True,
    status_code=201,
)
async def create_room_whiteboard(
    room_id: str,
    body: WhiteboardCreateIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
):
    return await wb_repo.create(
        db, room_id=_require_room_id(room_id), title=body.title.strip(), creator_email=email
    )


@router.get("/whiteboards/{board_id}", response_model=WhiteboardOut, response_model_by_alias=True)
async def get_whiteboard(
    board_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
):
    return await _load_board_for(db, board_id, email)


def voice_room_key(board_id: str) -> str:
    """The CallRegistry key for a board's voice room. Namespaced so it can never collide with a
    spatial session id; the registry mints an opaque room name for it exactly as for calls."""
    return f"whiteboard:{board_id}"


@router.post("/whiteboards/{board_id}/voice/token", response_model=CallTokenOut)
async def create_board_voice_token(
    board_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> CallTokenOut:
    """W5-B board voice: a short-lived LiveKit token for THIS board's voice room. Eligibility is
    the board's own access rule (can_access — conversation participant, or any signed-in user for
    a room/office board), the same rule the REST reads and the realtime join apply. No minimum
    head-count: someone may open voice and wait for collaborators. Identity comes from the
    verified bearer/dev identity, never from the request. Grants and TTL are shared with
    /calls/token via services/livekit_tokens.py — there is no second calling system."""
    livekit_config()
    await _load_board_for(db, board_id, email)
    room = call_registry.room_for_session(voice_room_key(board_id))
    return CallTokenOut(**mint_voice_token(email, room))


@router.put("/whiteboards/{board_id}", response_model=WhiteboardOut, response_model_by_alias=True)
async def save_whiteboard(
    board_id: str,
    body: WhiteboardSaveIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
):
    await _load_board_for(db, board_id, email)
    saved = await wb_repo.save_document(
        db,
        board_id=board_id,
        document=body.document,
        expected_version=body.version,
        editor_email=email,
    )
    if saved is None:
        raise HTTPException(
            status_code=409,
            detail="Whiteboard was saved by someone else since you loaded it — reload to continue",
        )
    return saved
