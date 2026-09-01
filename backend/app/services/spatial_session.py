from __future__ import annotations

# Ephemeral, socket-native presence tracking of who is spatially clustered with whom right now.
# Adapted from offline_lineup.py's conventions: synchronous mutation methods, no locks, plain-
# dict emits. Distinct from the DB-backed Conversation / ConversationRequest models (Stage 1/2):
# this registry is never persisted and only reflects in-world clustering state for the current
# process's lifetime, driving future Ask-to-Join visibility and "In Conversation" status.
#
# SID-AWARE OWNERSHIP (Stage 0 connection-stability fix). Membership used to be keyed purely by
# email, and socket.py's disconnect handler removed it by email — but the frontend opens ~10
# INDEPENDENT Socket.IO connections per user (RealChatService, movementSync, dndClient,
# offlineLineupClient, ...), all authenticating as the same email. Any one of them dropping
# therefore ejected the user from their spatial conversation and broadcast the removal to
# everyone.
#
# Ownership is now precise: only the socket that actually emitted `spatial_session_start` owns
# the membership. That is exclusively spatialSessionStore.ts's own connection — no other client
# module emits spatial-session events, so the other ~9 sockets are not in this registry at all
# and their disconnects are no-ops here (see clear_sid). Multiple owning sids per email are
# supported (multi-tab): membership ends only when the LAST owning sid goes away, mirroring
# global_chat_activity.py's per-sid refcount rather than dnd_registry.py's per-email boolean.
#
# ASSUMPTION (same single-worker-deployment caveat as offline_lineup.py): this state is in-
# memory and per-process. It is correct only when the backend runs as a single worker/process.
# If this service is ever scaled to multiple workers (or multiple machines) behind a load
# balancer, this in-memory dict stops being authoritative across connections handled by
# different processes and would need to move to a shared store (e.g. Redis) with real
# distributed presence semantics. Not built now — out of scope for this stage.


def _normalize_email(email: str) -> str:
    """Casing/whitespace normalization, matching global_chat_activity.py and dnd_registry.py.
    snapshot() members are compared against the frontend's lowercased selfChatId, so a
    differently-cased email from Atlas must not read as a separate member."""
    return email.strip().lower()


class SpatialSessionRegistry:
    def __init__(self) -> None:
        # email -> {"session_id": str, "sids": set[str]} — the sids that emitted
        # spatial_session_start for that session and still hold it open.
        self._by_email: dict[str, dict] = {}
        # Reverse index so a disconnect (which only knows its own sid) is O(1) and can never
        # touch another socket's membership.
        self._email_by_sid: dict[str, str] = {}

    def start(self, email: str, session_id: str, sid: str) -> None:
        """Place email in session_id, owned by sid. Idempotent for the same (email, session,
        sid). A second sid of the same email joining the SAME session is added as a co-owner
        (multi-tab). If email was in a DIFFERENT session, it is moved: the new session replaces
        the old one and sid becomes its sole owner, since the old sids were holding open a
        session this email is no longer in (this is the Ask-to-Join upgrade path, where the same
        sid re-starts under the new conversation id)."""
        key = _normalize_email(email)
        entry = self._by_email.get(key)
        if entry is not None and entry["session_id"] == session_id:
            entry["sids"].add(sid)
        else:
            if entry is not None:
                for stale_sid in entry["sids"]:
                    self._email_by_sid.pop(stale_sid, None)
            self._by_email[key] = {"session_id": session_id, "sids": {sid}}
        self._email_by_sid[sid] = key

    def leave(self, email: str) -> str | None:
        """EXPLICIT leave (panel closed / walked away): removes the email's membership outright,
        dropping every owning sid. Deliberately not per-sid — the user said they're out, and
        preserving the pre-fix single-call contract keeps the spatial UX unchanged. Returns the
        session_id it was in (for broadcast-only-on-change), or None if it wasn't in any."""
        entry = self._by_email.pop(_normalize_email(email), None)
        if entry is None:
            return None
        for sid in entry["sids"]:
            self._email_by_sid.pop(sid, None)
        return entry["session_id"]

    def clear_sid(self, sid: str) -> str | None:
        """One socket went away (disconnect). Returns the session_id ONLY if this was the last
        owning sid — i.e. membership actually ended and a broadcast is warranted. A sid that
        never emitted spatial_session_start (every other socket this user has open) is not in
        the registry, so this is a no-op returning None: that is the whole point of the fix."""
        key = self._email_by_sid.pop(sid, None)
        if key is None:
            return None
        entry = self._by_email.get(key)
        if entry is None:
            return None
        entry["sids"].discard(sid)
        if entry["sids"]:
            return None
        del self._by_email[key]
        return entry["session_id"]

    def session_of(self, email: str) -> str | None:
        entry = self._by_email.get(_normalize_email(email))
        return entry["session_id"] if entry else None

    def snapshot(self) -> list[dict]:
        """Grouped, stable-ordered: sessions sorted by session_id, members sorted by email
        within each. Empty sessions never appear (an email with no owning sids is removed
        outright, so a session with zero members simply has no entry). Unchanged wire contract —
        sids are internal bookkeeping and never leave this module."""
        grouped: dict[str, list[str]] = {}
        for email, entry in self._by_email.items():
            grouped.setdefault(entry["session_id"], []).append(email)
        return [
            {"sessionId": sid, "members": sorted(members)}
            for sid, members in sorted(grouped.items())
        ]

    def reset(self) -> None:
        """Test-only: this registry is a module-level singleton in socket.py, so membership from
        one test would otherwise leak into the next (same shared-state caveat as
        offline_lineup's tests)."""
        self._by_email.clear()
        self._email_by_sid.clear()
