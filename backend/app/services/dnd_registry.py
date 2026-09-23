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


def _normalize_email(email: str) -> str:
    """Casing/whitespace normalization, matching spatial_session.py's `_normalize_email` and for
    exactly the reason its comment gives: `snapshot()` is compared on every client against
    LOWERCASED roster emails (frontend services/presence/status.ts's resolvePeerStatus, and
    data/roomLock.ts's isRoomLocked over the same feed), so a differently-cased email from the
    socket session must not read as a different person.

    THE BUG THIS EXISTS FOR, found by two real browsers and by no test: `dnd_set` stores
    `session_data["email"]` exactly as the auth layer produced it. With any casing difference the
    person's own client showed DND (that is local state) while every other client resolved them to
    their plain Atlas presence — and the DND room lock, which derives from this same membership,
    never engaged at all, so the room stayed open in every movement mode.""" 
    return email.strip().lower()


class DndRegistry:
    def __init__(self) -> None:
        self._dnd_emails: set[str] = set()

    def set_dnd(self, email: str, is_dnd: bool) -> bool:
        """Set whether `email` is currently DND. Returns True iff this call actually changed
        membership (for broadcast-only-on-change callers)."""
        key = _normalize_email(email)
        if is_dnd:
            if key in self._dnd_emails:
                return False
            self._dnd_emails.add(key)
            return True
        if key not in self._dnd_emails:
            return False
        self._dnd_emails.discard(key)
        return True

    def is_dnd(self, email: str) -> bool:
        return _normalize_email(email) in self._dnd_emails

    def clear(self, email: str) -> bool:
        """Removes `email` unconditionally (e.g. on disconnect). Returns True iff it was present."""
        return self.set_dnd(email, False)

    def snapshot(self) -> list[str]:
        return sorted(self._dnd_emails)
