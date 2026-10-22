"""S5 — SCOOTER ACCIDENTS (app/services/scooter_accidents.py): a real crash is confirmed once; braking, bumps,
spoofs, stale or duplicate reports are not. Plus the accident hold on the car (app/services/traffic_holds.py)."""
from __future__ import annotations

import math

from app.services import traffic_model as tm
from app.services.scooter_accidents import (
    ABANDON_S,
    COOLDOWN_S,
    LIFT_UPRIGHT_S,
    RECOVER_RANGE,
    AccidentRegistry,
    accident_plan,
    contact,
    is_accident,
    valid_accident,
)
from app.services.scooter_accidents import phase as accident_phase
from app.services.traffic_holds import SAFETY_S, TrafficHoldRegistry

A = "rider@x"
NOW = 1_800_000_000.0


def head_on(loop: str = "A", vi: int = 2, speed: float = 200.0, t: float = NOW, gap: float = 10.0) -> dict:
    """a report of a scooter riding straight into car (loop, vi)'s front bumper at `speed`"""
    cx, cz, ch, _ = tm.car_state(loop, vi, None, t)
    kind = tm.PATHS[tm.LOOP_INDEX[loop]].loop["kinds"][vi]
    f = tm.VEHICLE_LENGTH[kind] / 2 + gap
    x, z = cx + math.cos(ch) * f, cz + math.sin(ch) * f
    heading = math.atan2(-math.cos(ch), math.sin(ch))  # ride convention: moving along (sin h, -cos h) = toward the car
    return {"scooterId": "scooter-r1", "loop": loop, "vehicle": vi, "x": x, "z": z, "heading": heading, "speed": speed, "t": t, "closing": 0.0}


def scooter(r: dict, sid: str = "sa", pose_speed: float | None = None) -> dict:
    return {"id": r["scooterId"], "state": "ridden", "rider": A, "rider_sid": sid, "lost_at": None,
            "pose": {"x": r["x"], "z": r["z"], "speed": r["speed"] if pose_speed is None else pose_speed}, "pose_at": NOW}


def test_the_contact_maths() -> None:
    # head-on into a car doing 160 at 200: closing 360, touching
    sd, closing, nx, nz = contact(0, 0, math.atan2(-1, 0), 200, -70, 0, 0.0, 160, 118, 56)
    assert sd < 15 and math.isclose(closing, 360, abs_tol=1e-9)
    # beside it, going the same way: not closing at all
    assert (nx, nz) == (1.0, 0.0)  # the normal points from the car to the scooter
    sd2, closing2, _, _ = contact(0, 40, math.pi / 2, 160, 0, 0, 0.0, 160, 118, 56)
    assert sd2 > 0 and abs(closing2) < 1e-9
    assert is_accident(150, 160) and not is_accident(60, 160)
    assert not is_accident(150, 0) and is_accident(250, 0)  # a car that STOPPED is only "crashed into" hard


def test_a_real_crash_is_confirmed_once() -> None:
    reg = AccidentRegistry()
    r = head_on()
    a, why = reg.create(A, "sa", r, scooter(r), None, now=NOW)
    assert why is None and a["rider"] == A and a["closing"] > 300 and a["loop"] == "A" and a["vehicle"] == 2
    # the same rider, the same scooter, the same car: once
    assert reg.create(A, "sa", r, scooter(r), None, now=NOW + 0.1) == (None, "duplicate")
    assert reg.create("other@x", "sb", {**r, "scooterId": "scooter-r2"}, {**scooter(r, "sb"), "rider": "other@x", "id": "scooter-r2"}, None, now=NOW + 0.1) == (None, "duplicate")
    assert set(reg.wire(a)) == {"id", "rider", "scooterId", "loop", "vehicle", "at", "x", "z", "heading", "speed", "closing", "carHeading", "carSpeed", "endsAt", "nx", "nz", "restX", "restZ", "reach", "crashEnd", "liftAt", "liftFrom", "phase"}
    # S6 — it comes to rest a little way on, AWAY from the car (the normal), never back under it
    assert (a["restX"] - a["x"]) * a["nx"] + (a["restZ"] - a["z"]) * a["nz"] > 0


