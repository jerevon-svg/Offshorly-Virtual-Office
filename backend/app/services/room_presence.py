from __future__ import annotations

# Ephemeral, socket-native registry of which office room (flat rects/teamRooms-namespace id,
# e.g. "design-team" — see frontend/src/data/office-layout.ts's `rooms` and
# doorStandPoints.ts's doorStandForRoom) each connected user is currently standing inside.
# Adapted from spatial_session.py's conventions exactly (synchronous mutation, no locks, plain-
# dict emits, flat email->value reverse index). Distinct from SpatialSessionRegistry (chat-
# clustering sessions) and from DndRegistry (who is DND) — this is a third, separate ephemeral
# axis. Combining `occupants(room_id)` here with DndRegistry.is_dnd(email) is how the server
# derives "is room X currently locked" for the DND-room-lock feature.
#
# ASSUMPTION (same single-worker-deployment caveat as spatial_session.py/offline_lineup.py): this
# state is in-memory and per-process. Not built now — out of scope for this stage.


class RoomPresenceRegistry:
    def __init__(self) -> None:
        self._room_by_email: dict[str, str] = {}

    def enter(self, email: str, room_id: str) -> None:
        """Place email inside room_id. Idempotent. If email was in a different room, it is moved
        (old membership dropped) — mirrors SpatialSessionRegistry.start."""
        self._room_by_email[email] = room_id

    def leave(self, email: str) -> str | None:
        """Remove email from whatever room it's in. Returns the room_id it was in (for
        broadcast-only-on-change), or None if it wasn't in any."""
        return self._room_by_email.pop(email, None)

    def room_of(self, email: str) -> str | None:
        return self._room_by_email.get(email)

    def occupants(self, room_id: str) -> list[str]:
        return sorted(email for email, r in self._room_by_email.items() if r == room_id)

    def snapshot(self) -> list[dict]:
        """Grouped, stable-ordered: rooms sorted by room_id, members sorted by email within each.
        Empty rooms never appear. Mirrors SpatialSessionRegistry.snapshot."""
        grouped: dict[str, list[str]] = {}
        for email, room_id in self._room_by_email.items():
            grouped.setdefault(room_id, []).append(email)
        return [
            {"roomId": room_id, "members": sorted(members)}
            for room_id, members in sorted(grouped.items())
        ]
