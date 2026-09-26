from __future__ import annotations

import math
import secrets
import time

# GO TOGETHER V1 — a temporary travel party: one leader, the coworkers who accepted, and where they are
# going. Nothing else. Ephemeral and in-memory by design, same single-worker caveat as
# call_invites.py / spatial_session.py: a restart drops every party, which is safe — a party is optional
# immersion and nobody depends on it to reach anything.
#
# WHAT THE SERVER OWNS: membership (who is in, in what order — the order IS the formation slot), who
# leads, the destination (opaque: validated for shape, never interpreted), the leader's current floor,
# and which socket in each person's browser is the one driving their body.
#
# WHAT THE SERVER DOES NOT OWN: movement. Every step anyone takes is the ordinary walk_started /
# walk_arrived pipeline; the elevator is each browser's own local ride. The only journey facts that pass
# through here are two semantic moments — "the leader is gathering at the lift" and "the party is
# departing to floor X, these members are with them" — never positions, never animation state.
#
# INVITATIONS are a THIRD instance of CallInviteRegistry (state.party_invites), carrying `party_id`,
# so they inherit its single-shot resolve, glare check and reconnect snapshot without a copy of it.

MAX_PARTY_MEMBERS = 8
PARTY_INVITE_TTL_SECONDS = 60
# A backstop, not a gameplay rule: the party normally ends on arrival or End/Leave long before this.
PARTY_MAX_LIFETIME_SECONDS = 15 * 60
# How long a person's driving tab may be gone (a refresh, a blip) before they are treated as left.
RECONNECT_GRACE_SECONDS = 15

