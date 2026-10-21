"""CAMPUS TRAFFIC HOLDS (S4) — the one place a car is told to stop, and to go again.

Every browser reports only its OWN employee: "I am in the lane ahead of car A:3". This registry checks the report
against its own copy of that car (app/services/traffic_model.py — the same deterministic loop every browser
draws), against where the server last knew that employee to be, and then keeps ONE hold per car however many
people are in its way. The hold is a handful of numbers (frontend world/trafficHolds.ts HoldWire); every browser
turns them into the same smooth stop and the same restart, and queues the cars behind on its own.

RELEASE is never a timeout over a live obstacle: a car goes again only when nobody is left in its way — they said
"clear", their reports went STALE (no keep-alive for STALE_S: a frozen tab, a lost socket), or they disconnected —
and then only after SAFETY_S. A car stopped for somebody who vanished therefore restarts within a few seconds.

Not a physics engine and not a collision system: a car that cannot stop in time is flagged `emergency` (it stops
as soon as it can), which is the line S5 will draw between braking and an accident. Nobody is knocked over here.
"""
from __future__ import annotations

import math
import secrets
import time

from app.services import traffic_model as tm

# how long without a keep-alive before an obstacle is presumed gone (the client sends one every 0.6 s)
STALE_S = 2.0
# after the last obstacle leaves, the car waits this long before it moves
SAFETY_S = 0.6
# reports for the same car from the same person, at most this often
MIN_REPORT_S = 0.2
# a body this far from the lane's centre line is not in it (the client's own threshold is 40/52)
LANE_TOLERANCE = 64
# how far ahead of / behind its bumper a car may be held up (the client looks at most ~520 ahead)
LOOK_AHEAD = 650
LOOK_BEHIND = 80
# where a car's front stops short of the obstacle
STANDOFF = 32


def _signed(a: float, m: float) -> float:
    """a wrapped into (-m/2, m/2]"""
    return ((a + m / 2) % m) - m / 2


