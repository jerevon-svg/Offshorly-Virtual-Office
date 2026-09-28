from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.services import meeting_capture

# PHASE 6B — authorized reads of what belongs to a Meeting Session. Every read goes through
# services/meeting_access (inside meeting_capture.read_transcript) BEFORE any content loads; an unauthorized
# caller gets the same 404 as a session that does not exist, so an id reveals nothing.

router = APIRouter(prefix="/meeting-sessions", tags=["meeting-sessions"])


@router.get("/{session_id}/transcript")
async def get_transcript(
    session_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> dict:
    out = await meeting_capture.read_transcript(db, session_id, email)
    if out is None:
        raise HTTPException(status_code=404, detail="Not found")
    return out
