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
# STAGES (Phase 2 — FORM → START WALKING → GATHER → READY). A party is born FORMING: accepting moves
# nobody. The leader's Start Walking closes the invite list and moves it to GATHERING at a RENDEZVOUS the
# server picks from each driving tab's OWN reports (party_where): where they already are when every
# participant is on one floor, in one room/area and within TOGETHER_SPREAD of each other, else the Central
# Hub (`kind: "hub"` — the clients resolve the hub, the server never holds world geometry). Each driving
# tab says party_ready once its OWN body stands in its slot; when every active participant has, the party
# is READY — the explicit checkpoint the next leg of the journey starts from. A deadline keeps one stuck
# body from holding the rest: at GATHER_DEADLINE_SECONDS whoever is not there is paused (following False,
# the existing Resume / catch-up path) and the party is READY without them.
#
# THE JOURNEY (Phase 3). READY is followed, a beat later, by the journey's LEGS — each a stage with its own
# stageId and its own barrier, so nobody sets off on a leg before the party does and a stale report can never
# advance a later one:
#
#   to_lift   everyone walks to their OWN lobby slot at the party's lift        (skipped when already on the
#   ride      everyone rides their OWN local lift, with the others as riders      destination floor)
#   to_room   everyone walks to their OWN arrival slot at the destination room
#   → arrived the party ends, exactly once ("arrived")
#
# The server never learns a coordinate of any of it: a leg names a floor (and the ride its riders, in slot
# order); each driving tab resolves its own slot, walks its own body, and says party_ready about ITSELF.
# A leg's barrier is the active participants AT ITS START (`expect`); somebody who pauses or leaves stops
# being waited for, and a leg deadline pauses whoever is still not there so nobody holds the party forever.
#
# INVITATIONS are a THIRD instance of CallInviteRegistry (state.party_invites), carrying `party_id`,
# so they inherit its single-shot resolve, glare check and reconnect snapshot without a copy of it.

MAX_PARTY_MEMBERS = 8
PARTY_INVITE_TTL_SECONDS = 60
# A backstop, not a gameplay rule: the party normally ends on arrival or End/Leave long before this.
PARTY_MAX_LIFETIME_SECONDS = 15 * 60
# How long a person's driving tab may be gone (a refresh, a blip) before they are treated as left.
RECONNECT_GRACE_SECONDS = 15
# ALREADY TOGETHER: the largest distance between any two participants that still counts as "standing
# together" — about four and a half avatar heights (36), a loose circle of people in one room, a little
# wider than the client's REGROUP_RADIUS (120, "regrouped around the leader").
TOGETHER_SPREAD = 160.0
# Long enough to cross the whole ground floor at walk speed (70/s) with a lift ride down on top; short
# enough that a genuinely stuck body never holds the party for long.
GATHER_DEADLINE_SECONDS = 45
# The "Everyone's here" beat between READY and the first leg — set off together, a moment after seeing it.
READY_BEAT_SECONDS = 1.2
# Per leg: long enough for the walk (or the ride's whole cinematic), short enough that a stuck body never
# holds the rest for long.
LEG_DEADLINE_SECONDS = {"to_lift": 45, "ride": 45, "to_room": 45}