class TrafficHoldRegistry:
    def __init__(self) -> None:
        self._v: dict[tuple[str, int], dict] = {}
        self._last_report: dict[tuple[str, str, int], float] = {}

    def reset(self) -> None:
        self._v.clear()
        self._last_report.clear()

    # ---- reads ------------------------------------------------------------------------------------
    @staticmethod
    def _off(loop: str, vi: int) -> float:
        return tm.PATHS[tm.LOOP_INDEX[loop]].offsets[vi]

    def _entry(self, loop: str, vi: int) -> dict:
        return self._v.setdefault((loop, vi), {"d0": 0.0, "t0": 0.0, "hold": None, "obstacles": {}})

    def _fold(self, loop: str, vi: int, now: float) -> None:
        e = self._v.get((loop, vi))
        if e is None:
            return
        f = tm.fold(self._off(loop, vi), e, now)
        if f is not e:
            e["d0"], e["t0"], e["hold"] = f["d0"], f["t0"], None

    def car_state(self, loop: str, vi: int) -> dict | None:
        return self._v.get((loop, vi))

    def active_obstacles(self) -> int:
        return sum(len(e["obstacles"]) for e in self._v.values())

    def snapshot(self, now: float | None = None) -> list[dict]:
        moment = now if now is not None else time.time()
        out = []
        for (loop, vi), e in list(self._v.items()):
            self._fold(loop, vi, moment)
            if e["hold"] is None and not e["obstacles"] and tm.catch_up_delay(e, moment) <= 0:
                del self._v[(loop, vi)]  # back on schedule: nothing left to tell anybody
                continue
            h = e["hold"]
            out.append({
                "loop": loop, "vehicle": vi, "d0": e["d0"], "t0": e["t0"],
                "hold": None if h is None else {**{k: h[k] for k in ("id", "stopP", "b", "releaseAt", "emergency")}, "accident": h.get("accident")},
            })
        return out

    # ---- the car, as the server sees it -----------------------------------------------------------------
    def car_arc(self, loop: str, vi: int, now: float) -> float:
        path = tm.PATHS[tm.LOOP_INDEX[loop]]
        return tm.arc_at_path_time(path, tm.vehicle_path_time(self._off(loop, vi), self._v.get((loop, vi)), now))

    def obstacle_arc(self, loop: str, vi: int, x: float, z: float, now: float) -> float | None:
        """where along this car's lane, ahead of it, the body at (x, z) stands — or None if it is not there"""
        li = tm.LOOP_INDEX[loop]
        path = tm.PATHS[li]
        half = tm.VEHICLE_LENGTH.get(path.loop["kinds"][vi], 120) / 2
        front = self.car_arc(loop, vi, now) + half
        best: tuple[float, float] | None = None
        along = -LOOK_BEHIND
        while along <= LOOK_AHEAD:
            px, pz, _, _ = tm.point_at_arc(path, front + along)
            d = math.hypot(px - x, pz - z)
            if d <= LANE_TOLERANCE and (best is None or d < best[0]):
                best = (d, front + along)
            along += 8
        return None if best is None else best[1]

    # ---- writes -------------------------------------------------------------------------------------
    def report(self, email: str, sid: str, loop: str, vi: int, x: float, z: float, kind: str, *, now: float | None = None) -> tuple[bool, str | None]:
        """An employee says they are in car (loop, vi)'s way. Returns (state changed?, why refused)."""
        moment = now if now is not None else time.time()
        if loop not in tm.LOOP_INDEX or not 0 <= vi < len(tm.PATHS[tm.LOOP_INDEX[loop]].offsets):
            return False, "unknown_vehicle"
        key = (email, loop, vi)
        last = self._last_report.get(key)
        if last is not None and moment - last < MIN_REPORT_S:
            return False, "too_fast"
        self._last_report[key] = moment
        self._fold(loop, vi, moment)
        hit = self.obstacle_arc(loop, vi, x, z, moment)
        if hit is None:
            return False, "not_ahead"
        changed = False
        # ONE CAR PER LANE PER PERSON: being in front of a new car means the old one is no longer waiting on you
        for (l2, v2), e2 in self._v.items():
            if l2 == loop and v2 != vi and email in e2["obstacles"]:
                del e2["obstacles"][email]
                changed = self._release_if_empty(l2, v2, moment) or changed
        e = self._entry(loop, vi)
        e["obstacles"][email] = {"sid": sid, "x": x, "z": z, "kind": kind, "seen": moment}
        h = e["hold"]
        if h is not None and h["releaseAt"] is not None and moment < h["releaseAt"]:
            h["releaseAt"] = None  # still in its safety margin: it simply keeps waiting
            return True, None
        if h is not None and h["releaseAt"] is None:
            return changed, None  # already holding: one more (or the same) obstacle
        self._create_hold(loop, vi, hit, moment)
        return True, None

    def _create_hold(self, loop: str, vi: int, hit_arc: float, now: float) -> None:
        li = tm.LOOP_INDEX[loop]
        path = tm.PATHS[li]
        off = self._off(loop, vi)
        e = self._entry(loop, vi)
        half = tm.VEHICLE_LENGTH.get(path.loop["kinds"][vi], 120) / 2
        p_now = tm.vehicle_path_time(off, e, now)
        # the car's rate right now (1 cruising, less while still restarting from a previous hold)
        eps = 1 / 30
        rate = (tm.vehicle_path_time(off, e, now + eps) - p_now) / eps
        s_now = tm.arc_at_path_time(path, p_now)
        stop_arc = hit_arc - STANDOFF - half
        want = p_now + _signed(tm.path_time_at_arc(path, stop_arc) - tm.path_time_at_arc(path, s_now), path.period)
        emergency = False
        if e["hold"] is None and rate >= 0.999:
            # CRUISING: keep its delay, stop where it should; braking starts at TB of path time out
            d0 = tm.catch_up_delay(e, now)
            free = now + off - d0
            x0 = want - free
            if x0 < tm.MIN_B:
                emergency = True
                want = free + tm.MIN_B
                x0 = tm.MIN_B
            b = min(tm.TB, x0)
        else:
            # MID-RESTART: brake from the rate it has, continuously (rate r → stop r²·b further on)
            r = max(0.05, min(1.0, rate))
            b = max(tm.MIN_B, min(tm.TB, (want - p_now) / (r * r)))
            emergency = want - p_now < tm.MIN_B
            want = p_now + r * r * b
            x0 = b * (2 * r - 1)
            d0 = now + off - (want - x0)
        e["d0"], e["t0"] = d0, now
        e["hold"] = {"id": secrets.token_hex(6), "stopP": want, "b": b, "releaseAt": None, "emergency": emergency, "accident": None}

    def clear(self, email: str, loop: str, vi: int, *, now: float | None = None) -> bool:
        """They stepped out of its way."""
        moment = now if now is not None else time.time()
        e = self._v.get((loop, vi))
        if e is None or email not in e["obstacles"]:
            return False
        del e["obstacles"][email]
        return self._release_if_empty(loop, vi, moment)

    def _release_if_empty(self, loop: str, vi: int, now: float) -> bool:
        e = self._v.get((loop, vi))
        if e is None or e["obstacles"] or e["hold"] is None or e["hold"]["releaseAt"] is not None:
            return False
        if e["hold"].get("accident"):
            return False  # S5 — an accident's car waits for the ACCIDENT to end, whoever steps out of its way
        e["hold"]["releaseAt"] = now + SAFETY_S
        return True

    # ---- S5: accident holds -------------------------------------------------------------------------
    def hold_for_accident(self, loop: str, vi: int, accident_id: str, *, now: float | None = None) -> bool:
        """A CONFIRMED accident stops this car and keeps it stopped until the accident itself is over
        (`release_accident`) — no obstacle report clearing, going stale or disconnecting lets it go. A car already
        held simply keeps its hold; a car still moving stops as soon as it can (an emergency stop)."""
        moment = now if now is not None else time.time()
        if loop not in tm.LOOP_INDEX or not 0 <= vi < len(tm.PATHS[tm.LOOP_INDEX[loop]].offsets):
            return False
        self._fold(loop, vi, moment)
        e = self._entry(loop, vi)
        if e["hold"] is None or e["hold"]["releaseAt"] is not None:
            path = tm.PATHS[tm.LOOP_INDEX[loop]]
            half = tm.VEHICLE_LENGTH.get(path.loop["kinds"][vi], 120) / 2
            # an obstacle AT its own front bumper: the soonest it can stop
            self._create_hold(loop, vi, self.car_arc(loop, vi, moment) + half + STANDOFF, moment)
        e["hold"]["accident"] = accident_id
        e["hold"]["releaseAt"] = None
        return True

    def release_accident(self, loop: str, vi: int, accident_id: str, *, now: float | None = None) -> bool:
        """The accident is over: its car goes back to the ordinary rule — it waits for anybody still in its way."""
        moment = now if now is not None else time.time()
        e = self._v.get((loop, vi))
        if e is None or e["hold"] is None or e["hold"].get("accident") != accident_id:
            return False
        e["hold"]["accident"] = None
        self._release_if_empty(loop, vi, moment)
        return True

    def sweep(self, now: float | None = None) -> bool:
        """Obstacles nobody has confirmed for STALE_S are gone; their cars go again. Returns whether anything changed."""
        moment = now if now is not None else time.time()
        changed = False
        for (loop, vi), e in list(self._v.items()):
            for email, o in list(e["obstacles"].items()):
                if moment - o["seen"] > STALE_S:
                    del e["obstacles"][email]
            changed = self._release_if_empty(loop, vi, moment) or changed
        return changed

    def orphan_sid(self, sid: str, *, now: float | None = None) -> bool:
        """A socket went away: nobody it reported is in anybody's way any more."""
        moment = now if now is not None else time.time()
        changed = False
        for (loop, vi), e in list(self._v.items()):
            for email, o in list(e["obstacles"].items()):
                if o["sid"] == sid:
                    del e["obstacles"][email]
            changed = self._release_if_empty(loop, vi, moment) or changed
        return changed


def valid_obstacle(raw) -> dict | None:
    """{loop, vehicle, x, z, kind, clear} off the wire, or None"""
    if not isinstance(raw, dict):
        return None
    loop, vi, kind = raw.get("loop"), raw.get("vehicle"), raw.get("kind")
    if loop not in tm.LOOP_INDEX or not isinstance(vi, int) or isinstance(vi, bool) or kind not in ("walk", "ride"):
        return None
    out = {"loop": loop, "vehicle": vi, "kind": kind, "clear": raw.get("clear") is True}
    for k in ("x", "z"):
        v = raw.get(k)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > 1e5:
            return None
        out[k] = float(v)
    return out
