from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import chat as chat_repo
from app.repositories import whiteboards as wb_repo
from app.schemas.whiteboard import (
    WhiteboardCreateIn,
    WhiteboardOut,
    WhiteboardSaveIn,
    WhiteboardSummaryOut,
)

# Whiteboard W1/W2 REST. Permission model is inherited wholesale from group chat: every
# endpoint resolves the board's conversation and requires the caller to be one of its
# participants (chat_repo.is_participant — the same check /conversations/{id}/messages uses).
# No board-level roles exist.

router = APIRouter(tags=["whiteboards"])

_NOT_PARTICIPANT = "Not a participant in this conversation"


async def _require_group_participant(db: AsyncSession, conversation_id: str, email: str) -> None:
    conv = await chat_repo.get_conversation_by_id(db, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if not await chat_repo.is_participant(db, conversation_id, email):
        raise HTTPException(status_code=403, detail=_NOT_PARTICIPANT)
    if conv.get("type") != "group":
        raise HTTPException(status_code=400, detail="Whiteboards attach to group conversations only")


async def _load_board_for(db: AsyncSession, board_id: str, email: str) -> dict:
    board = await wb_repo.get_by_id(db, board_id)
    if board is None:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    if not await chat_repo.is_participant(db, board["conversation_id"], email):
        raise HTTPException(status_code=403, detail=_NOT_PARTICIPANT)
    return board


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
    await _require_group_participant(db, conversation_id, email)
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
    await _require_group_participant(db, conversation_id, email)
    return await wb_repo.create(
        db, conversation_id=conversation_id, title=body.title.strip(), creator_email=email
    )


@router.get("/whiteboards/{board_id}", response_model=WhiteboardOut, response_model_by_alias=True)
async def get_whiteboard(
    board_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
):
    return await _load_board_for(db, board_id, email)


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
