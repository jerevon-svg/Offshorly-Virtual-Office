"""CAMPUS SCOOTERS — who has which scooter, decided in ONE place.

The six stand-up scooters on the campus (four at Reception, two at the AI Lab — the V2 world's
world/scooters.ts docks, by the same ids) are shared: two employees must never ride the same one, and
everybody must see the same scooters missing from the same racks. The browser that wants to ride ASKS;
this registry answers; the answer is broadcast. Nothing about riding itself (speed, steering, the rider's
pose) is decided or carried here.

STATES
    docked    in its rack. Anyone may claim it.
    ridden    claimed by `rider` on socket `rider_sid`. Only that rider may release it.
    standing  upright away from its rack, at `at` (x, z, yaw). Anyone may claim it. (Today a dismount
              always returns the scooter to its rack; this state exists for the recovery stages.)
    fallen    lying where an accident left it. RESERVED for the accident stages: nobody can claim it yet.

DISCONNECTS follow the travel-party rule: the rider's socket going away marks the scooter LOST, not free —
a page refresh must not hand somebody's scooter to a bystander mid-ride. The same rider claiming it again
within the grace takes it back on the new socket; otherwise, after the grace, it goes home to its rack.

In-memory by design, like every other live-presence registry in app/realtime/state.py: a server restart
puts every scooter back in its rack, which is exactly right.
"""
from __future__ import annotations

import math
import time

# THE FLEET, by the ids the V2 world gives its docks (frontend/src/dev/vo3d/world/scooters.ts). A test on
# the frontend reads this list back, so the two cannot drift apart.
SCOOTER_IDS: tuple[str, ...] = ("scooter-r1", "scooter-r2", "scooter-r3", "scooter-r4", "scooter-l1", "scooter-l2")

STATES = ("docked", "ridden", "standing", "fallen")

# how long a rider whose socket dropped keeps their scooter (the party registry's grace, for the same reason)
RECONNECT_GRACE_SECONDS = 15

# S2 — THE RIDER'S POSE STREAM. The rider's browser sends ~10 a second; the server relays them. Anything
# faster than this is dropped (a tab that lost its throttle, a replay), never queued.
POSE_MIN_INTERVAL_S = 0.04