def test_nothing_without_a_real_crash() -> None:
    reg = AccidentRegistry()
    r = head_on()
    assert reg.create(A, "other-tab", r, scooter(r), None, now=NOW)[1] == "not_rider"
    assert reg.create(A, "sa", r, {**scooter(r), "rider": "b@x"}, None, now=NOW)[1] == "not_rider"
    assert reg.create(A, "sa", r, None, None, now=NOW)[1] == "not_rider"
    assert reg.create(A, "sa", {**r, "t": NOW - 5}, scooter({**r, "t": NOW - 5}), None, now=NOW)[1] == "stale"
    far = {**r, "x": r["x"] + 500}
    assert reg.create(A, "sa", far, scooter(r), None, now=NOW)[1] == "position"  # not where their pose says
    assert reg.create(A, "sa", far, scooter(far), None, now=NOW)[1] == "no_contact"  # nowhere near the car
    assert reg.create(A, "sa", r, scooter(r, pose_speed=10), None, now=NOW)[1] == "speed"  # claims far more speed than it had
    # brushing it at walking pace is a bump, not an accident
    slow = head_on(speed=0)
    slow_car_parked = {"d0": 0.0, "t0": NOW - 30, "hold": {"id": "h", "stopP": tm.PATHS[0].offsets[2] + NOW - 20, "b": 1.1, "releaseAt": None, "emergency": False}}
    assert reg.create(A, "sa", slow, scooter(slow), slow_car_parked, now=NOW)[1] in ("not_an_accident", "no_contact")


def test_a_car_that_braked_to_a_stop_is_not_crashed_into_at_cruise_but_is_at_a_real_smash() -> None:
    off = tm.PATHS[0].offsets[2]
    stopped = {"d0": 0.0, "t0": NOW - 30, "hold": {"id": "h", "stopP": NOW - 20 + off, "b": 1.1, "releaseAt": None, "emergency": False}}
    cx, cz, ch, cs = tm.car_state("A", 2, stopped, NOW)
    assert cs < 1e-6
    f = tm.VEHICLE_LENGTH["sport"] / 2 + 8
    base = {"scooterId": "scooter-r1", "loop": "A", "vehicle": 2, "x": cx + math.cos(ch) * f, "z": cz + math.sin(ch) * f,
            "heading": math.atan2(-math.cos(ch), math.sin(ch)), "t": NOW, "closing": 0.0}
    assert AccidentRegistry().create(A, "sa", {**base, "speed": 140}, scooter({**base, "speed": 140}), stopped, now=NOW)[1] == "not_an_accident"
    a, why = AccidentRegistry().create(A, "sa", {**base, "speed": 300}, scooter({**base, "speed": 300}), stopped, now=NOW)
    assert why is None and a is not None


def test_the_rider_gets_a_moment_before_another_counts_and_leaving_ends_theirs() -> None:
    reg = AccidentRegistry()
    r = head_on()
    a, _ = reg.create(A, "sa", r, scooter(r), None, now=NOW)
    assert reg.orphan_sid("sa") == [a["id"]]
    reg.resolve(a["id"], now=NOW + 3)
    r2 = head_on(vi=5, t=NOW + 3.5)
    assert reg.create(A, "sa", r2, {**scooter(r2), "pose_at": NOW + 3.5}, None, now=NOW + 3.5)[1] == "cooldown"
    r3 = head_on(vi=5, t=NOW + 3 + COOLDOWN_S + 0.1)
    assert reg.create(A, "sa", r3, {**scooter(r3), "pose_at": r3["t"]}, None, now=r3["t"])[1] is None


def test_valid_accident() -> None:
    r = head_on()
    assert valid_accident(r)["vehicle"] == 2
    for bad in (None, {**r, "loop": "Z"}, {**r, "vehicle": 99}, {**r, "speed": float("nan")}, {**r, "scooterId": ""}, {**r, "vehicle": True}):
        assert valid_accident(bad) is None


def test_an_accident_hold_keeps_the_car_stopped_whatever_the_obstacles_do_until_the_accident_ends() -> None:
    tr = TrafficHoldRegistry()
    assert tr.hold_for_accident("A", 2, "acc1", now=NOW) is True
    h = tr.car_state("A", 2)["hold"]
    assert h["accident"] == "acc1" and h["releaseAt"] is None
    # a rider's obstacle report on it, then cleared / gone stale / disconnected: still held
    path = tm.PATHS[0]
    x, z, _, _ = tm.point_at_arc(path, tr.car_arc("A", 2, NOW + 1) + 59 + 40)
    tr.report(A, "sa", "A", 2, x, z, "walk", now=NOW + 1)
    tr.clear(A, "A", 2, now=NOW + 2)
    tr.sweep(NOW + 10)
    tr.orphan_sid("sa", now=NOW + 11)
    assert tr.car_state("A", 2)["hold"]["releaseAt"] is None
    assert tr.snapshot(NOW + 11)[0]["hold"]["accident"] == "acc1"
    # the accident ends: back to the ordinary rule — nobody in the way, so it goes after the safety margin
    assert tr.release_accident("A", 2, "acc1", now=NOW + 12) is True
    assert tr.car_state("A", 2)["hold"]["releaseAt"] == NOW + 12 + SAFETY_S
    # …and an accident that is not this hold's cannot release it
    tr.hold_for_accident("B", 1, "acc2", now=NOW)
    assert tr.release_accident("B", 1, "someone-else", now=NOW + 1) is False


