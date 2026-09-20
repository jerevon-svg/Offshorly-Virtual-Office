from __future__ import annotations

# PHASE 7D — WHO HOSTS A STANDALONE MEETING.
#
# The ONE piece of meeting state that is not already somewhere else. Membership, refcounting across a
# person's tabs, disconnect cleanup and arrival order all live in call_registry.py and are reused
# verbatim; this module answers only "and which of them is the host", which nothing else can.
#
# THE INVARIANT, and it is the whole design: a meeting has a host IFF it has participants. Everything
# the feature promises falls out of that one rule —
#   * the first person into an empty room becomes host (ensure_host on an unhosted key);
#   * a later arrival does not displace them (ensure_host is idempotent while the host is present);
#   * a host leaving hands over to the longest-present remaining participant (release, given the
#     registry's arrival order);
#   * the last participant leaving ends the meeting, because clearing the host IS ending it — the
#     Cave's panel goes back to "Start Meeting" the moment host_of() is None.
#
# ATOMICITY, stated precisely because "exactly one host" depends on it. Every method here is a plain
# synchronous dict operation with no `await` inside it. python-socketio runs handlers on one asyncio
# loop, so a handler cannot be interleaved with another between two synchronous statements: a caller
# that does `call_registry.join(...)` immediately followed by `ensure_host(...)` with nothing awaited in
# between executes both against a world nobody else has touched. Two people pressing Start at the same
# instant are two separate handler invocations, and the second necessarily observes the first's host.
# This is the same argument call_invites.py's `resolve` makes for its single-shot pop.
#
# HOST IS PER-EMAIL, NOT PER-SOCKET, matching the registry's own membership unit. Somebody hosting from
# two tabs is one host; closing one tab transfers nothing, because they have not left.
#
# ASSUMPTION (the same single-worker caveat as spatial_session.py / call_registry.py): in-memory and
# per-process. A restart ends every meeting, which is honest — the LiveKit rooms do not survive it in
# any useful sense either.


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class MeetingHostRegistry:
    def __init__(self) -> None:
        # meeting key (call_registry's "meeting:<id>") -> host email
        self._host_by_key: dict[str, str] = {}

    def ensure_host(self, key: str, email: str) -> str:
        """Somebody joined. Returns the host AFTER this join — them if the meeting had none, otherwise
        whoever already had it. Idempotent: calling it again for the same person, or for a second tab,
        changes nothing."""
        current = self._host_by_key.get(key)
        if current is not None:
            return current
        host = _normalize_email(email)
        self._host_by_key[key] = host
        return host

    def release(self, key: str, remaining_in_order: list[str]) -> str | None:
        """Somebody left. `remaining_in_order` is call_registry.participants_in_order(key) AFTER the
        departure — this module never reads the registry itself, so there is no way for the two to
        disagree about who is still here.

        Three cases, in the order they are checked:
          * nobody left  -> the meeting is over; forget the host entirely and return None
          * host still present (they closed one tab, or somebody else left) -> unchanged
          * host gone -> the longest-present remaining participant, which is simply the first entry
        """
        if not remaining_in_order:
            self._host_by_key.pop(key, None)
            return None
        current = self._host_by_key.get(key)
        remaining = [_normalize_email(e) for e in remaining_in_order]
        if current is not None and current in remaining:
            return current
        self._host_by_key[key] = remaining[0]
        return remaining[0]

    def host_of(self, key: str) -> str | None:
        return self._host_by_key.get(key)

    def reset(self) -> None:
        """Test-only: this is a module-level singleton in realtime/state.py, so a host from one test
        would otherwise leak into the next (the same shared-state caveat every registry here carries)."""
        self._host_by_key.clear()
