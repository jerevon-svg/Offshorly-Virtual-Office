from __future__ import annotations

from app.models.toucan import ToucanDelegation
from app.realtime.state import sio, user_room

# A2.2 — the one realtime fact about a delegation: it ended. Emitted to the OWNER's per-user room
# only (every socket of that person, nobody else — never a conversation room), with the minimum a
# client needs to drop its banner: which delegation, and why. No conversation, no counterpart, no
# content.

EVENT_DELEGATION_ENDED = "delegation_ended"


async def emit_delegation_ended(delegation: ToucanDelegation) -> None:
    await sio.emit(
        EVENT_DELEGATION_ENDED,
        {"delegationId": delegation.id, "reason": delegation.ended_reason},
        room=user_room(delegation.owner_email),
    )
