from __future__ import annotations

# Ephemeral, socket-native registry of who currently has DND (Do Not Disturb) status active.
# Adapted from spatial_session.py's conventions (synchronous mutation, no locks, plain-dict/set
# emits) — DND itself was previously 100% client-side/localStorage-only (see
# frontend/src/services/presence/selfStatusStore.ts) with no realtime channel carrying it to
# other clients. This registry is the minimal addition needed so peers can learn "this person is
# DND" live, which the DND-room-lock feature requires to compute room-lock state server-side.
#
# ASSUMPTION (same single-worker-deployment caveat as spatial_session.py/offline_lineup.py): this
# state is in-memory and per-process. Not built now — out of scope for this stage.


class DndRegistry:
    def __init__(self) -> None:
        self._dnd_emails: set[str] = set()

    def set_dnd(self, email: str, is_dnd: bool) -> bool:
        """Set whether `email` is currently DND. Returns True iff this call actually changed
        membership (for broadcast-only-on-change callers)."""
        if is_dnd:
            if email in self._dnd_emails:
                return False
            self._dnd_emails.add(email)
            return True
        if email not in self._dnd_emails:
            return False
        self._dnd_emails.discard(email)
        return True

    def is_dnd(self, email: str) -> bool:
        return email in self._dnd_emails

    def clear(self, email: str) -> bool:
        """Removes `email` unconditionally (e.g. on disconnect). Returns True iff it was present."""
        return self.set_dnd(email, False)

    def snapshot(self) -> list[str]:
        return sorted(self._dnd_emails)
