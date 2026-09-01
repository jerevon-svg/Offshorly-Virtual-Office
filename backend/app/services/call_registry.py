from __future__ import annotations

import secrets

# Ephemeral registry of voice calls layered ON TOP OF the spatial session system (Stage A).
#
# WHAT THIS OWNS (and nothing more):
#   * spatial session id -> stable LiveKit room name
#   * which emails are currently CONNECTED to that room's media, refcounted per socket
#
# WHAT LIVEKIT OWNS (deliberately NOT mirrored here): microphone tracks, mute state, speaking
# state, media transport, and reconnection. Duplicating any of that would create two writers for
# one fact. The only reason this registry tracks participants at all is that a client which has
# NOT joined the room cannot ask LiveKit who is in it — that is what drives "Join call" vs
# "Start call" in the UI, and peers' IN_CALL knowledge.
#
# ROOM NAMING: the raw spatial/conversation id is never used as the room name. A random opaque
# name is minted on first use and stored, so (a) conversation ids never leak into LiveKit's
# namespace, and (b) an Ask-to-Join upgrade — which mints a BRAND-NEW conversation id mid-call
# (see app/routers/requests.py's accept_join_request) — can re-key the mapping to the new
# session id while everyone already connected stays in the SAME room. See rekey_session.
#
# SpatialSessionRegistry is untouched and remains the sole authority for eligibility: this
# registry never decides who MAY call, only where an in-progress call lives.
#
# ASSUMPTION (same single-worker/in-memory caveat as spatial_session.py and
# global_chat_activity.py): per-process state, correct only for a single worker. No persistence,
# no Redis — out of scope for this stage.


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class CallRegistry:
    def __init__(self) -> None:
        # spatial session id -> LiveKit room name
        self._room_by_session: dict[str, str] = {}
        # room name -> email -> set of sids reporting a live media connection
        self._sids_by_email_by_room: dict[str, dict[str, set[str]]] = {}
        # sid -> room name, so a disconnect (which only knows its own sid) is O(1)
        self._room_by_sid: dict[str, str] = {}

    # --- room mapping ------------------------------------------------------------------

    def room_for_session(self, session_id: str) -> str:
        """Stable room name for this spatial session, minted on first call and reused after.
        Opaque and unguessable — never derived from the conversation id."""
        room = self._room_by_session.get(session_id)
        if room is None:
            room = f"vo-call-{secrets.token_urlsafe(12)}"
            self._room_by_session[session_id] = room
        return room

    def existing_room_for_session(self, session_id: str) -> str | None:
        """Read-only lookup — does NOT mint a room. Used where "is there a call here?" must not
        itself create one."""
        return self._room_by_session.get(session_id)

    def rekey_session(self, old_session_id: str, new_session_id: str) -> str | None:
        """Ask-to-Join upgrade: the spatial session id changed but the call did not. Moves the
        mapping so the new id resolves to the SAME room — connected participants are never asked
        to hop rooms, and the joiner's token request for the new id lands in the existing call.
        No-op (returns None) when the old id had no room. If the new id somehow already has a
        room, the existing mapping wins and the old one is simply dropped."""
        if old_session_id == new_session_id:
            return self._room_by_session.get(new_session_id)
        room = self._room_by_session.pop(old_session_id, None)
        if room is None:
            return self._room_by_session.get(new_session_id)
        self._room_by_session.setdefault(new_session_id, room)
        return self._room_by_session[new_session_id]

    # --- media participants ------------------------------------------------------------

    def join(self, session_id: str, email: str, sid: str) -> bool:
        """Record that `sid` reported a LIVE LiveKit connection for this session's room. Returns
        True iff the room's participant set changed (broadcast-only-on-change, matching the
        other registries)."""
        room = self.room_for_session(session_id)
        key = _normalize_email(email)
        by_email = self._sids_by_email_by_room.setdefault(room, {})
        was_present = key in by_email
        by_email.setdefault(key, set()).add(sid)
        self._room_by_sid[sid] = room
        return not was_present

    def leave(self, email: str, sid: str) -> bool:
        """Explicit "I left the media call" from `sid`. Only that sid's claim is dropped, so a
        second tab still in the call keeps the email connected. Returns True iff the email-level
        membership changed."""
        room = self._room_by_sid.pop(sid, None)
        if room is None:
            return False
        return self._drop(room, _normalize_email(email), sid)

    def clear_sid(self, sid: str) -> bool:
        """Socket disconnect cleanup, BY SID — a socket that never joined media is not in here,
        so its disconnect is a no-op. Mirrors spatial_session.py's Stage 0 ownership rule."""
        room = self._room_by_sid.pop(sid, None)
        if room is None:
            return False
        for email, sids in list(self._sids_by_email_by_room.get(room, {}).items()):
            if sid in sids:
                return self._drop(room, email, sid)
        return False

    def _drop(self, room: str, email: str, sid: str) -> bool:
        by_email = self._sids_by_email_by_room.get(room)
        if not by_email:
            return False
        sids = by_email.get(email)
        if not sids or sid not in sids:
            return False
        sids.discard(sid)
        if sids:
            return False
        del by_email[email]
        if not by_email:
            # Last participant left: forget the room entirely so the NEXT call in this spatial
            # session gets a fresh room rather than rejoining a dead one.
            del self._sids_by_email_by_room[room]
            for session_id, mapped in list(self._room_by_session.items()):
                if mapped == room:
                    del self._room_by_session[session_id]
        return True

    def participants(self, session_id: str) -> list[str]:
        room = self._room_by_session.get(session_id)
        if room is None:
            return []
        return sorted(self._sids_by_email_by_room.get(room, {}))

    def has_active_call(self, session_id: str) -> bool:
        return bool(self.participants(session_id))

    def snapshot(self) -> list[dict]:
        """Wire shape for the `spatial_calls` broadcast: only sessions with at least one
        CONNECTED participant appear. Carries no track/mute/speaking state — LiveKit owns
        those. sids are internal and never leave this module."""
        out = []
        for session_id, room in sorted(self._room_by_session.items()):
            members = sorted(self._sids_by_email_by_room.get(room, {}))
            if members:
                out.append({"sessionId": session_id, "room": room, "participants": members})
        return out

    def reset(self) -> None:
        """Test-only: this is a module-level singleton in socket.py."""
        self._room_by_session.clear()
        self._sids_by_email_by_room.clear()
        self._room_by_sid.clear()
