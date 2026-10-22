"""SCOOTER ACCIDENTS (S5) — one authoritative event per real crash.

The RIDER's browser notices a hard contact between its own scooter and a car (frontend world/scooterCrash.ts)
and says so. Nothing is taken on trust: the report must come from the scooter's current rider on the socket
holding the ride, be fresh on the shared clock, stand where the rider's own pose stream last put them, and —
against the server's own copy of that car at that moment (app/services/traffic_model.py, holds included) —
actually touch the car's body with a closing speed only a crash has. A car that had braked to a stop is not
crashed into at walking-pace bumps; pedestrians never report at all (only a ridden scooter can).

One accident per rider, per scooter and per car at a time; a rider who just had one is given a moment before
another counts. What a confirmed accident does (the scooter falls, the car is held for it) is the caller's,
through the scooter and traffic registries.

S7 — RECOVERY. An accident goes CRASHING (the S6 crash plays) → FALLEN (the rider is up; the scooter lies there) →
LIFTING (the rider, beside it, pressed E: everybody plays the same lift from `liftAt`) → UPRIGHT (standing where it
was recovered, theirs to ride) → resolved when they RIDE it again (app/realtime/socket.py scooter_claim). Every
step is the rider's own, on the socket holding the accident, standing where the server last had them, within
RECOVER_RANGE of the scooter. Nothing can stay stuck: the rider leaving ends it at once, and an accident nobody
moves on for ABANDON_S ends on its own (the scooter goes home, the car goes once nobody is in its way).
"""
from __future__ import annotations

import math
import secrets
import time

from app.services import traffic_model as tm

# frontend world/scooterCrash.ts ACCIDENT — the same thresholds, world units per second
RADIUS = 15
GENTLE = 45
MIN_CLOSING = 110
STOPPED = 8
HARD_INTO_STOPPED = 200

# how far the server's judgement may differ from the rider's (network timing, the sweep's sub-steps)
CONTACT_TOLERANCE = 30
CLOSING_TOLERANCE = 40
POSE_TOLERANCE = 90
SPEED_TOLERANCE = 150
MAX_AGE_S = 1.5
MAX_AHEAD_S = 0.3
# a rider's next accident is only believed this long after the last one ended
COOLDOWN_S = 2.0
# S7 — the lift (frontend world/liftMotion.ts LIFT): the scooter is upright this long after E, the rider done here
LIFT_UPRIGHT_S = 1.55
LIFT_DONE_S = 1.85
# how far from the scooter the rider may lift or ride it (the browser offers it within 55; a step of slack)
RECOVER_RANGE = 75.0
# an accident nobody has moved on in this long ends on its own (generous: never while somebody is recovering)
ABANDON_S = 120.0


def contact(sx: float, sz: float, s_heading: float, s_speed: float, cx: float, cz: float, c_heading: float, c_speed: float, length: float, width: float) -> tuple[float, float, float, float]:
    """(signed distance from the car's body, closing speed, contact normal x, z — car to scooter) —
    frontend world/scooterCrash.ts assessContact"""
    c, sn = math.cos(c_heading), math.sin(c_heading)
    dx, dz = sx - cx, sz - cz
    a, lat = dx * c + dz * sn, -dx * sn + dz * c
    hl, hw = length / 2, width / 2
    oa, ol = abs(a) - hl, abs(lat) - hw
    outside = oa > 0 or ol > 0
    sd = math.hypot(max(oa, 0.0), max(ol, 0.0)) if outside else max(oa, ol)
    if outside:
        na = math.copysign(oa, a) if oa > 0 else 0.0
        nl = math.copysign(ol, lat) if ol > 0 else 0.0
        n = math.hypot(na, nl) or 1.0
        na, nl = na / n, nl / n
    elif oa > ol:
        na, nl = (math.copysign(1.0, a) if a != 0 else 1.0), 0.0
    else:
        na, nl = 0.0, (math.copysign(1.0, lat) if lat != 0 else 1.0)
    nx, nz = na * c - nl * sn, na * sn + nl * c
    vsx, vsz = math.sin(s_heading) * s_speed, -math.cos(s_heading) * s_speed
    vcx, vcz = c * c_speed, sn * c_speed
    return sd, (vcx - vsx) * nx + (vcz - vsz) * nz, nx, nz


