from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import HTTPException
from livekit.api import AccessToken, VideoGrants

from app.config import settings

# The ONE place a LiveKit participant token is minted. Extracted from routers/calls.py so the
# board-voice endpoint (routers/whiteboards.py, W5-B) shares the config check, the grants and the
# TTL instead of duplicating them. Eligibility is NOT decided here — each router applies its own
# rule (spatial-session membership, whiteboard can_access) before calling mint_voice_token.

_logger = logging.getLogger(__name__)

# Short by design: the token is only needed for the initial LiveKit connect handshake. LiveKit
# keeps the session alive after that, so a leaked/stale token has a tiny window and cannot be
# replayed into a call hours later.
TOKEN_TTL = timedelta(minutes=10)


def livekit_config() -> tuple[str, str, str]:
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


def mint_voice_token(email: str, room: str) -> dict[str, str]:
    """Voice-only participant token for `email` in exactly `room`. Least privilege:
      room_join + this ONE room  -> cannot join or enumerate any other room
      can_publish/can_subscribe  -> mic in, everyone else's audio out
      can_publish_data False     -> no data channel (nothing uses it; cursor chat is Socket.IO)
      room_create/room_admin/room_list/room_record all default False
    Identity is the verified caller email — never anything from a request body."""
    url, key, secret = livekit_config()
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
        .with_ttl(TOKEN_TTL)
        .to_jwt()
    )
    return {"url": url, "token": token, "room": room, "identity": email}