STAGES = ("forming", "gathering", "ready", "to_lift", "ride", "to_room")
LEGS = ("to_lift", "ride", "to_room")

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
            # the floor the party is on — the leader's at creation, then the gathered party's, then the ride's
            "floor": leader_floor,
            "leader_following": True,
            "stage": "forming",
            # email -> {"floor", "roomId", "point"} — each driving tab's own last report, forming only
            "where": {},
            # set at Start Walking: {"stageId", "kind": "hub" | "here", "floor"?, "roomId"?, "point"?}
            "rendezvous": None,
            # who Start Walking took (leader first, then members in join order — the slot order)
            "participants": [],
            "ready": set(),
            # who answered "I'll walk there" (declined the party, NOT the meeting) — shown, never waited for
            "declined": [],
            # the current journey leg: {"stageId", "kind", "floor", "toFloor"?, "riders"?}; its barrier below
            "leg": None,
            "legs": 0,
            "expect": [],
            # DESTINATION-AWARE ROLES, decided at Start Walking from each body's own report (see party_roles):
            # "travel" still has to reach the destination floor, "wait" is already on it (meets the party at
            # its lift), "arrived" is already in the destination room (nobody moves them)
            "roles": {},
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
        if key in party["declined"]:
            party["declined"].remove(key)
        return True

    def note_declined(self, party_id: str, email: str) -> None:
        party = self._parties.get(party_id)
        key = _normalize_email(email)
        if party is not None and key not in party["declined"] and key not in party["members"]:
            party["declined"].append(key)

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
        """Paused (took their body back — Esc) or resumed. The leader too: on the journey the leader is one
        of the party, and a paused leader must not hold the others at a barrier either."""
        party = self._parties.get(party_id)
        if party is None:
            return False
        key = _normalize_email(email)
        if key == party["leader_email"]:
            if party["leader_following"] == following:
                return False
            party["leader_following"] = following
            return True
        m = party["members"].get(key)
        if m is None or m["following"] == following:
            return False
        m["following"] = following
        return True

    def set_destination(self, party_id: str, destination: dict) -> bool:
        party = self._parties.get(party_id)
        if party is None:
            return False
        party["destination"] = destination
        return True

    # --- Phase 2: form → start walking → gather → ready ----------------------------------

    def report_where(self, party_id: str, email: str, *, floor: str, room_id: str | None, point: dict) -> bool:
        party = self._parties.get(party_id)
        key = _normalize_email(email)
        if party is None or party["stage"] != "forming" or key not in self.people(party):
            return False
        party["where"][key] = {"floor": floor, "roomId": room_id, "point": point}
        if key == party["leader_email"]:
            party["floor"] = floor  # a leader who changed floors while forming is found on the right one
        return True

    def start(self, party_id: str) -> dict | None:
        """Start Walking. Forming only, and only with somebody who accepted. The rendezvous is decided
        once, here, from the reports already in; nobody new joins after this (the caller withdraws any
        invitation still open)."""
        party = self._parties.get(party_id)
        if party is None or party["stage"] != "forming" or not party["members"]:
            return None
        people = self.people(party)
        party["participants"] = people
        party["ready"] = set()
        party["roles"] = party_roles(party["where"], people, party["destination"])
        travellers = [e for e in people if party["roles"][e] == "travel"]
        # THE RENDEZVOUS IS FOR THOSE STILL DOWNSTAIRS OF THE DESTINATION. Nobody already on the destination
        # floor (or in the room) is ever sent back down to meet them.
        rv = choose_rendezvous(party["where"], travellers) if travellers else {"kind": "here"}
        party["rendezvous"] = {"stageId": f"{party_id}:rv", **rv}
        # Nobody left to gather: straight to READY (the caller then opens the walk to the room).
        party["stage"] = "gathering" if travellers else "ready"
        if not travellers:
            party["floor"] = party["destination"]["floor"]
        return party["rendezvous"]

    def role(self, party: dict, email: str) -> str:
        return party.get("roles", {}).get(_normalize_email(email), "travel")

    def active_participants(self, party: dict) -> list[str]:
        """The participants a barrier waits for: still in the party, connected, and following."""
        out: list[str] = []
        for email in party["participants"]:
            if email == party["leader_email"]:
                if party["leader_lost_at"] is None and party["leader_following"]:
                    out.append(email)
                continue
            m = party["members"].get(email)
            if m is not None and m["following"] and m["lost_at"] is None:
                out.append(email)
        return out

    def current_stage_id(self, party: dict) -> str | None:
        if party["stage"] == "gathering" and party["rendezvous"] is not None:
            return party["rendezvous"]["stageId"]
        if party["stage"] in LEGS and party["leg"] is not None:
            return party["leg"]["stageId"]
        return None

    def mark_ready(self, party_id: str, email: str, stage_id: str, *, floor: str | None = None) -> bool:
        """This body reached its OWN slot for the current stage (only the current one: a late report for an
        earlier stage is ignored). `floor` is where the body now is — the gathered party's floor."""
        party = self._parties.get(party_id)
        key = _normalize_email(email)
        if party is None or self.current_stage_id(party) != stage_id or key not in party["participants"] or key in party["ready"]:
            return False
        party["ready"].add(key)
        if floor is not None:
            party.setdefault("ready_floor", {})[key] = floor
        return True

    def _waiting_for(self, party: dict) -> list[str]:
        active = self.active_participants(party)
        if party["stage"] in LEGS:
            expect = party["expect"]
        else:  # the gathering waits only for the people it gathers
            expect = [e for e in party["participants"] if self.role(party, e) == "travel"]
        return [e for e in expect if e in active]

    def stage_done(self, party: dict) -> bool:
        if party["stage"] not in ("gathering", *LEGS):
            return False
        return all(e in party["ready"] for e in self._waiting_for(party))

    def _pause_stragglers(self, party: dict) -> list[str]:
        stragglers = [e for e in self._waiting_for(party) if e not in party["ready"]]
        for email in stragglers:
            if email == party["leader_email"]:
                party["leader_following"] = False
            else:
                party["members"][email]["following"] = False
        return stragglers

    def finish_gathering(self, party_id: str, *, force: bool = False) -> list[str] | None:
        """GATHERING → READY. With force (the deadline), whoever is not there is paused — Resume catches them
        up later — and the party is READY without them."""
        party = self._parties.get(party_id)
        if party is None or party["stage"] != "gathering" or not (force or self.stage_done(party)):
            return None
        stragglers = self._pause_stragglers(party)
        floors = [f for e, f in party.get("ready_floor", {}).items() if e in party["ready"]]
        if floors:
            # the gathered party stands on one floor; the leader's report breaks a (theoretical) tie
            lead = party.get("ready_floor", {}).get(party["leader_email"])
            party["floor"] = lead if lead in floors else max(set(floors), key=floors.count)
        party["stage"] = "ready"
        return stragglers

    def _open_leg(self, party: dict, kind: str, **fields: object) -> dict:
        party["legs"] += 1
        party["leg"] = {"stageId": f"{party['partyId']}:{party['legs']}:{kind}", "kind": kind, **fields}
        party["stage"] = kind
        party["ready"] = set()
        # WHO EACH LEG WAITS FOR: the lift legs, the people riding; the walk to the room, everybody still on
        # the way — those who waited upstairs join the formation there. Never somebody already in the room.
        roles = ("travel",) if kind in ("to_lift", "ride") else ("travel", "wait")
        party["expect"] = [e for e in self.active_participants(party) if self.role(party, e) in roles]
        return party["leg"]

    def begin_journey(self, party_id: str) -> dict | None:
        """READY → the first leg: the lift when the destination is on another floor, else straight to the room."""
        party = self._parties.get(party_id)
        if party is None or party["stage"] != "ready":
            return None
        to_floor = party["destination"]["floor"]
        if party["floor"] != to_floor:
            return self._open_leg(party, "to_lift", floor=party["floor"], toFloor=to_floor)
        return self._open_leg(party, "to_room", floor=to_floor)

    def advance(self, party_id: str, *, force: bool = False) -> dict | None:
        """THE BARRIER. When everyone the current leg waits for has said ready (or at its deadline, pausing
        whoever has not), open the next leg. Returns {"leg": next leg | None, "arrived": bool,
        "stragglers": [...]}, or None when the leg is not finished (or there is none)."""
        party = self._parties.get(party_id)
        if party is None or party["stage"] not in LEGS or not (force or self.stage_done(party)):
            return None
        stragglers = self._pause_stragglers(party)
        leg = party["leg"]
        if leg["kind"] == "to_lift":
            riders = [e for e in party["participants"] if e in party["ready"]]
            return {"leg": self._open_leg(party, "ride", floor=leg["floor"], toFloor=leg["toFloor"], riders=riders),
                    "arrived": False, "stragglers": stragglers}
        if leg["kind"] == "ride":
            party["floor"] = leg["toFloor"]
            return {"leg": self._open_leg(party, "to_room", floor=leg["toFloor"]), "arrived": False, "stragglers": stragglers}
        return {"leg": None, "arrived": True, "stragglers": stragglers}

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