def test_when_the_accident_ends_with_somebody_still_in_the_road_the_car_keeps_waiting() -> None:
    tr = TrafficHoldRegistry()
    tr.hold_for_accident("A", 4, "acc", now=NOW)
    path = tm.PATHS[0]
    x, z, _, _ = tm.point_at_arc(path, tr.car_arc("A", 4, NOW + 1) + tm.VEHICLE_LENGTH["tricycle"] / 2 + 40)
    tr.report(A, "sa", "A", 4, x, z, "walk", now=NOW + 1)
    tr.release_accident("A", 4, "acc", now=NOW + 2)
    assert tr.car_state("A", 4)["hold"]["releaseAt"] is None


def test_the_scooter_rests_where_the_browsers_animate_it_to() -> None:
    # frontend accidentMotion.test.ts pins the same crashes: these exact numbers
    p = accident_plan(100.0, 50.0, 0.3, 240.0, 330.0, 1.2, 150.0, 0.6, 0.8)
    assert abs(p["severity"] - 0.8732717601679716) < 1e-12
    assert abs(p["dx"] - 0.927554621259907) < 1e-12 and abs(p["dz"] - 0.3736876029244085) < 1e-12
    assert abs(p["restX"] - 257.42321773356196) < 1e-9 and abs(p["restZ"] - 113.42171504638353) < 1e-9
    assert abs(p["end"] - 3.5343957352279793) < 1e-9
    side = accident_plan(0.0, 0.0, 0.0, 120.0, 200.0, 0.0, 200.0, 1.0, 0.0)
    assert abs(side["restX"] - 113.31596234136984) < 1e-9 and abs(side["restZ"] + 18.964912971056453) < 1e-9
    r = accident_plan(100.0, 50.0, 0.3, 240.0, 330.0, 1.2, 150.0, 0.6, 0.8, {"rider": {"k": 0.5, "turn": 0.3}, "scooter": {"k": 0.4, "turn": -0.3}})
    assert abs(r["restX"] - 167.65381698950432) < 1e-9 and abs(r["restZ"] - 55.62693469952855) < 1e-9


def test_harder_hits_go_farther_and_the_cleanup_waits_for_the_crash() -> None:
    light = accident_plan(0, 0, math.pi / 2, 10, 115, 0, 125, 1, 0)
    heavy = accident_plan(100, 50, 0.3, 240, 330, 1.2, 150, 0.6, 0.8)
    assert math.hypot(heavy["restX"] - 100, heavy["restZ"] - 50) > 2 * math.hypot(light["restX"], light["restZ"])
    reg = AccidentRegistry()
    r = head_on(speed=300)
    a, _ = reg.create(A, "sa", r, scooter(r), None, now=NOW)
    plan = accident_plan(a["x"], a["z"], a["heading"], a["speed"], a["closing"], a["carHeading"], a["carSpeed"], a["nx"], a["nz"])
    # S7 — nothing can be done until the crash has played; then the rider has a generous ABANDON_S to act
    assert a["crashEnd"] == plan["end"]
    assert a["endsAt"] == a["at"] + plan["end"] + ABANDON_S


def test_the_riders_reach_only_ever_shortens_and_is_recorded_once() -> None:
    reg = AccidentRegistry()
    r = head_on()
    a, _ = reg.create(A, "sa", r, scooter(r), None, now=NOW)
    full = (a["restX"], a["restZ"])
    ok = {"rider": {"k": 0.6, "turn": 0.0}, "scooter": {"k": 0.5, "turn": 0.0}}
    # somebody else, another tab, nonsense, a longer throw, an unlisted turn: refused
    assert reg.set_reach(a["id"], "other@x", "sa", ok) == (None, "not_rider")
    assert reg.set_reach(a["id"], A, "other-tab", ok) == (None, "not_rider")
    for bad in (None, {"rider": ok["rider"]}, {**ok, "scooter": {"k": 1.5, "turn": 0.0}}, {**ok, "scooter": {"k": 0.5, "turn": 0.123}}, {**ok, "rider": {"k": True, "turn": 0.0}}):
        assert reg.set_reach(a["id"], A, "sa", bad) == (None, "invalid")
    got, why = reg.set_reach(a["id"], A, "sa", ok)
    assert why is None and got["reach"] == ok
    # half the slide: the scooter rests half as far along its own line
    assert math.isclose(got["restX"] - a["x"], (full[0] - a["x"]) * 0.5, abs_tol=1e-9)
    assert reg.set_reach(a["id"], A, "sa", ok) == (None, "duplicate")
    assert reg.set_reach("nope", A, "sa", ok) == (None, "unknown")