# S6 — THE CRASH'S PLAN (frontend world/accidentMotion.ts accidentPlan, number for number): which way the rider
# and the scooter are thrown, where the scooter comes to rest (S7 lifts it there) and how long it all takes (the
# temporary cleanup never cuts a crash short). The browsers animate it; this is only what they agree on.
G = 420.0
C_HIP, C_DECK, C_LIE_HIP = 8.5, 3.0, 4.0
C_LIGHT, C_HEAVY = 110.0, 380.0
C_RESTITUTION, C_TANGENT_KEEP, C_RIDER_CARRY = 0.3, 0.8, 0.7
C_MIN_SHARE, C_MIN_SPEED, C_MAX_SPEED = 0.5, 60.0, 260.0
C_HOP = (10.0, 95.0)
C_LAND_KEEP, C_LAND_KEEP_BOUNCE, C_BOUNCE_KEEP = 0.62, 0.78, 0.8
C_BOUNCE_FROM, C_BOUNCE = 0.4, 0.28
C_SKID_DECEL, C_MAX_TRAVEL, C_MIN_AWAY = 300.0, 240.0, 0.3
C_LIE, C_RISE = (0.7, 1.15), 1.4
S_COM, S_LIE_COM = 7.0, 3.0
S_MIN_SHARE, S_MIN_SPEED, S_MAX_SPEED = 0.45, 40.0, 280.0
S_HOP = (0.0, 80.0)
S_LAND_KEEP, S_BOUNCE_KEEP, S_BOUNCE_FROM, S_BOUNCE = 0.75, 0.8, 0.3, 0.35
S_SLIDE_DECEL, S_MAX_TRAVEL, S_MIN_AWAY, S_SEPARATION = 420.0, 260.0, 0.15, 0.35
# a blocked throw may turn by one of these (radians) and still leave the car at least REACH_MIN_AWAY
REACH_TURNS = (0.0, 0.3, -0.3, 0.6, -0.6)
REACH_MIN_AWAY = 0.12


def _clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


def _smooth(u: float) -> float:
    k = _clamp(u, 0.0, 1.0)
    return k * k * (3 - 2 * k)


def _sgn(v: float, fallback: int) -> int:
    return 1 if v > 1e-9 else -1 if v < -1e-9 else fallback


def _unit(x: float, z: float, fx: float, fz: float) -> tuple[float, float]:
    n = math.hypot(x, z)
    return (x / n, z / n) if n > 1e-6 else (fx, fz)


def _rot(x: float, z: float, a: float) -> tuple[float, float]:
    return x * math.cos(a) - z * math.sin(a), x * math.sin(a) + z * math.cos(a)


def _away(dx: float, dz: float, nx: float, nz: float, lo: float, pref: int) -> tuple[float, float]:
    if dx * nx + dz * nz >= lo:
        return dx, dz
    tx, tz = -nz, nx
    s, t = _sgn(dx * tx + dz * tz, pref), math.sqrt(1 - lo * lo)
    return nx * lo + tx * s * t, nz * lo + tz * s * t


def _air(vy: float, drop: float) -> float:
    return (vy + math.sqrt(vy * vy + 2 * G * max(0.0, drop))) / G


def _reach(reach: dict | None, body: str) -> tuple[float, float]:
    r = (reach or {}).get(body) or {}
    return _clamp(float(r.get("k", 1.0)), 0.0, 1.0), float(r.get("turn", 0.0))


