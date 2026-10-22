"""S4 — CAMPUS TRAFFIC HOLDS (app/services/traffic_holds.py): one hold per car, only for a body really in its lane
ahead of it, released only when nobody is left in the way (clear, stale, gone) — never over a live obstacle."""
from __future__ import annotations

import math

from app.services import traffic_model as tm
from app.services.traffic_holds import (
    SAFETY_S,
    STALE_S,
    TrafficHoldRegistry,
    valid_obstacle,
)

A, B = "a@x", "b@x"
NOW = 1_800_000_000.0


def ahead(r: TrafficHoldRegistry, loop: str, vi: int, along: float, now: float = NOW, lateral: float = 0.0) -> tuple[float, float]:
    """a point in car (loop, vi)'s lane, `along` ahead of its front bumper (and `lateral` off its centre line)"""
    path = tm.PATHS[tm.LOOP_INDEX[loop]]
    half = tm.VEHICLE_LENGTH[path.loop["kinds"][vi]] / 2
    x, z, h, _ = tm.point_at_arc(path, r.car_arc(loop, vi, now) + half + along)
    return x - math.sin(h) * lateral, z + math.cos(h) * lateral


def test_a_body_ahead_in_the_lane_holds_the_car_and_it_stops_short_of_them() -> None:
    r = TrafficHoldRegistry()
    x, z = ahead(r, "A", 2, 300)
    assert r.report(A, "sa", "A", 2, x, z, "walk", now=NOW) == (True, None)
    h = r.car_state("A", 2)["hold"]
    assert h["releaseAt"] is None and not h["emergency"]
    # it comes to rest in front of them, never on them
    path = tm.PATHS[0]
    rest = tm.arc_at_path_time(path, h["stopP"]) + tm.VEHICLE_LENGTH["sport"] / 2
    assert 0 < (r.obstacle_arc("A", 2, x, z, NOW) - rest) % path.length < 60


def test_not_in_its_way_is_refused_behind_it_beside_the_road_unknown_cars() -> None:
    r = TrafficHoldRegistry()
    bx, bz = ahead(r, "A", 2, -300)
    assert r.report(A, "sa", "A", 2, bx, bz, "walk", now=NOW) == (False, "not_ahead")
    sx, sz = ahead(r, "A", 2, 200, lateral=120, now=NOW + 0.3)  # the sidewalk
    assert r.report(A, "sa", "A", 2, sx, sz, "walk", now=NOW + 0.3) == (False, "not_ahead")
    assert r.report(A, "sa", "C", 0, 0, 0, "walk", now=NOW) == (False, "unknown_vehicle")
    assert r.report(A, "sa", "A", 9, 0, 0, "walk", now=NOW) == (False, "unknown_vehicle")
    assert r.snapshot(NOW) == []


def test_one_hold_per_car_however_many_are_in_its_way_and_reports_are_rate_limited() -> None:
    r = TrafficHoldRegistry()
    x, z = ahead(r, "B", 1, 250)
    r.report(A, "sa", "B", 1, x, z, "walk", now=NOW)
    hid = r.car_state("B", 1)["hold"]["id"]
    assert r.report(A, "sa", "B", 1, x, z, "walk", now=NOW + 0.05) == (False, "too_fast")
    assert r.report(B, "sb", "B", 1, x + 5, z, "ride", now=NOW + 0.3) == (False, None)
    assert r.car_state("B", 1)["hold"]["id"] == hid and set(r.car_state("B", 1)["obstacles"]) == {A, B}
    # both must leave before it goes
    assert r.clear(A, "B", 1, now=NOW + 1) is False
    assert r.car_state("B", 1)["hold"]["releaseAt"] is None
    assert r.clear(B, "B", 1, now=NOW + 2) is True
    assert r.car_state("B", 1)["hold"]["releaseAt"] == NOW + 2 + SAFETY_S


def test_several_cars_held_at_once_and_one_person_holds_one_car_per_lane() -> None:
    r = TrafficHoldRegistry()
    r.report(A, "sa", "A", 0, *ahead(r, "A", 0, 300), "walk", now=NOW)
    r.report(B, "sb", "B", 4, *ahead(r, "B", 4, 300), "ride", now=NOW)
    assert {(v["loop"], v["vehicle"]) for v in r.snapshot(NOW) if v["hold"]} == {("A", 0), ("B", 4)}
    # A turns up in front of a different car of the same loop: the first one is no longer waiting on A
    r.report(A, "sa", "A", 5, *ahead(r, "A", 5, 300, now=NOW + 1), "walk", now=NOW + 1)
    assert r.car_state("A", 0)["hold"]["releaseAt"] == NOW + 1 + SAFETY_S
    assert r.car_state("A", 5)["hold"]["releaseAt"] is None