def party_roles(where: dict[str, dict], people: list[str], destination: dict) -> dict[str, str]:
    """WHERE EACH PERSON ALREADY IS ON THE WAY TO THE DESTINATION, from their own reports: in the room
    ("arrived"), on its floor ("wait"), or still to travel ("travel" — also anybody who has not reported)."""
    dest_floor, dest_room = destination.get("floor"), destination.get("roomId")
    out: dict[str, str] = {}
    for email in people:
        r = where.get(email)
        if r is None or r["floor"] != dest_floor:
            out[email] = "travel"
        elif dest_room is not None and r["roomId"] == dest_room:
            out[email] = "arrived"
        else:
            out[email] = "wait"
    return out


def choose_rendezvous(where: dict[str, dict], people: list[str]) -> dict:
    """THE CENTRAL HUB RULE. Gather where they already are only when every participant has reported and
    they share a floor, a room/area (both outside any room counts as one area) and no two are more than
    TOGETHER_SPREAD apart — anchored on the leader's own spot, which is standable by construction.
    Anything else, including a participant who has not reported, gathers at the Central Hub."""
    reports = [where.get(e) for e in people]
    if any(r is None for r in reports) or not reports:
        return {"kind": "hub"}
    if len({r["floor"] for r in reports}) != 1 or len({r["roomId"] for r in reports}) != 1:
        return {"kind": "hub"}
    pts = [r["point"] for r in reports]
    spread = max((math.hypot(a["x"] - b["x"], a["z"] - b["z"]) for i, a in enumerate(pts) for b in pts[i + 1:]), default=0.0)
    if spread > TOGETHER_SPREAD:
        return {"kind": "hub"}
    lead = reports[0]
    out = {"kind": "here", "floor": lead["floor"], "point": dict(lead["point"])}
    if lead["roomId"] is not None:
        out["roomId"] = lead["roomId"]
    return out


