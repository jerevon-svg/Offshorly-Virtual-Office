from __future__ import annotations

# Server-authoritative allocator for the explicit-checkout "offline lineup" (v1 scope: no
# heartbeat/disconnect-timeout detection — entry is triggered ONLY by the checkout flow's
# CHECKED_OUT transition on the client, via the `go_offline` socket event; see
# app/realtime/socket.py). Lowest-available-index allocation so slots are reused as people
# check back in, keeping the sidewalk lineup dense instead of growing unboundedly.
#
# ASSUMPTION (flagged per the confirmed single-worker-deployment decision): this state is
# in-memory and per-process. It is correct only when the backend runs as a single worker/
# process. If this service is ever scaled to multiple workers (or multiple machines) behind a
# load balancer, this in-memory dict stops being authoritative across connections handled by
# different processes and would need to move to a shared store (e.g. Redis) with real
# distributed-lock/atomic-allocation semantics. Not built now — out of scope for v1.


class OfflineLineup:
    def __init__(self) -> None:
        self._slot_by_email: dict[str, int] = {}

    def add(self, email: str) -> int:
        """Assigns the lowest available slot index to `email`. No-op (returns the existing
        slot) if `email` is already present."""
        if email in self._slot_by_email:
            return self._slot_by_email[email]

        used = set(self._slot_by_email.values())
        slot = 0
        while slot in used:
            slot += 1

        self._slot_by_email[email] = slot
        return slot

    def remove(self, email: str) -> None:
        """Frees `email`'s slot, if any. No-op if `email` is not present."""
        self._slot_by_email.pop(email, None)

    def snapshot(self) -> list[dict]:
        """Stable-ordered (by slot index) snapshot of the current lineup."""
        return [
            {"email": email, "slot": slot}
            for email, slot in sorted(self._slot_by_email.items(), key=lambda item: item[1])
        ]