def test_never_released_over_a_live_obstacle_however_long_but_a_stale_or_gone_one_lets_it_go() -> None:
    r = TrafficHoldRegistry()
    x, z = ahead(r, "A", 3, 200)
    r.report(A, "sa", "A", 3, x, z, "walk", now=NOW)
    t = NOW
    for _ in range(200):  # two minutes of keep-alives
        t += 0.6
        r.report(A, "sa", "A", 3, x, z, "walk", now=t)
        assert r.sweep(t) is False
    assert r.car_state("A", 3)["hold"]["releaseAt"] is None
    # a frozen tab: no keep-alive for STALE_S
    assert r.sweep(t + STALE_S + 0.1) is True
    assert r.car_state("A", 3)["hold"]["releaseAt"] is not None
    # and a disconnect releases at once
    r2 = TrafficHoldRegistry()
    r2.report(B, "sb", "B", 0, *ahead(r2, "B", 0, 200), "ride", now=NOW)
    assert r2.orphan_sid("sb", now=NOW + 1) is True
    assert r2.car_state("B", 0)["hold"]["releaseAt"] == NOW + 1 + SAFETY_S


def test_stepping_back_in_during_the_safety_margin_just_keeps_it_waiting() -> None:
    r = TrafficHoldRegistry()
    x, z = ahead(r, "A", 1, 220)
    r.report(A, "sa", "A", 1, x, z, "walk", now=NOW)
    r.clear(A, "A", 1, now=NOW + 3)
    assert r.report(A, "sa", "A", 1, x, z, "walk", now=NOW + 3.2) == (True, None)
    assert r.car_state("A", 1)["hold"]["releaseAt"] is None


def test_too_close_to_brake_for_is_an_EMERGENCY_stop_and_a_car_restarting_brakes_from_its_own_rate() -> None:
    r = TrafficHoldRegistry()
    x, z = ahead(r, "A", 4, 10)  # right at the grille
    r.report(A, "sa", "A", 4, x, z, "walk", now=NOW)
    assert r.car_state("A", 4)["hold"]["emergency"] is True
    # released, restarting — and somebody steps out in front: it brakes again WITHOUT a jump in its rate
    r.clear(A, "A", 4, now=NOW + 5)
    t = NOW + 5 + SAFETY_S + 1.0
    off = tm.PATHS[0].offsets[4]
    before = r.car_state("A", 4)
    snap = {"d0": before["d0"], "t0": before["t0"], "hold": dict(before["hold"])}
    rate_before = (tm.vehicle_path_time(off, snap, t + 1e-3) - tm.vehicle_path_time(off, snap, t)) / 1e-3
    p_before = tm.vehicle_path_time(off, snap, t)
    r.report(B, "sb", "A", 4, *ahead(r, "A", 4, 260, now=t), "ride", now=t)
    after = r.car_state("A", 4)
    rate_after = (tm.vehicle_path_time(off, after, t + 1e-3) - tm.vehicle_path_time(off, after, t)) / 1e-3
    assert 0 < rate_before < 1
    assert abs(tm.vehicle_path_time(off, after, t) - p_before) < 1e-6  # no jump in position
    assert abs(rate_after - rate_before) < 0.01  # nor in speed


def test_back_on_schedule_it_leaves_the_snapshot() -> None:
    r = TrafficHoldRegistry()
    r.report(A, "sa", "A", 6, *ahead(r, "A", 6, 300), "walk", now=NOW)
    r.clear(A, "A", 6, now=NOW + 4)
    assert len(r.snapshot(NOW + 10)) == 1  # making up the lost time
    assert r.snapshot(NOW + 10 + 6 / tm.RHO + 60) == []


def test_valid_obstacle() -> None:
    assert valid_obstacle({"loop": "A", "vehicle": 3, "x": 1, "z": 2, "kind": "ride"}) == {"loop": "A", "vehicle": 3, "x": 1.0, "z": 2.0, "kind": "ride", "clear": False}
    assert valid_obstacle({"loop": "B", "vehicle": 0, "x": 1, "z": 2, "kind": "walk", "clear": True})["clear"] is True
    for bad in (None, {"loop": "Z", "vehicle": 0, "x": 0, "z": 0, "kind": "walk"}, {"loop": "A", "vehicle": True, "x": 0, "z": 0, "kind": "walk"},
                {"loop": "A", "vehicle": 0, "x": float("nan"), "z": 0, "kind": "walk"}, {"loop": "A", "vehicle": 0, "x": 0, "z": 0, "kind": "car"}):
        assert valid_obstacle(bad) is None
