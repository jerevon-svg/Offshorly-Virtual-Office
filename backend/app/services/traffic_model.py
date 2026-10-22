"""THE CAMPUS TRAFFIC, as the server needs to know it (S4).

The 14 cars are drawn by every browser from a deterministic loop and the server's clock
(frontend world/traffic.ts + world/trafficHolds.ts). The server never simulates them frame by frame; it needs
the same model only to JUDGE an obstacle report — is that car really there, is that body really ahead of it — and
to work out where a car must stop. So this module is a line-for-line mirror of those two files: the same loop
numbers, the same sampled path, the same pose and the same hold formulas. Parity tests on both sides pin them
together (backend tests/test_traffic_model.py, frontend trafficHolds.test.ts reading this file).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# THE TWO LOOPS, resolved (frontend world/traffic.ts TRAFFIC_LOOPS — lane centres from the campus roads)
LOOPS: tuple[dict, ...] = (
    {"id": "A", "dir": 1, "r": 70, "xw": -894, "xe": 2234, "zn": -2046, "zs": 1566, "cruise": 160, "corner": 66, "accel": 70,
     "gaps": (1.0, 1.7, 0.9, 1.4, 2.1, 0.8, 1.3), "kinds": ("sport", "jeepney", "sport", "supercar", "tricycle", "sport", "pickup")},
    {"id": "B", "dir": -1, "r": 178, "xw": -1002, "xe": 2342, "zn": -2154, "zs": 1674, "cruise": 172, "corner": 104, "accel": 70,
     "gaps": (1.2, 0.8, 1.9, 1.1, 1.5, 0.9, 1.6), "kinds": ("sport", "supercarWing", "etrike", "sport", "jeepney", "sport", "sportbike")},
)
STEP = 4

# frontend world/trafficHolds.ts HOLD and VEHICLE_LENGTH
TB = 1.1
MIN_B = 0.15
TA = 1.4
RHO = 0.08
VEHICLE_LENGTH = {"sport": 118, "supercar": 117, "supercarWing": 117, "jeepney": 194, "tricycle": 59, "etrike": 77, "pickup": 133, "sportbike": 57}
VEHICLE_WIDTH = {"sport": 56, "supercar": 59, "supercarWing": 59, "jeepney": 62, "tricycle": 50, "etrike": 55, "pickup": 64, "sportbike": 16}


def _wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


@dataclass
class LoopPath:
    loop: dict
    x: list[float]
    z: list[float]
    heading: list[float]
    speed: list[float]
    t: list[float]
    s: list[float]
    period: float
    length: float
    offsets: list[float]


def build_loop_path(loop: dict) -> LoopPath:
    """frontend world/traffic.ts buildLoopPath, statement for statement"""
    xw, xe, zn, zs, r = loop["xw"], loop["xe"], loop["zn"], loop["zs"], loop["r"]
    px: list[float] = []
    pz: list[float] = []

    def line(x0: float, z0: float, x1: float, z1: float) -> None:
        n = max(1, round_half_up(math.hypot(x1 - x0, z1 - z0) / STEP))
        for i in range(n):
            px.append(x0 + ((x1 - x0) * i) / n)
            pz.append(z0 + ((z1 - z0) * i) / n)

    def arc(cx: float, cz: float, a0: float, a1: float) -> None:
        n = max(2, round_half_up((abs(a1 - a0) * r) / STEP))
        for i in range(n):
            a = a0 + ((a1 - a0) * i) / n
            px.append(cx + r * math.cos(a))
            pz.append(cz + r * math.sin(a))

    line(xe - r, zs, xw + r, zs); arc(xw + r, zs - r, math.pi / 2, math.pi)
    line(xw, zs - r, xw, zn + r); arc(xw + r, zn + r, math.pi, 1.5 * math.pi)
    line(xw + r, zn, xe - r, zn); arc(xe - r, zn + r, 1.5 * math.pi, 2 * math.pi)
    line(xe, zn + r, xe, zs - r); arc(xe - r, zs - r, 0, math.pi / 2)
    if loop["dir"] == -1:
        px.reverse()
        pz.reverse()
    n = len(px)
    heading = [0.0] * n
    ds = [0.0] * n
    length = 0.0
    for i in range(n):
        j = (i + 1) % n
        heading[i] = math.atan2(pz[j] - pz[i], px[j] - px[i])
        ds[i] = math.hypot(px[j] - px[i], pz[j] - pz[i])
        length += ds[i]
    speed = [0.0] * n
    for i in range(n):
        turn = abs(_wrap(heading[(i + 1) % n] - heading[i]))
        speed[i] = loop["corner"] if turn > 1e-4 else loop["cruise"]
    for _ in range(2):
        for i in range(n):
            p = (i - 1 + n) % n
            speed[i] = min(speed[i], math.sqrt(speed[p] ** 2 + 2 * loop["accel"] * ds[p]))
        for i in range(n - 1, -1, -1):
            q = (i + 1) % n
            speed[i] = min(speed[i], math.sqrt(speed[q] ** 2 + 2 * loop["accel"] * ds[i]))
    t = [0.0] * (n + 1)
    for i in range(n):
        t[i + 1] = t[i] + ds[i] / (0.5 * (speed[i] + speed[(i + 1) % n]))
    period = t[n]
    s = [0.0] * (n + 1)
    for i in range(n):
        s[i + 1] = s[i] + ds[i]
    total = sum(loop["gaps"])
    acc = 0.0
    offsets = []
    for g in loop["gaps"]:
        offsets.append((acc / total) * period)
        acc += g
    return LoopPath(loop, px, pz, heading, speed, t, s, period, length, offsets)


def round_half_up(v: float) -> int:
    """JavaScript's Math.round (halves go up), not Python's banker's rounding"""
    return math.floor(v + 0.5)


