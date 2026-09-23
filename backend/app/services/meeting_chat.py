from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Any

# PHASE 7D — WHAT IS SAID INSIDE A MEETING.
#
# EPHEMERAL BY DESIGN, and that is the whole architectural decision. A meeting is a room you are in
# for an hour, not a relationship: what is said in it belongs to that meeting and ends with it. So
# this is an in-memory registry keyed by the same `meeting:<id>` the call registry uses, and it
# writes NOTHING — no conversation, no message row, no unread, no activity event, no quest credit.
#
# WHY NOT REUSE THE DM SYSTEM. `messages` is durable, addressed to a conversation, and feeds unread
# badges, the inbox, Toucan's counts and quest progress. Every one of those is wrong for a meeting
# aside: a dozen "can you see my screen?" lines must not become an inbox anybody has to clear, and a
# meeting has no conversation to address them to. The nearest right precedent is the whiteboard's
# cursor chat (socket.py's whiteboard_cursor_chat) — relayed, bounded, forgotten — and this is that
# same shape with a small history so a late joiner is not dropped into silence.
#
# BOUNDED ON PURPOSE. A meeting keeps its last HISTORY_LIMIT messages and no more, so a long All Hands
# costs a fixed amount of memory rather than a growing one. The overflow is simply dropped: this is a
# catch-up buffer for somebody who walked in late, not a transcript, and it must never be mistaken for
# one — nothing reads it back after the meeting ends, because the meeting ending deletes it.
#
# ASSUMPTION (the same single-worker caveat as call_registry.py and spatial_session.py): in-memory and
# per-process. A restart clears every meeting's chat, which is honest — the meetings do not survive it
# in any useful sense either.


#: how many messages a meeting keeps for somebody who joins late
HISTORY_LIMIT = 50
#: one message's ceiling — the panel is a HUD strip, not a document
MAX_CHARS = 400
#: the shortest gap between two messages from one socket, seconds
MIN_INTERVAL_S = 0.35
#: reactions are cheaper and burstier than words, but still not free
REACTION_MIN_INTERVAL_S = 0.5


def _normalize_email(email: str) -> str:
    return email.strip().lower()


@dataclass
class MeetingMessage:
    """One thing somebody said in a meeting. `id` exists so a client can dedupe its own echo and so a
    late joiner's history merges with what it has already received, not so anything can refer to it
    later — nothing does, because nothing outlives the meeting."""

    id: str
    email: str
    text: str
    at_ms: int

    def wire(self) -> dict[str, Any]:
        return {"id": self.id, "email": self.email, "text": self.text, "atMs": self.at_ms}


@dataclass
class MeetingSession:
    messages: list[MeetingMessage] = field(default_factory=list)


class MeetingChatRegistry:
    def __init__(self) -> None:
        # meeting key ("meeting:<id>") -> that meeting's session
        self._by_key: dict[str, MeetingSession] = {}
        # sid -> last send time, for the per-socket burst guards
        self._last_message_at: dict[str, float] = {}
        self._last_reaction_at: dict[str, float] = {}

    def post(self, key: str, *, email: str, text: str, now_ms: int) -> MeetingMessage | None:
        """Record and return one message, or None when there is nothing to say. Truncation happens
        here rather than at the caller so every path into this registry obeys the same ceiling."""
        clean = text.strip()[:MAX_CHARS]
        if not clean:
            return None
        message = MeetingMessage(
            id=secrets.token_urlsafe(9), email=_normalize_email(email), text=clean, at_ms=now_ms
        )
        session = self._by_key.setdefault(key, MeetingSession())
        session.messages.append(message)
        # Bounded: the oldest simply goes. A catch-up buffer, never a transcript.
        if len(session.messages) > HISTORY_LIMIT:
            del session.messages[: len(session.messages) - HISTORY_LIMIT]
        return message

    def history(self, key: str) -> list[dict[str, Any]]:
        session = self._by_key.get(key)
        return [m.wire() for m in session.messages] if session else []

    def may_send(self, sid: str, *, now: float) -> bool:
        """Per-SOCKET burst guard, mirroring the whiteboard cursor chat's. Deliberately not per-email:
        the cost being protected is this connection's share of the relay."""
        last = self._last_message_at.get(sid)
        if last is not None and now - last < MIN_INTERVAL_S:
            return False
        self._last_message_at[sid] = now
        return True

    def may_react(self, sid: str, *, now: float) -> bool:
        last = self._last_reaction_at.get(sid)
        if last is not None and now - last < REACTION_MIN_INTERVAL_S:
            return False
        self._last_reaction_at[sid] = now
        return True

    def clear_sid(self, sid: str) -> None:
        """A socket went away: drop its rate-limit bookkeeping. Its messages stay — they were said."""
        self._last_message_at.pop(sid, None)
        self._last_reaction_at.pop(sid, None)

    def end(self, key: str) -> bool:
        """THE MEETING IS OVER. Called when the last participant leaves, from the same place the host
        is released — so "the meeting ended" is one event with one consequence, and a new meeting under
        the same id starts genuinely empty rather than inheriting the last one's conversation.
        Returns True when there was something to clear."""
        return self._by_key.pop(key, None) is not None

    def reset(self) -> None:
        """Test-only: this is a module-level singleton in realtime/state.py."""
        self._by_key.clear()
        self._last_message_at.clear()
        self._last_reaction_at.clear()


def now_ms() -> int:
    return int(time.time() * 1000)
