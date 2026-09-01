from __future__ import annotations

import secrets
from datetime import datetime, timezone

# Ephemeral, person-to-person call ringing state ("A is calling B"), the invitation half of Stage
# A voice calls. Deliberately NOT the persisted talk_requests table: that table's
# get_cooldown_until derives a 15-minute DND cooldown from any DECLINED row for a
# (target, requester) pair WITHOUT filtering on `kind`, so a declined CALL would silently throttle
# legitimate Chat requests. It also requires the target to be DND, carries a unique-pending index
# per pair, and is bulk-cancelled whenever a target's DND turns off — all wrong for a ~45s ring.
# See also: a ring is transient by nature and has no business creating durable rows.
#
# WHAT AN INVITE CARRIES: inviteId, caller, recipient, the caller's owning sid, created_at. That
# is all. Deliberately NO sessionId and NO LiveKit room:
#   * Eligibility remains the SpatialSessionRegistry's job. The session doesn't exist yet while
#     ringing — it is created by Accept through the existing approach/chat panel flow.
#   * Keeping sessionId out also makes a ring immune to Ask-to-Join re-keying the conversation id
#     mid-flight (see call_registry.rekey_session).
#   * LiveKit stays media-only; no ringing state ever reaches it.
#
# RESOLUTION IS SINGLE-SHOT: the first accept/decline/cancel/expiry pops the invite; every later
# attempt is a harmless no-op returning None. Authority is checked BEFORE the pop, so a
# non-participant can never resolve someone else's invite.
#
# ASSUMPTION (same single-worker/in-memory caveat as spatial_session.py, call_registry.py and
# global_chat_activity.py): per-process state, correct for a single worker. A restart simply drops
# pending rings, which is safe — clients show no stale ringing UI because the terminal state is
# also what a reconnect snapshot reports (absence).

# How long a ring may stay unanswered before the server terminates it. Ringing forever would
# leave the caller stuck on "Calling…" if the recipient closes their laptop.
INVITE_TTL_SECONDS = 45


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class CallInviteRegistry:
    def __init__(self) -> None:
        # inviteId -> invite dict
        self._invites: dict[str, dict] = {}

    # --- creation ----------------------------------------------------------------------

    def pending_between(self, a: str, b: str) -> dict | None:
        """Any pending invite in EITHER direction between these two people. Covers both a
        duplicate re-invite and 'glare' (both sides calling each other at once) with one check —
        the second invite is refused rather than creating two competing rings."""
        x, y = _normalize_email(a), _normalize_email(b)
        for inv in self._invites.values():
            pair = {inv["from_email"], inv["to_email"]}
            if pair == {x, y}:
                return inv
        return None

    def pending_for(self, email: str) -> list[dict]:
        """Every pending invite this person is a party to, either direction. Used for the
        connect-time snapshot so a reload restores in-flight ringing UI."""
        key = _normalize_email(email)
        return [
            inv
            for inv in self._invites.values()
            if key in (inv["from_email"], inv["to_email"])
        ]

    def create(self, *, from_email: str, from_sid: str, to_email: str) -> dict:
        """Mint a pending invite. Callers MUST have already run the preconditions (recipient
        online / not DND / not busy, no pending_between) — this registry holds state, it does not
        police policy."""
        invite_id = secrets.token_urlsafe(12)
        invite = {
            "inviteId": invite_id,
            "from_email": _normalize_email(from_email),
            "to_email": _normalize_email(to_email),
            "from_sid": from_sid,
            "created_at": datetime.now(timezone.utc),
        }
        self._invites[invite_id] = invite
        return invite

    def get(self, invite_id: str) -> dict | None:
        return self._invites.get(invite_id)

    # --- single-shot resolution --------------------------------------------------------

    def resolve(self, invite_id: str, *, actor_email: str | None = None, role: str | None = None) -> dict | None:
        """Pop the invite, atomically (single-threaded asyncio — a dict pop cannot interleave).
        Returns the invite on the FIRST resolution and None for every later one, which is what
        makes a late/double Accept, or an Accept racing a Cancel, a harmless no-op.

        `role` gates authority, checked before the pop so a failed authority check leaves the
        invite intact:
          "recipient" -> only to_email may resolve (accept / decline)
          "caller"    -> only from_email may resolve (cancel)
          None        -> server-initiated (TTL expiry, disconnect cleanup)
        """
        invite = self._invites.get(invite_id)
        if invite is None:
            return None
        if role is not None:
            expected = invite["to_email"] if role == "recipient" else invite["from_email"]
            if actor_email is None or _normalize_email(actor_email) != expected:
                return None
        return self._invites.pop(invite_id, None)

    def clear_sid(self, sid: str) -> list[dict]:
        """The CALLER's socket went away (disconnect/refresh): their ring can no longer be
        answered meaningfully, so terminate it and let both sides clear their UI. Sid-aware, per
        the Stage 0 ownership rule — a socket that owns no invite yields an empty list, so this is
        a no-op for the ~11 other sockets a user has open.

        Deliberately NOT applied to the recipient side: a recipient refresh should keep the ring
        alive and have it restored by the connect snapshot. The TTL is the backstop for a
        recipient who never returns."""
        owned = [inv for inv in self._invites.values() if inv["from_sid"] == sid]
        for inv in owned:
            self._invites.pop(inv["inviteId"], None)
        return owned

    def expired(self, *, now: datetime | None = None, ttl_seconds: int = INVITE_TTL_SECONDS) -> list[dict]:
        """Pop and return every invite past its TTL. Exposed as a pure sweep so it is testable
        without waiting in real time; socket.py drives it from a per-invite timer."""
        moment = now or datetime.now(timezone.utc)
        stale = [
            inv
            for inv in self._invites.values()
            if (moment - inv["created_at"]).total_seconds() >= ttl_seconds
        ]
        for inv in stale:
            self._invites.pop(inv["inviteId"], None)
        return stale

    def snapshot(self) -> list[dict]:
        """Debug/introspection only — the wire never carries the whole table (an invite is
        private to its two parties; see pending_for for what a client receives)."""
        return [wire(inv) for inv in sorted(self._invites.values(), key=lambda i: i["created_at"])]

    def reset(self) -> None:
        """Test-only: this is a module-level singleton in socket.py."""
        self._invites.clear()


def wire(invite: dict) -> dict:
    """Client-facing shape. from_sid and created_at stay server-side."""
    return {
        "inviteId": invite["inviteId"],
        "fromEmail": invite["from_email"],
        "toEmail": invite["to_email"],
    }
