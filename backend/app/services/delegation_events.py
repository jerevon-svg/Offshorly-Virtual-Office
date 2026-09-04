from __future__ import annotations

from datetime import timezone

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


# A3 — the second realtime fact about a delegation, owner-only as well: somebody declared a
# message urgent while Toucan was covering. Carries what the owner's own panel needs to show a
# counter now and a return card later — the flag, its delegation, the conversation to open, who
# asked, when, and the refreshed unseen count — and no content.

EVENT_DELEGATION_URGENT_FLAGGED = "delegation_urgent_flagged"


async def emit_delegation_urgent_flagged(flag, *, urgent_count: int) -> None:
    flagged_at = flag.flagged_at
    if flagged_at is not None and flagged_at.tzinfo is None:
        flagged_at = flagged_at.replace(tzinfo=timezone.utc)
    await sio.emit(
        EVENT_DELEGATION_URGENT_FLAGGED,
        {
            "flagId": flag.id,
            "delegationId": flag.delegation_id,
            "conversationId": flag.conversation_id,
            "requesterEmail": flag.requester_email,
            "flaggedAt": flagged_at.isoformat().replace("+00:00", "Z") if flagged_at else None,
            "urgentCount": urgent_count,
        },
        room=user_room(flag.owner_email),
    )
