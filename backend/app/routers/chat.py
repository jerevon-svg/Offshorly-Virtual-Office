from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import chat as chat_repo
from app.schemas.chat import (
    ChatMessageOut,
    ConversationOut,
    CreateConversationRequest,
    MarkReadRequest,
    UnreadCountOut,
)

# Faithful port of backend/src/http.ts's 4 REST endpoints. Identity is always derived
# server-side via get_current_email — request bodies never supply a trusted sender/user id.

router = APIRouter(tags=["chat"])


def _parse_iso(value: str) -> datetime:
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@router.post("/conversations", response_model=ConversationOut, response_model_exclude_none=True)
async def create_conversation(
    body: CreateConversationRequest,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    peer_email = body.peer_email.strip() if body.peer_email else ""
    if not peer_email:
        raise HTTPException(status_code=400, detail="peerEmail is required")

    conv = await chat_repo.upsert_conversation(db, email, peer_email)
    return ConversationOut(
        id=conv["id"],
        participant_ids=conv["participant_ids"],
        last_message_at=conv["last_message_at"],
    )


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    convs = await chat_repo.list_conversations_for_user(db, email)
    return [
        ConversationOut(
            id=c["id"],
            participant_ids=c["participant_ids"],
            last_message_at=c["last_message_at"],
            unread_count=c["unread_count"],
        )
        for c in convs
    ]


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessageOut])
async def get_conversation_messages(
    conversation_id: str,
    since: str | None = Query(default=None),
    before: str | None = Query(default=None),
    limit: int | None = Query(default=None),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[ChatMessageOut]:
    participant = await chat_repo.is_participant(db, conversation_id, email)
    if not participant:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")

    since_dt = _parse_iso(since) if since else None
    before_dt = _parse_iso(before) if before else None
    messages = await chat_repo.list_messages(
        db, conversation_id, since=since_dt, before=before_dt, limit=limit
    )
    return [
        ChatMessageOut(
            id=m.id,
            conversation_id=m.conversation_id,
            sender_id=m.sender_email,
            text=m.text,
            sent_at=m.sent_at,
        )
        for m in messages
    ]


@router.post("/conversations/{conversation_id}/read", response_model=UnreadCountOut)
async def mark_conversation_read(
    conversation_id: str,
    body: MarkReadRequest | None = Body(default=None),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> UnreadCountOut:
    participant = await chat_repo.is_participant(db, conversation_id, email)
    if not participant:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")

    up_to_raw = body.up_to_sent_at if body else None
    up_to_sent_at = _parse_iso(up_to_raw) if up_to_raw else datetime.now(timezone.utc)

    await chat_repo.mark_read(db, conversation_id, email, up_to_sent_at)
    count = await chat_repo.unread_count(db, conversation_id, email)
    return UnreadCountOut(unread_count=count)