def wire(party: dict, *, pending: list[str] | None = None) -> dict:
    """Client-facing shape. Socket ids never leave the server (see controller_sid for the per-recipient
    flag socket.py adds)."""
    return {
        "partyId": party["partyId"],
        "leaderEmail": party["leader_email"],
        "destination": party["destination"],
        "leaderFollowing": party["leader_following"],
        "members": [
            {"email": email, "following": m["following"], "connected": m["lost_at"] is None}
            for email, m in party["members"].items()
        ],
        "pending": sorted(pending or []),
        "declined": list(party["declined"]),
        "stage": party["stage"],
        "rendezvous": None if party["rendezvous"] is None else {
            **party["rendezvous"],
            # EVERYONE Start Walking took, in slot order — kept stable when somebody leaves so nobody else's
            # slot moves; the client shows only those still in `members`. `ready` is who said so themselves.
            "participants": list(party["participants"]),
            "ready": sorted(party["ready"]) if party["stage"] in ("gathering", "ready") else [],
        },
        "roles": dict(party.get("roles", {})),
        # the journey leg under way, with its barrier: who it waits for, who has said they are there
        "leg": None if party["leg"] is None or party["stage"] not in LEGS else {
            **party["leg"],
            "expect": list(party["expect"]),
            "ready": sorted(party["ready"]),
        },
    }
