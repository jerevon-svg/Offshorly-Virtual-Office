from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.schemas.meeting_intelligence import ReviewItemIn
from app.services import meeting_capture, meeting_intelligence, meeting_receipt

# PHASE 6B — authorized reads of what belongs to a Meeting Session. Every read goes through
# services/meeting_access (inside meeting_capture.read_transcript) BEFORE any content loads; an unauthorized
# caller gets the same 404 as a session that does not exist, so an id reveals nothing.
#
# PHASE 7A — Meeting Intelligence under the same session. Reads use the same gate and the same 404.
# Generating and reviewing need the narrower curate authority (services/meeting_intelligence.may_curate):
# a reader who may not curate gets 403; a refused state gets 409 with a stable code as the detail.
#
# PHASE 7C — Meeting Receipt reads: the caller's recent ended sessions (every row through the same gate) and
# one session's identity + actual attendance + whether the caller may curate. Same gate, same 404.

router = APIRouter(prefix="/meeting-sessions", tags=["meeting-sessions"])

_ERROR_STATUS = {
    "not_found": 404,
    "not_allowed": 403,
    "meeting_active": 409,
    "capture_active": 409,
    "no_transcript": 409,
    "generation_in_progress": 409,
    "run_superseded": 409,
    "invalid_review": 422,
    "generator_unavailable": 503,
}


def _raise(err: meeting_intelligence.IntelligenceError) -> None:
    status = _ERROR_STATUS.get(err.code, 400)
    raise HTTPException(status_code=status, detail="Not found" if status == 404 else err.code)


def _found(out: dict | None) -> dict:
    if out is None:
        raise HTTPException(status_code=404, detail="Not found")
    return out


@router.get("/recent")
async def list_recent_sessions(email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)) -> dict:
    return {"sessions": await meeting_receipt.recent(db, email)}


@router.get("/{session_id}")
async def get_session(
    session_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> dict:
    return _found(await meeting_receipt.read_session(db, session_id, email))


@router.get("/{session_id}/transcript")
async def get_transcript(
    session_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> dict:
    return _found(await meeting_capture.read_transcript(db, session_id, email))


@router.post("/{session_id}/intelligence/runs", status_code=201)
async def generate_intelligence(
    session_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> dict:
    try:
        return await meeting_intelligence.generate(db, session_id, email)
    except meeting_intelligence.IntelligenceError as err:
        _raise(err)


@router.get("/{session_id}/intelligence/runs")
async def list_intelligence_runs(
    session_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> dict:
    return _found(await meeting_intelligence.list_runs(db, session_id, email))


@router.get("/{session_id}/intelligence/runs/{run_id}")
async def get_intelligence_run(
    session_id: str, run_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> dict:
    return _found(await meeting_intelligence.read_run(db, session_id, run_id, email))


@router.get("/{session_id}/intelligence/latest")
async def get_latest_intelligence(
    session_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> dict:
    return _found(await meeting_intelligence.read_latest(db, session_id, email))


@router.post("/{session_id}/intelligence/items/{item_id}/review")
async def review_intelligence_item(
    session_id: str,
    item_id: str,
    body: ReviewItemIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        return await meeting_intelligence.review(
            db, session_id, item_id, email, action=body.action, content=body.content
        )
    except meeting_intelligence.IntelligenceError as err:
        _raise(err)
