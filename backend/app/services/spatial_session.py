from __future__ import annotations

# Ephemeral, socket-native presence tracking of who is spatially clustered with whom right now.
# Adapted from offline_lineup.py's conventions: synchronous mutation methods, no locks, plain-
# dict emits. Distinct from the DB-backed Conversation / ConversationRequest models (Stage 1/2):
# this registry is never persisted and only reflects in-world clustering state for the current
# process's lifetime, driving future Ask-to-Join visibility and "In Conversation" status.
#
# ASSUMPTION (same single-worker-deployment caveat as offline_lineup.py): this state is in-
# memory and per-process. It is correct only when the backend runs as a single worker/process.
# If this service is ever scaled to multiple workers (or multiple machines) behind a load
# balancer, this in-memory dict stops being authoritative across connections handled by
# different processes and would need to move to a shared store (e.g. Redis) with real
# distributed presence semantics. Not built now — out of scope for this stage.


class SpatialSessionRegistry:
    def __init__(self) -> None:
        self._session_by_email: dict[str, str] = {}

    def start(self, email: str, session_id: str) -> None:
        """Place email in session_id. Idempotent. If email was in a different session, it is
        moved (old membership dropped)."""
        self._session_by_email[email] = session_id

    def leave(self, email: str) -> str | None:
        """Remove email from its current session. Returns the session_id it was in (for
        broadcast-only-on-change), or None if it wasn't in any."""
        return self._session_by_email.pop(email, None)

    def session_of(self, email: str) -> str | None:
        return self._session_by_email.get(email)

    def snapshot(self) -> list[dict]:
        """Grouped, stable-ordered: sessions sorted by session_id, members sorted by email
        within each. Empty sessions never appear (a session with zero members simply has no
        entry, since membership is a flat email->session_id reverse index)."""
        grouped: dict[str, list[str]] = {}
        for email, sid in self._session_by_email.items():
            grouped.setdefault(sid, []).append(email)
        return [
            {"sessionId": sid, "members": sorted(members)}
            for sid, members in sorted(grouped.items())
        ]
