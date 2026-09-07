from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import get_current_email
from app.realtime.state import call_registry, spatial_sessions
from app.schemas.calls import CallTokenIn, CallTokenOut
from app.services.livekit_tokens import livekit_config, mint_voice_token

# Stage A voice calls: the ONE backend endpoint the frontend needs. Mirrors
# routers/talk_requests.py's conventions — bare path (no /api prefix, matching every other
# router in this app), `Depends(get_current_email)` for identity, plain dict/pydantic response.
#
# Everything about eligibility comes from the EXISTING SpatialSessionRegistry: this endpoint adds
# no parallel notion of who may talk to whom. If you are not currently in the spatial session you
# named, you get a 403 and no token.

router = APIRouter(tags=["calls"])


@router.post("/calls/token", response_model=CallTokenOut)
async def create_call_token(
    body: CallTokenIn,
    email: str = Depends(get_current_email),
) -> CallTokenOut:
    """Mint a short-lived LiveKit participant token for the caller's CURRENT spatial session.

    The client sends only a sessionId. Identity is taken from the verified bearer token, never
    from the request body — otherwise anyone could join any room as anyone else.
    """
    livekit_config()  # fail closed before any eligibility work when LiveKit is not configured
    session_id = body.session_id.strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId is required")

    # Eligibility, straight off the spatial session — no second membership system.
    if spatial_sessions.session_of(email) != session_id:
        raise HTTPException(status_code=403, detail="Not a member of this spatial session")

    # A "spatial conversation" only exists at >=2 members (same rule the frontend's inConv
    # derivation uses), so a lone occupant can't open a call room and sit in it.
    members = [
        m for entry in spatial_sessions.snapshot() if entry["sessionId"] == session_id
        for m in entry["members"]
    ]
    if len(members) < 2:
        raise HTTPException(status_code=409, detail="Spatial conversation needs at least 2 people")

    # Create-or-reuse: the first caller mints the room, everyone after joins the same one.
    room = call_registry.room_for_session(session_id)
    # Grants/TTL live in services/livekit_tokens.py (shared with board voice, W5-B).
    return CallTokenOut(**mint_voice_token(email, room))