def test_recovery_is_crashing_fallen_lifting_upright_and_only_its_rider_beside_it_moves_it_on() -> None:
    reg = AccidentRegistry()
    r = head_on()
    a, _ = reg.create(A, "sa", r, scooter(r), None, now=NOW)
    sx, sz = a["restX"], a["restZ"]
    up = a["at"] + a["crashEnd"]
    assert accident_phase(a, up - 0.1) == "crashing" and accident_phase(a, up) == "fallen"
    # still crashing: not yet (the S6 get-up has to finish first)
    assert reg.lift(a["id"], A, "sa", sx + 10, sz, now=up - 0.5) == (None, "too_soon")
    # nobody else, no other tab, not from across the road
    assert reg.lift(a["id"], "thief@x", "sb", sx + 10, sz, now=up + 1)[1] == "not_rider"
    assert reg.lift(a["id"], A, "other-tab", sx + 10, sz, now=up + 1)[1] == "not_rider"
    assert reg.lift(a["id"], A, "sa", sx + RECOVER_RANGE + 1, sz, now=up + 1)[1] == "too_far"
    # and no riding it while it lies there
    assert reg.remountable("scooter-r1", A, "sa", sx, sz, now=up + 1) == (None, "not_upright")
    got, why = reg.lift(a["id"], A, "sa", sx + 10, sz, now=up + 1)
    assert why is None and got["liftAt"] == up + 1 and got["liftFrom"] == {"x": sx + 10, "z": sz}
    assert got["endsAt"] > up + 1 + ABANDON_S  # recovering pushes the deadline on
    # E again (or a second tab's E): the same lift, never a second one
    assert reg.lift(a["id"], A, "sa", sx + 10, sz, now=up + 1.1) == (None, "duplicate")
    assert accident_phase(got, up + 1 + LIFT_UPRIGHT_S - 0.01) == "lifting"
    assert reg.remountable("scooter-r1", A, "sa", sx, sz, now=up + 1.2) == (None, "not_upright")
    assert accident_phase(got, up + 1 + LIFT_UPRIGHT_S) == "upright"
    assert reg.remountable("scooter-r1", "thief@x", "sb", sx, sz, now=up + 3)[1] == "not_rider"
    assert reg.remountable("scooter-r1", A, "sa", sx, sz, now=up + 3) == (got, None)
    assert reg.wire(got)["phase"] in ("crashing", "fallen", "lifting", "upright")


def test_an_accident_nobody_moves_on_is_due_for_cleanup_but_never_one_being_recovered() -> None:
    reg = AccidentRegistry()
    r = head_on()
    a, _ = reg.create(A, "sa", r, scooter(r), None, now=NOW)
    deadline = a["endsAt"]
    assert reg.due(deadline - 1) == [] and reg.due(deadline) == [a["id"]]
    reg.lift(a["id"], A, "sa", a["restX"], a["restZ"], now=deadline - 1)
    assert reg.due(deadline + 5) == []


def test_the_scooter_is_ridden_again_from_where_it_was_lifted() -> None:
    from app.services.scooter_registry import ScooterRegistry
    sr = ScooterRegistry()
    sr.claim("scooter-r1", A, "sa", now=NOW)
    sr.fall("scooter-r1", A, {"x": 10, "z": 20, "yaw": 0}, "acc", now=NOW)
    assert sr.remount("scooter-r1", "acc", "thief@x", "sb", now=NOW + 1) is None
    assert sr.remount("scooter-r1", "other-acc", A, "sa", now=NOW + 1) is None
    s = sr.remount("scooter-r1", "acc", A, "sa2", now=NOW + 1)
    assert s["state"] == "ridden" and s["rider"] == A and s["rider_sid"] == "sa2" and s["accident"] is None and s["at"] is None