PATHS: tuple[LoopPath, ...] = tuple(build_loop_path(loop) for loop in LOOPS)
LOOP_INDEX = {p.loop["id"]: i for i, p in enumerate(PATHS)}


def _search(arr: list[float], v: float) -> int:
    lo, hi = 0, len(arr) - 2
    while lo < hi:
        mid = (lo + hi + 1) >> 1
        if arr[mid] <= v:
            lo = mid
        else:
            hi = mid - 1
    return lo


def arc_at_path_time(path: LoopPath, p: float) -> float:
    tau = p % path.period
    lo = _search(path.t, tau)
    f = (tau - path.t[lo]) / max(1e-9, path.t[lo + 1] - path.t[lo])
    return path.s[lo] + (path.s[lo + 1] - path.s[lo]) * f


def path_time_at_arc(path: LoopPath, s: float) -> float:
    a = s % path.length
    lo = _search(path.s, a)
    f = (a - path.s[lo]) / max(1e-9, path.s[lo + 1] - path.s[lo])
    return path.t[lo] + (path.t[lo + 1] - path.t[lo]) * f


def point_at_arc(path: LoopPath, s: float) -> tuple[float, float, float, float]:
    """(x, z, heading, nominal speed) at distance s along the loop"""
    a = s % path.length
    lo = _search(path.s, a)
    n = len(path.x)
    j = (lo + 1) % n
    f = (a - path.s[lo]) / max(1e-9, path.s[lo + 1] - path.s[lo])
    x = path.x[lo] + (path.x[j] - path.x[lo]) * f
    z = path.z[lo] + (path.z[j] - path.z[lo]) * f
    h = path.heading[lo] + _wrap(path.heading[j] - path.heading[lo]) * f
    sp = path.speed[lo] + (path.speed[j] - path.speed[lo]) * f
    return x, z, h, sp


# ---- the hold formulas (frontend world/trafficHolds.ts) -----------------------------------------------------

def soft(x: float, b: float) -> float:
    if x >= b:
        return x
    if x <= -b:
        return 0.0
    return ((x + b) * (x + b)) / (4 * b)


def soft_rate(x: float, b: float) -> float:
    if x >= b:
        return 1.0
    if x <= -b:
        return 0.0
    return (x + b) / (2 * b)


def catch_up_delay(v: dict, t: float) -> float:
    return max(0.0, v["d0"] - RHO * max(0.0, t - v["t0"]))


def hold_done_at(off: float, v: dict) -> float | None:
    h = v.get("hold")
    if not h or h.get("releaseAt") is None:
        return None
    r0 = soft_rate(h["stopP"] - (h["releaseAt"] + off - v["d0"]), h["b"])
    return h["releaseAt"] + 2 * TA * (1 - r0)


def vehicle_path_time(off: float, v: dict | None, t: float) -> float:
    if not v:
        return t + off
    h = v.get("hold")
    if not h:
        return t + off - catch_up_delay(v, t)

    def free(at: float) -> float:
        return at + off - v["d0"]

    if h.get("releaseAt") is None or t < h["releaseAt"]:
        return h["stopP"] - soft(h["stopP"] - free(t), h["b"])
    xr = h["stopP"] - free(h["releaseAt"])
    pr = h["stopP"] - soft(xr, h["b"])
    r0 = soft_rate(xr, h["b"])
    u = t - h["releaseAt"]
    u1 = 2 * TA * (1 - r0)
    if u < u1:
        return pr + r0 * u + (u * u) / (4 * TA)
    return pr + r0 * u1 + (u1 * u1) / (4 * TA) + (u - u1)


def fold(off: float, v: dict, t: float) -> dict:
    done = hold_done_at(off, v)
    if done is None or t < done:
        return v
    p = vehicle_path_time(off, v, done)
    return {"d0": done + off - p, "t0": done, "hold": None}


def car_state(loop: str, vi: int, v: dict | None, t: float) -> tuple[float, float, float, float]:
    """(x, z, heading, actual speed) of car (loop, vi) at server second t, by its own schedule (holds included)"""
    path = PATHS[LOOP_INDEX[loop]]
    off = path.offsets[vi]
    p = vehicle_path_time(off, v, t)
    eps = 1 / 30
    rate = (vehicle_path_time(off, v, t + eps) - p) / eps
    x, z, h, sp = point_at_arc(path, arc_at_path_time(path, p))
    return x, z, h, sp * max(0.0, rate)
