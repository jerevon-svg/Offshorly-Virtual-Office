from __future__ import annotations

# Ephemeral, socket-native registry of who currently has an ACTIVE Global Chat window (at
# least one visible, non-minimized remote DM/group window — see OfficeMap.tsx's
# remoteChatWindows). Drives ONE thing for peers: the seated `sitting-answering` animation
# (characterAnimationState.ts). It deliberately carries no conversation ids, participants, or
# contents — only the boolean "this email is actively in Global Chat" fact.
#
# Unlike dnd_registry.py (one boolean per email), this is refcounted PER SOCKET (sid): a user
# with two tabs/sockets stays active while ANY socket still reports an active window, and only
# flips to inactive when the last active socket reports inactive or disconnects. Distinct from
# spatial_session.py on purpose — remote chats must never look spatial (no auto-walk, no
# "In Conversation" status, no Ask-to-Join surface).
#
# ASSUMPTION (same single-worker-deployment caveat as spatial_session.py/dnd_registry.py): this
# state is in-memory and per-process; a backend restart simply resets it to "nobody active",
# which is safe because clients re-emit their current state on reconnect.


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class GlobalChatActivityRegistry:
    def __init__(self) -> None:
        # email -> set of sids currently reporting an active Global Chat window.
        self._sids_by_email: dict[str, set[str]] = {}

    def set_active(self, email: str, sid: str, is_active: bool) -> bool:
        """Record that socket `sid` of `email` does/doesn't have an active Global Chat window.
        Returns True iff the EMAIL-level boolean (is_active(email)) changed as a result — the
        broadcast-only-on-change contract shared with the other registries."""
        key = _normalize_email(email)
        was_active = key in self._sids_by_email
        if is_active:
            self._sids_by_email.setdefault(key, set()).add(sid)
            return not was_active
        sids = self._sids_by_email.get(key)
        if not sids:
            return False
        sids.discard(sid)
        if sids:
            return False
        del self._sids_by_email[key]
        return True

    def clear_sid(self, email: str, sid: str) -> bool:
        """Socket `sid` went away (disconnect). Returns True iff that flipped `email` inactive
        — i.e. it was the last active socket. Other live sockets of the same email keep the
        email active."""
        return self.set_active(email, sid, False)

    def is_active(self, email: str) -> bool:
        return _normalize_email(email) in self._sids_by_email

    def snapshot(self) -> list[str]:
        """Sorted emails with at least one active socket — the full authoritative state sent to
        late joiners / reconnecting clients on connect."""
        return sorted(self._sids_by_email)