def accident_plan(x: float, z: float, heading: float, speed: float, closing: float, car_heading: float, car_speed: float, nx: float, nz: float, reach: dict | None = None) -> dict:
    fx, fz = math.sin(heading), -math.cos(heading)
    nx, nz = _unit(nx, nz, fx, fz)
    vsx, vsz = fx * speed, fz * speed
    vcx, vcz = math.cos(car_heading) * car_speed, math.sin(car_heading) * car_speed
    rx, rz = vsx - vcx, vsz - vcz
    rn = rx * nx + rz * nz
    tx, tz = rx - rn * nx, rz - rn * nz
    closing = max(0.0, closing)
    impact = 0.6 * closing + 0.4 * math.hypot(rx, rz)
    s = _clamp((impact - C_LIGHT) / (C_HEAVY - C_LIGHT), 0.0, 1.0)
    pref = _sgn(vcx * -nz + vcz * nx, 1)
    ax, az = vcx + C_TANGENT_KEEP * tx + nx * C_RESTITUTION * closing, vcz + C_TANGENT_KEEP * tz + nz * C_RESTITUTION * closing
    qx, qz = (1 - C_RIDER_CARRY) * vsx + C_RIDER_CARRY * ax, (1 - C_RIDER_CARRY) * vsz + C_RIDER_CARRY * az
    rdx, rdz = _away(*_unit(qx, qz, nx, nz), nx, nz, C_MIN_AWAY, pref)
    sdx, sdz = _away(*_unit(ax, az, nx, nz), nx, nz, S_MIN_AWAY, pref)
    apart = math.acos(_clamp(rdx * sdx + rdz * sdz, -1.0, 1.0))
    if apart < S_SEPARATION:
        sdx, sdz = _rot(sdx, sdz, (S_SEPARATION - apart) * _sgn(rdx * sdz - rdz * sdx, pref))
        sdx, sdz = _away(sdx, sdz, nx, nz, S_MIN_AWAY, pref)
    _rk, rturn = _reach(reach, "rider")   # (the rider's reach shortens only their own throw: nothing here)
    sk, sturn = _reach(reach, "scooter")
    rdx, rdz = _rot(rdx, rdz, rturn)
    sdx, sdz = _rot(sdx, sdz, sturn)
    # the rider: how long they are down
    sp = _clamp(max(math.hypot(qx, qz), C_MIN_SHARE * impact), C_MIN_SPEED, C_MAX_SPEED)
    vy = C_HOP[0] + (C_HOP[1] - C_HOP[0]) * s
    t1 = _air(vy, C_DECK + C_HIP - C_LIE_HIP)
    vy2 = C_BOUNCE * (G * t1 - vy) * _smooth((s - C_BOUNCE_FROM) / (1 - C_BOUNCE_FROM)) if s > C_BOUNCE_FROM else 0.0
    if vy2 < 10:
        vy2 = 0.0
    h1 = sp * (C_LAND_KEEP_BOUNCE if vy2 > 0 else C_LAND_KEEP)
    hs = h1 * C_BOUNCE_KEEP if vy2 > 0 else h1
    rider_end = t1 + 2 * vy2 / G + hs / C_SKID_DECEL + C_LIE[0] + (C_LIE[1] - C_LIE[0]) * s + C_RISE
    # the scooter: where it comes to rest
    sps = _clamp(max(math.hypot(ax, az), S_MIN_SHARE * impact), S_MIN_SPEED, S_MAX_SPEED)
    vys = S_HOP[0] + (S_HOP[1] - S_HOP[0]) * s
    t1s = _air(vys, S_COM - S_LIE_COM)
    vy2s = S_BOUNCE * (G * t1s - vys) * _smooth((s - S_BOUNCE_FROM) / (1 - S_BOUNCE_FROM)) if s > S_BOUNCE_FROM else 0.0
    if vy2s < 8:
        vy2s = 0.0
    t2s = 2 * vy2s / G
    h1s = sps * S_LAND_KEEP
    hss = h1s * S_BOUNCE_KEEP if vy2s > 0 else h1s
    travel_s = sps * t1s + h1s * t2s + hss * hss / (2 * S_SLIDE_DECEL)
    travel_s *= min(1.0, S_MAX_TRAVEL / travel_s) * sk
    return {
        "severity": s, "dx": sdx, "dz": sdz, "riderDx": rdx, "riderDz": rdz, "nx": nx, "nz": nz,
        "restX": x + sdx * travel_s, "restZ": z + sdz * travel_s,
        "end": max(rider_end, t1s + t2s + hss / S_SLIDE_DECEL),
    }


def valid_reach(raw, accident: dict) -> dict | None:
    """a rider's browser's REACH for its own accident: only shorter throws, only the listed turns, never toward the car"""
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    for body in ("rider", "scooter"):
        r = raw.get(body)
        if not isinstance(r, dict):
            return None
        k, turn = r.get("k"), r.get("turn")
        if not isinstance(k, (int, float)) or isinstance(k, bool) or not math.isfinite(k) or not 0 <= k <= 1:
            return None
        if not isinstance(turn, (int, float)) or isinstance(turn, bool) or not any(abs(turn - t) < 1e-9 for t in REACH_TURNS):
            return None
        out[body] = {"k": float(k), "turn": float(turn)}
    base = accident_plan(accident["x"], accident["z"], accident["heading"], accident["speed"], accident["closing"], accident["carHeading"], accident["carSpeed"], accident["nx"], accident["nz"])
    for body, (bx, bz) in (("rider", (base["riderDx"], base["riderDz"])), ("scooter", (base["dx"], base["dz"]))):
        turn = out[body]["turn"]
        if turn != 0:
            dx, dz = _rot(bx, bz, turn)
            if dx * base["nx"] + dz * base["nz"] < REACH_MIN_AWAY:
                return None
    return out


