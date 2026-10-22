"""THE WORKING-OFFICE BOUNDARY, server side (PARKOUR V3).

The 3D office has always enforced "no confirmed check-in, no entry to the working office" on the MOVING client
(frontend dev/vo3d/app/access.ts zoneAt, the gate-lane reservations, and PARKOUR V2's traversal `mayEnter`). A
modified client could ignore all of that and publish a walk straight past Reception. This module lets the server
refuse the one thing that matters: a walk that CROSSES from outside the working office into it, published by
somebody who is not checked in.

WHAT IT IS AND IS NOT. The server has no world geometry: it cannot say a path goes through a wall. It knows the V1
frame's own facts — the frame, the façade plane, Reception's rect and its gate line — which is exactly what the
client's `zoneAt` uses, mirrored here (a frontend test pins these numbers to the client's). Walk points arrive as a
sprite's TOP-LEFT in V1 frame units and the server does not know that person's sprite box, so every test here is
CONSERVATIVE in the direction that never refuses a legitimate walk: a point is "certainly office" only if every
centre its box could put it at is office, and an origin is "certainly outside" only if every such centre is
outside. Anything in between is let through. The margin that leaves (a sprite box, ~60 units at most, around the
gate line) is a trust boundary this module states rather than hides.
"""

from __future__ import annotations

# V1 frame facts (frontend: data/office-layout FRAME_WIDTH/HEIGHT, dev/vo3d/adapters/v1Floor FACADE_Z,
# rooms/reception RECT (V1's own reception-room rect) and GATE.z)
FRAME_W = 1440.0
FRAME_H = 1244.0
FACADE_Z = 1120.0
RECEPTION = {"x": 332.33, "z": 838.47, "w": 748.955, "d": 399.102}
GATE_Z = 890.0

# the largest sprite box a top-left point may stand for (every V1 character's box is well inside it)
BOX_W = 48.0
BOX_H = 64.0


def _centre_range(p: dict) -> tuple[float, float, float, float]:
    x, y = float(p["x"]), float(p["y"])
    return x, x + BOX_W, y, y + BOX_H


def _in_reception_columns(x0: float, x1: float) -> tuple[bool, bool]:
    """(every possible centre is within Reception's columns, every possible centre is outside them)"""
    rx0, rx1 = RECEPTION["x"], RECEPTION["x"] + RECEPTION["w"]
    return x0 >= rx0 and x1 <= rx1, x1 < rx0 or x0 > rx1


def certainly_office(p: dict) -> bool:
    """Is every centre this top-left point could stand for inside the working office?"""
    x0, x1, z0, z1 = _centre_range(p)
    if x0 < 0 or x1 > FRAME_W or z0 < 0 or z1 >= FACADE_Z:
        return False
    _inside_cols, outside_cols = _in_reception_columns(x0, x1)
    # north of the gate line everywhere, or in a front-row room beside Reception at any z above the façade
    return z1 < GATE_Z or outside_cols


def certainly_outside(p: dict) -> bool:
    """Is every centre this top-left point could stand for OUTSIDE the working office (the street, Reception's public
    half, or off the frame)?"""
    x0, x1, z0, z1 = _centre_range(p)
    if x1 < 0 or x0 > FRAME_W or z1 < 0 or z0 > FRAME_H:
        return True
    if z0 >= FACADE_Z:
        return True
    inside_cols, _outside_cols = _in_reception_columns(x0, x1)
    return inside_cols and z0 >= GATE_Z


def enters_office(origin: dict, points: list[dict]) -> bool:
    """A walk that starts certainly outside the working office and reaches a point certainly inside it."""
    return certainly_outside(origin) and any(certainly_office(p) for p in points)
