from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from livekit.api import AccessToken, VideoGrants

from app.auth.deps import get_current_email
from app.config import settings
from app.realtime.socket import call_registry, spatial_sessions
from app.schemas.calls import CallTokenIn, CallTokenOut

# Stage A voice calls: the ONE backend endpoint the frontend needs. Mirrors
# routers/talk_requests.py's conventions — bare path (no /api prefix, matching every other
# router in this app), `Depends(get_current_email)` for identity, plain dict/pydantic response.
#
# Everything about eligibility comes from the EXISTING SpatialSessionRegistry: this endpoint adds
# no parallel notion of who may talk to whom. If you are not currently in the spatial session you
# named, you get a 403 and no token.

_logger = logging.getLogger(__name__)

router = APIRouter(tags=["calls"])

# Short by design: the token is only needed for the initial LiveKit connect handshake. LiveKit
# keeps the session alive after that, so a leaked/stale token has a tiny window and cannot be
# replayed into a call hours later.
_TOKEN_TTL = timedelta(minutes=10)


def _livekit_config() -> tuple[str, str, str]:
    """Fail closed with a clear operational error when LiveKit isn't configured, rather than
    minting a token signed with an empty secret (which LiveKit would reject with an opaque
    client-side failure). Never includes the key/secret in the message."""
    url = settings.LIVEKIT_URL.strip()
    key = settings.LIVEKIT_API_KEY.strip()
    secret = settings.LIVEKIT_API_SECRET.strip()
    if not (url and key and secret):
        _logger.error("LiveKit is not configured (LIVEKIT_URL/API_KEY/API_SECRET missing)")
        raise HTTPException(status_code=503, detail="Voice calling is not configured")
    return url, key, secret


@router.post("/calls/token", response_model=CallTokenOut)
async def create_call_token(
    body: CallTokenIn,
    email: str = Depends(get_current_email),
) -> CallTokenOut:
    """Mint a short-lived LiveKit participant token for the caller's CURRENT spatial session.

    The client sends only a sessionId. Identity is taken from the verified bearer token, never
    from the request body — otherwise anyone could join any room as anyone else.
    """
    url, key, secret = _livekit_config()

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

    # Voice-only grants, least privilege for Stage A:
    #   room_join + this ONE room  -> cannot join or enumerate any other room
    #   can_publish/can_subscribe  -> mic in, everyone else's audio out
    #   can_publish_data False     -> no data channel (nothing in Stage A uses it)
    #   room_create/room_admin/room_list/room_record all default False
    grants = VideoGrants(
        room_join=True,
        room=room,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=False,
        can_update_own_metadata=False,
    )

    token = (
        AccessToken(key, secret)
        .with_identity(email)
        .with_name(email)
        .with_grants(grants)
        .with_ttl(_TOKEN_TTL)
        .to_jwt()
    )

    return CallTokenOut(url=url, token=token, room=room, identity=email)