def phase(a: dict, now: float) -> str:
    """CRASHING → FALLEN → LIFTING → UPRIGHT, from the accident's own timestamps on the shared clock"""
    if a.get("liftAt") is not None:
        return "lifting" if now < a["liftAt"] + LIFT_UPRIGHT_S else "upright"
    return "crashing" if now < a["at"] + a["crashEnd"] else "fallen"


def is_accident(closing: float, car_speed: float, tolerance: float = 0.0) -> bool:
    return closing >= MIN_CLOSING - tolerance and (car_speed >= STOPPED or closing >= HARD_INTO_STOPPED - tolerance)


def valid_accident(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    sid, loop, vi = raw.get("scooterId"), raw.get("loop"), raw.get("vehicle")
    if not isinstance(sid, str) or not 0 < len(sid) <= 32 or loop not in tm.LOOP_INDEX or not isinstance(vi, int) or isinstance(vi, bool):
        return None
    if not 0 <= vi < len(tm.PATHS[tm.LOOP_INDEX[loop]].offsets):
        return None
    out.update(scooterId=sid, loop=loop, vehicle=vi)
    for k, bound in (("x", 1e5), ("z", 1e5), ("heading", 100.0), ("speed", 1e3), ("t", 1e11), ("closing", 1e4)):
        v = raw.get(k)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > bound:
            return None
        out[k] = float(v)
    return out


class AccidentRegistry:
    def __init__(self) -> None:
        self._a: dict[str, dict] = {}
        self._ended_at: dict[str, float] = {}

    def reset(self) -> None:
        self._a.clear()
        self._ended_at.clear()

    def get(self, accident_id: str) -> dict | None:
        return self._a.get(accident_id)

    def snapshot(self) -> list[dict]:
        return [self.wire(a) for a in self._a.values()]

    @staticmethod
    def wire(a: dict) -> dict:
        return {**{k: a[k] for k in ("id", "rider", "scooterId", "loop", "vehicle", "at", "x", "z", "heading", "speed", "closing", "carHeading", "carSpeed", "endsAt", "nx", "nz", "restX", "restZ", "reach", "crashEnd", "liftAt", "liftFrom")},
                "phase": phase(a, time.time())}

    def create(self, email: str, sid: str, r: dict, scooter: dict | None, car: dict | None, *, now: float | None = None) -> tuple[dict | None, str | None]:
        """Judge a crash report. `scooter` is the scooter registry's record, `car` the traffic registry's schedule
        for that car (or None: on schedule). Returns (accident, None) or (None, why it was refused)."""
        moment = now if now is not None else time.time()
        if scooter is None or scooter["state"] != "ridden" or scooter["rider"] != email or scooter["rider_sid"] != sid or scooter["lost_at"] is not None:
            return None, "not_rider"
        for a in self._a.values():
            if a["rider"] == email or a["scooterId"] == r["scooterId"] or (a["loop"], a["vehicle"]) == (r["loop"], r["vehicle"]):
                return None, "duplicate"
        if moment - self._ended_at.get(email, -1e9) < COOLDOWN_S:
            return None, "cooldown"
        if not moment - MAX_AGE_S <= r["t"] <= moment + MAX_AHEAD_S:
            return None, "stale"
        pose = scooter.get("pose")
        if not pose or moment - scooter.get("pose_at", 0.0) > MAX_AGE_S or math.hypot(pose["x"] - r["x"], pose["z"] - r["z"]) > POSE_TOLERANCE:
            return None, "position"
        if r["speed"] > abs(pose.get("speed", 0.0)) + SPEED_TOLERANCE:
            return None, "speed"
        path = tm.PATHS[tm.LOOP_INDEX[r["loop"]]]
        kind = path.loop["kinds"][r["vehicle"]]
        cx, cz, ch, cs = tm.car_state(r["loop"], r["vehicle"], car, r["t"])
        sd, closing, nx, nz = contact(r["x"], r["z"], r["heading"], r["speed"], cx, cz, ch, cs, tm.VEHICLE_LENGTH.get(kind, 120), tm.VEHICLE_WIDTH.get(kind, 60))
        if sd > RADIUS + CONTACT_TOLERANCE:
            return None, "no_contact"
        if not is_accident(closing, cs, CLOSING_TOLERANCE):
            return None, "not_an_accident"
        a = {
            "id": secrets.token_hex(6), "rider": email, "riderSid": sid, "scooterId": r["scooterId"],
            "loop": r["loop"], "vehicle": r["vehicle"], "at": r["t"], "x": r["x"], "z": r["z"],
            "heading": r["heading"], "speed": r["speed"], "closing": closing, "carHeading": ch, "carSpeed": cs,
            "endsAt": moment + ABANDON_S, "nx": nx, "nz": nz,
        }
        plan = accident_plan(r["x"], r["z"], r["heading"], r["speed"], closing, ch, cs, nx, nz)
        a["restX"], a["restZ"], a["reach"] = plan["restX"], plan["restZ"], None
        # S7 — the crash plays to its end (nothing can be done before), then the rider has ABANDON_S to act
        a["crashEnd"] = plan["end"]
        a["liftAt"], a["liftFrom"] = None, None
        a["endsAt"] = r["t"] + plan["end"] + ABANDON_S
        self._a[a["id"]] = a
        return a, None

    def set_reach(self, accident_id: str, email: str, sid: str, raw) -> tuple[dict | None, str | None]:
        """S6 — the rider's browser says how far the throws may go (its world's walls and the car): once, by the
        rider's own socket, shorter only. The scooter's resting place follows."""
        a = self._a.get(accident_id)
        if a is None:
            return None, "unknown"
        if a["rider"] != email or a["riderSid"] != sid:
            return None, "not_rider"
        if a["reach"] is not None:
            return None, "duplicate"
        reach = valid_reach(raw, a)
        if reach is None:
            return None, "invalid"
        plan = accident_plan(a["x"], a["z"], a["heading"], a["speed"], a["closing"], a["carHeading"], a["carSpeed"], a["nx"], a["nz"], reach)
        a["reach"], a["restX"], a["restZ"] = reach, plan["restX"], plan["restZ"]
        return a, None

    def for_scooter(self, scooter_id: str) -> dict | None:
        return next((a for a in self._a.values() if a["scooterId"] == scooter_id), None)

    @staticmethod
    def _recoverer(a: dict, email: str, sid: str, x: float, z: float) -> str | None:
        if a["rider"] != email or a["riderSid"] != sid:
            return "not_rider"
        if math.hypot(x - a["restX"], z - a["restZ"]) > RECOVER_RANGE:
            return "too_far"
        return None

    def lift(self, accident_id: str, email: str, sid: str, x: float, z: float, *, now: float | None = None) -> tuple[dict | None, str | None]:
        """S7 — E BESIDE THE FALLEN SCOOTER: the lift starts now, for everybody. Only its own rider, only once they
        are up (the crash over), only beside it, only once."""
        moment = now if now is not None else time.time()
        a = self._a.get(accident_id)
        if a is None:
            return None, "unknown"
        why = self._recoverer(a, email, sid, x, z)
        if why is not None:
            return None, why
        ph = phase(a, moment)
        if ph == "crashing":
            return None, "too_soon"
        if ph != "fallen":
            return None, "duplicate"
        a["liftAt"], a["liftFrom"] = moment, {"x": x, "z": z}
        a["endsAt"] = moment + LIFT_DONE_S + ABANDON_S
        return a, None

    def remountable(self, scooter_id: str, email: str, sid: str, x: float, z: float, *, now: float | None = None) -> tuple[dict | None, str | None]:
        """S7 — E BESIDE THE UPRIGHT SCOOTER: may its rider ride it from where it stands?"""
        moment = now if now is not None else time.time()
        a = self.for_scooter(scooter_id)
        if a is None:
            return None, "fallen"
        why = self._recoverer(a, email, sid, x, z)
        if why is not None:
            return None, why
        if phase(a, moment) != "upright":
            return None, "not_upright"
        return a, None

    def due(self, now: float | None = None) -> list[str]:
        """the accidents nobody has moved on for ABANDON_S"""
        moment = now if now is not None else time.time()
        return [a["id"] for a in self._a.values() if moment >= a["endsAt"]]

    def resolve(self, accident_id: str, *, now: float | None = None) -> dict | None:
        moment = now if now is not None else time.time()
        a = self._a.pop(accident_id, None)
        if a is not None:
            self._ended_at[a["rider"]] = moment
        return a

    def orphan_sid(self, sid: str) -> list[str]:
        """the rider's socket went away: their accidents end now (nobody is left to recover them)"""
        return [a["id"] for a in self._a.values() if a["riderSid"] == sid]