class ScooterRegistry:
    def __init__(self, ids: tuple[str, ...] = SCOOTER_IDS) -> None:
        self._ids = ids
        self._s: dict[str, dict] = {}
        self.reset()

    def reset(self) -> None:
        self._s = {i: self._fresh(i) for i in self._ids}

    @staticmethod
    def _fresh(scooter_id: str, now: float = 0.0) -> dict:
        return {"id": scooter_id, "state": "docked", "rider": None, "rider_sid": None, "lost_at": None, "at": None, "since": now, "version": 0, "pose": None, "pose_seq": -1, "pose_at": 0.0, "accident": None}

    # ---- reads ------------------------------------------------------------------------------------
    def get(self, scooter_id: str) -> dict | None:
        return self._s.get(scooter_id)

    def ridden_by(self, email: str) -> dict | None:
        for s in self._s.values():
            if s["state"] == "ridden" and s["rider"] == email:
                return s
        return None

    def snapshot(self) -> list[dict]:
        return [self.wire(s) for s in self._s.values()]

    @staticmethod
    def wire(s: dict) -> dict:
        return {
            "id": s["id"], "state": s["state"], "rider": s["rider"], "at": s["at"],
            "since": s["since"], "version": s["version"],
            # the rider's last pose (S2), so somebody joining mid-ride draws them where they are at once
            "pose": s["pose"] if s["state"] == "ridden" else None,
            # S5 — the confirmed accident a FALLEN scooter belongs to (the rider stays its owner for S7's lift)
            "accident": s["accident"],
        }

    # ---- writes -----------------------------------------------------------------------------------
    def _set(self, s: dict, now: float, **fields) -> dict:
        # a new ride (or the same ride on a new socket) starts its pose stream again
        if fields.get("rider_sid", s["rider_sid"]) != s["rider_sid"] or fields.get("state", s["state"]) != s["state"]:
            fields.setdefault("pose", None)
            fields.setdefault("pose_seq", -1)
            fields.setdefault("pose_at", 0.0)
        s.update(fields)
        s["since"] = now
        s["version"] += 1
        return s

    def claim(self, scooter_id: str, email: str, sid: str, *, now: float | None = None) -> tuple[dict | None, str | None]:
        """Ask to ride `scooter_id`. Returns (scooter, None) when granted, (None, reason) when refused."""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None:
            return None, "unknown"
        if s["state"] == "fallen":
            return None, "fallen"
        if s["state"] == "ridden":
            # THE SAME RIDER, BACK ON A NEW SOCKET within the grace (a refresh mid-ride): theirs again
            if s["rider"] == email and s["lost_at"] is not None:
                return self._set(s, moment, rider_sid=sid, lost_at=None), None
            if s["rider"] == email and s["rider_sid"] == sid:
                return s, None  # a repeated request: already theirs
            return None, "taken"
        other = self.ridden_by(email)
        if other is not None and other["id"] != scooter_id:
            return None, "already_riding"
        return self._set(s, moment, state="ridden", rider=email, rider_sid=sid, lost_at=None, at=None), None

    def release(self, scooter_id: str, email: str, sid: str, *, at: dict | None = None, now: float | None = None) -> tuple[dict | None, str | None]:
        """The rider gets off. Home to the rack, or — with `at` — left standing there. Only the rider may."""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None:
            return None, "unknown"
        if s["state"] != "ridden" or s["rider"] != email:
            return None, "not_rider"
        if s["rider_sid"] != sid and s["lost_at"] is None:
            return None, "not_rider"  # another live tab of the same person does not get to end this ride
        if at is not None:
            return self._set(s, moment, state="standing", rider=None, rider_sid=None, lost_at=None, at=at), None
        return self._dock(s, moment), None

    def _dock(self, s: dict, now: float) -> dict:
        return self._set(s, now, state="docked", rider=None, rider_sid=None, lost_at=None, at=None)

    def accept_pose(self, scooter_id: str, email: str, sid: str, seq: int, pose: dict, *, now: float | None = None) -> str | None:
        """S2 — a pose from the rider's browser. Accepted only from the scooter's CURRENT rider on the socket
        that holds the ride, in order (seq strictly increasing), and no faster than POSE_MIN_INTERVAL_S.
        Returns None when accepted (and stored for late joiners), else why it was dropped."""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None:
            return "unknown"
        if s["state"] != "ridden" or s["rider"] != email or s["rider_sid"] != sid or s["lost_at"] is not None:
            return "not_rider"
        if seq <= s["pose_seq"]:
            return "stale"
        if moment - s["pose_at"] < POSE_MIN_INTERVAL_S:
            return "too_fast"
        s["pose"] = pose
        s["pose_seq"] = seq
        s["pose_at"] = moment
        return None

    def fall(self, scooter_id: str, email: str, at: dict, accident_id: str, *, now: float | None = None) -> dict | None:
        """S5 — a CONFIRMED accident: the rider's scooter lies where it happened. Its rider stays its owner (only
        they will lift it, S7); nobody can claim it meanwhile (`claim` refuses `fallen`)."""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None or s["state"] != "ridden" or s["rider"] != email:
            return None
        return self._set(s, moment, state="fallen", at=at, accident=accident_id, lost_at=None)

    def rest(self, scooter_id: str, accident_id: str, at: dict, *, now: float | None = None) -> dict | None:
        """S6 — the fallen scooter's resting place, once its rider's world has said how far it could slide"""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None or s["state"] != "fallen" or s["accident"] != accident_id:
            return None
        return self._set(s, moment, at=at)

    def remount(self, scooter_id: str, accident_id: str, email: str, sid: str, *, now: float | None = None) -> dict | None:
        """S7 — the rider rides the scooter they lifted, from where it stands (never via its rack)"""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None or s["state"] != "fallen" or s["accident"] != accident_id or s["rider"] != email:
            return None
        return self._set(s, moment, state="ridden", rider=email, rider_sid=sid, lost_at=None, at=None, accident=None)

    def recover(self, scooter_id: str, accident_id: str, *, now: float | None = None) -> dict | None:
        """S5 — the accident is over (S7: lifted; until then: the temporary timeout or the rider leaving): home to
        its rack, nobody's. Only the accident it fell in can end it."""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None or s["state"] != "fallen" or s["accident"] != accident_id:
            return None
        return self._set(s, moment, state="docked", rider=None, rider_sid=None, lost_at=None, at=None, accident=None)

    def orphan_sid(self, sid: str, *, now: float | None = None) -> list[str]:
        """The rider's socket went away: their scooter is LOST, not free. Returns the ids to re-check."""
        moment = now if now is not None else time.time()
        out: list[str] = []
        for s in self._s.values():
            if s["state"] == "ridden" and s["rider_sid"] == sid and s["lost_at"] is None:
                s["lost_at"] = moment
                out.append(s["id"])
        return out

    def expire_lost(self, scooter_id: str, *, now: float | None = None, grace: float = RECONNECT_GRACE_SECONDS) -> dict | None:
        """After the grace: a scooter still lost goes home. Returns it when it changed, else None."""
        moment = now if now is not None else time.time()
        s = self._s.get(scooter_id)
        if s is None or s["state"] != "ridden" or s["lost_at"] is None or moment - s["lost_at"] < grace:
            return None
        return self._dock(s, moment)