_FLOOR_MAX = 32
_ID_MAX = 64
_LABEL_MAX = 80


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _short_str(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    s = value.strip()
    return s if 0 < len(s) <= limit else None


def sanitize_destination(raw: object) -> dict | None:
    """THE GENERIC DESTINATION: a floor, optionally a room and/or a point, a label, and an optional
    opaque context (e.g. {kind: "scheduled_meeting", id}). Shape only — the leader's client is what
    resolves it into a walk, so a new kind of destination later needs no server change."""
    if not isinstance(raw, dict):
        return None
    floor = _short_str(raw.get("floor"), _FLOOR_MAX)
    label = _short_str(raw.get("label"), _LABEL_MAX)
    if floor is None or label is None:
        return None
    out: dict = {"floor": floor, "label": label}
    room_id = _short_str(raw.get("roomId"), _ID_MAX)
    if room_id is not None:
        out["roomId"] = room_id
    point = raw.get("point")
    if isinstance(point, dict):
        x, z = point.get("x"), point.get("z")
        if isinstance(x, (int, float)) and isinstance(z, (int, float)) and math.isfinite(x) and math.isfinite(z):
            out["point"] = {"x": float(x), "z": float(z)}
    ctx = raw.get("context")
    if isinstance(ctx, dict):
        kind = _short_str(ctx.get("kind"), _ID_MAX)
        cid = _short_str(ctx.get("id"), _ID_MAX)
        if kind is not None and cid is not None:
            out["context"] = {"kind": kind, "id": cid}
    return out


class TravelPartyRegistry:
    def __init__(self) -> None:
        self._parties: dict[str, dict] = {}
        # email -> partyId, for leader AND members: a person is in at most one party
        self._by_email: dict[str, str] = {}

    # --- lookup -------------------------------------------------------------------------

    def get(self, party_id: str) -> dict | None:
        return self._parties.get(party_id)

    def party_of(self, email: str) -> dict | None:
        pid = self._by_email.get(_normalize_email(email))
        return self._parties.get(pid) if pid else None

    def people(self, party: dict) -> list[str]:
        """Leader first, then members in join order."""
        return [party["leader_email"], *party["members"].keys()]

    # --- lifecycle ----------------------------------------------------------------------

    def create(self, *, leader_email: str, leader_sid: str, destination: dict, leader_floor: str, now: float | None = None) -> dict:
        leader = _normalize_email(leader_email)
        party = {
            "partyId": secrets.token_urlsafe(9),
            "leader_email": leader,
            "leader_sid": leader_sid,
            "leader_lost_at": None,
            # email -> {"sid", "following", "lost_at"}; dict order is join order
            "members": {},
            "destination": destination,
            "leader_floor": leader_floor,
            "phase": "travelling",
            "gather_floor": None,
            "departures": 0,
            "created_at": now if now is not None else time.time(),
        }
        self._parties[party["partyId"]] = party
        self._by_email[leader] = party["partyId"]
        return party

    def add_member(self, party_id: str, email: str, sid: str) -> bool:
        party = self._parties.get(party_id)
        key = _normalize_email(email)
        if party is None or key in self._by_email or len(party["members"]) >= MAX_PARTY_MEMBERS:
            return False
        party["members"][key] = {"sid": sid, "following": True, "lost_at": None}
        self._by_email[key] = party_id
        return True

    def remove_member(self, party_id: str, email: str) -> bool:
        party = self._parties.get(party_id)
        key = _normalize_email(email)
        if party is None or key not in party["members"]:
            return False
        party["members"].pop(key)
        self._by_email.pop(key, None)
        return True

    def end(self, party_id: str) -> dict | None:
        """Pop the party. Single-shot: a second end (leader End racing arrival, a timer) is a no-op."""
        party = self._parties.pop(party_id, None)
        if party is None:
            return None
        for email in self.people(party):
            if self._by_email.get(email) == party_id:
                self._by_email.pop(email, None)
        return party

    # --- journey facts ------------------------------------------------------------------

    def set_following(self, party_id: str, email: str, following: bool) -> bool:
        party = self._parties.get(party_id)
        m = party["members"].get(_normalize_email(email)) if party else None
        if m is None or m["following"] == following:
            return False
        m["following"] = following
        return True

    def gather(self, party_id: str, floor: str | None) -> bool:
        """The leader is holding at the lift on `floor` — or, with None, stopped holding (they took
        control) without departing."""
        party = self._parties.get(party_id)
        if party is None:
            return False
        party["phase"] = "gathering" if floor is not None else "travelling"
        party["gather_floor"] = floor
        return True

    def depart(self, party_id: str, *, from_floor: str, to_floor: str, members: list[str]) -> dict | None:
        """The ONE coordination fact of a floor change. `members` is the leader's own view of who was
        ready; anyone not in the party is dropped. The leader's floor moves to `to_floor` now, which is
        what lets a member who missed the departure notice and catch up on their own lift."""
        party = self._parties.get(party_id)
        if party is None:
            return None
        ready = [e for e in (_normalize_email(m) for m in members) if e in party["members"]]
        party["leader_floor"] = to_floor
        party["phase"] = "travelling"
        party["gather_floor"] = None
        party["departures"] += 1
        return {
            "partyId": party_id,
            "departureId": f"{party_id}:{party['departures']}",
            "fromFloor": from_floor,
            "toFloor": to_floor,
            "members": ready,
        }

    def set_destination(self, party_id: str, destination: dict) -> bool:
        party = self._parties.get(party_id)
        if party is None:
            return False
        party["destination"] = destination
        return True

    # --- which tab drives each body ------------------------------------------------------

    def claim(self, party_id: str, email: str, sid: str) -> bool:
        """A reloaded tab takes back the driving role. Only while the previous driver is gone — a
        second live tab must not steal the body from the first."""
        party = self._parties.get(party_id)
        if party is None:
            return False
        key = _normalize_email(email)
        if key == party["leader_email"]:
            if party["leader_lost_at"] is None and party["leader_sid"] != sid:
                return False
            party["leader_sid"], party["leader_lost_at"] = sid, None
            return True
        m = party["members"].get(key)
        if m is None or (m["lost_at"] is None and m["sid"] != sid):
            return False
        m["sid"], m["lost_at"] = sid, None
        return True

    def controller_sid(self, party: dict, email: str) -> str | None:
        key = _normalize_email(email)
        if key == party["leader_email"]:
            return None if party["leader_lost_at"] is not None else party["leader_sid"]
        m = party["members"].get(key)
        return None if m is None or m["lost_at"] is not None else m["sid"]

    def orphan_sid(self, sid: str, *, now: float | None = None) -> list[tuple[str, str]]:
        """The socket driving somebody's body went away. Marks them lost (not removed — a refresh must
        survive) and returns (partyId, email) pairs for the caller to re-check after the grace."""
        moment = now if now is not None else time.time()
        out: list[tuple[str, str]] = []
        for pid, party in self._parties.items():
            if party["leader_sid"] == sid and party["leader_lost_at"] is None:
                party["leader_lost_at"] = moment
                out.append((pid, party["leader_email"]))
            for email, m in party["members"].items():
                if m["sid"] == sid and m["lost_at"] is None:
                    m["lost_at"] = moment
                    out.append((pid, email))
        return out

    def still_lost(self, party_id: str, email: str) -> bool:
        party = self._parties.get(party_id)
        if party is None:
            return False
        key = _normalize_email(email)
        if key == party["leader_email"]:
            return party["leader_lost_at"] is not None
        m = party["members"].get(key)
        return m is not None and m["lost_at"] is not None

    def reset(self) -> None:
        """Test-only: module-level singleton in state.py."""
        self._parties.clear()
        self._by_email.clear()


def wire(party: dict, *, pending: list[str] | None = None) -> dict:
    """Client-facing shape. Socket ids never leave the server (see controller_sid for the per-recipient
    flag socket.py adds)."""
    return {
        "partyId": party["partyId"],
        "leaderEmail": party["leader_email"],
        "destination": party["destination"],
        "leaderFloor": party["leader_floor"],
        "phase": party["phase"],
        "gatherFloor": party["gather_floor"],
        "members": [
            {"email": email, "following": m["following"], "connected": m["lost_at"] is None}
            for email, m in party["members"].items()
        ],
        "pending": sorted(pending or []),
    }
