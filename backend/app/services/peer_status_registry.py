from __future__ import annotations

# Ephemeral, socket-native relay of each CONNECTED person's own effective office status — the value their
# own client already resolves (frontend services/presence/status.ts resolveCurrentStatus over
# selfStatusStore: manual Available/Busy/Break/Lunch/DND plus the auto Offline/Away/In Conversation/In Call/
# In Meeting conditions). It is not a second status store: the person's own client stays the only source and
# this only carries its latest answer to peers, exactly as dnd_registry.py carries DND. Without it peers saw
# only the presence row (Atlas in real mode, MockOfficeService's fixed seed in mock mode), so two checked-in,
# Available people read each other as Away / Offline.
#
# Lifetime = the socket: set by the person's own `status_set`, removed by their disconnect, re-asserted by
# their client on reconnect. Same single-process, in-memory assumption as dnd_registry.py.

OFFICE_STATUSES = frozenset(
    {"AVAILABLE", "BUSY", "AWAY", "BREAK", "LUNCH", "IN_CONVERSATION", "IN_CALL", "IN_MEETING", "DND", "OFFLINE"}
)


def _normalize_email(email: str) -> str:
    """Same casing/whitespace rule as dnd_registry._normalize_email — peers look statuses up by lowercased
    roster email."""
    return email.strip().lower()


class PeerStatusRegistry:
    def __init__(self) -> None:
        self._status: dict[str, str] = {}

    def set_status(self, email: str, status: str) -> bool:
        """Record `email`'s current status. Returns True iff it changed (broadcast-only-on-change callers).
        An unknown value is refused (False) — never stored, never broadcast."""
        if status not in OFFICE_STATUSES:
            return False
        key = _normalize_email(email)
        if self._status.get(key) == status:
            return False
        self._status[key] = status
        return True

    def status_of(self, email: str) -> str | None:
        return self._status.get(_normalize_email(email))

    def clear(self, email: str) -> bool:
        """Removes `email` (on disconnect). Returns True iff it was present."""
        return self._status.pop(_normalize_email(email), None) is not None

    def snapshot(self) -> dict[str, str]:
        return dict(sorted(self._status.items()))