def valid_at(raw) -> dict | None:
    """A standing position off the wire: finite x, z, yaw — or None."""
    if not isinstance(raw, dict):
        return None
    out = {}
    for k in ("x", "z", "yaw"):
        v = raw.get(k)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > 1e6:
            return None
        out[k] = float(v)
    return out


# THE POSE'S FIELDS: where the rider stands (x, z on the ground; y the deck's height), which way the deck
# points (heading — the ride convention, forward = (sin h, -cos h)), and how it moves (speed, lean, pitch).
_POSE_BOUNDS = {"x": 1e5, "z": 1e5, "y": 1e3, "heading": 100.0, "speed": 1e3, "lean": 2.0, "pitch": 2.0}
# RESERVED FOR S3 DRIFTING, validated today so the wire is ready: drift direction (-1/0/1), its charge (0..1),
# the sideways slip angle (rad) and whether a boost is firing. Unknown keys are dropped, never relayed.
_FX_BOUNDS = {"charge": (0.0, 1.0), "slip": (-2.0, 2.0)}


def _num(v, bound: float) -> float | None:
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > bound:
        return None
    return float(v)


def valid_pose(raw) -> dict | None:
    """A rider pose off the wire, or None. Returns {scooterId, seq, t, pose: {...}} with only known fields."""
    if not isinstance(raw, dict):
        return None
    scooter_id = raw.get("scooterId")
    seq = raw.get("seq")
    t = raw.get("t")
    if not isinstance(scooter_id, str) or not 0 < len(scooter_id) <= 32:
        return None
    if not isinstance(seq, int) or isinstance(seq, bool) or not 0 <= seq < 2**53:
        return None
    if not isinstance(t, (int, float)) or isinstance(t, bool) or not math.isfinite(t) or not 0 <= t < 1e14:
        return None
    pose: dict = {}
    for k, bound in _POSE_BOUNDS.items():
        v = _num(raw.get(k), bound)
        if v is None:
            return None
        pose[k] = v
    if pose["speed"] < -100:
        return None
    fx_raw = raw.get("fx")
    if fx_raw is not None:
        if not isinstance(fx_raw, dict):
            return None
        fx: dict = {}
        drift = fx_raw.get("drift")
        if drift is not None:
            if drift not in (-1, 0, 1) or isinstance(drift, bool):
                return None
            fx["drift"] = int(drift)
        for k, (lo, hi) in _FX_BOUNDS.items():
            v = fx_raw.get(k)
            if v is None:
                continue
            n = _num(v, max(abs(lo), abs(hi)))
            if n is None or not lo <= n <= hi:
                return None
            fx[k] = n
        boost = fx_raw.get("boost")
        if boost is not None:
            if not isinstance(boost, bool):
                return None
            fx["boost"] = boost
        if fx:
            pose["fx"] = fx
    return {"scooterId": scooter_id, "seq": seq, "t": float(t), "pose": pose}
