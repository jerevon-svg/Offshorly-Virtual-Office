"""S4 — the server's copy of the campus traffic (app/services/traffic_model.py) is the browsers' copy: the same
loops to the last digit, and the same hold formulas."""
from __future__ import annotations

import itertools
import math

from app.services import traffic_model as tm

# frontend world/traffic.ts, measured (buildLoopPath + poseAt)
REF = {
    "A": {"period": 90.5662752076144, "length": 13359.760947395822, "offsets": [0, 9.844160349, 26.579232941],
          "samples": [(0, 0, 2164, 1566), (0, 17.3, -546.3799558919826, 1566), (0, 123.45, -894, -327.12491436929935)]},
    "B": {"period": 87.40648814987767, "length": 14038.383519191135, "offsets": [0, 11.65419842, 19.423664033],
          "samples": [(0, 0, 2167.993975444653, 1673.9551858197663), (0, 17.3, 2342, -993.3755539008308), (0, 123.45, 451.2193983229078, -2154)]},
}


def test_the_loops_are_the_browsers_loops_to_the_last_digit() -> None:
    for path in tm.PATHS:
        ref = REF[path.loop["id"]]
        assert math.isclose(path.period, ref["period"], rel_tol=0, abs_tol=1e-9)
        assert math.isclose(path.length, ref["length"], rel_tol=0, abs_tol=1e-9)
        for got, want in zip(path.offsets, ref["offsets"]):
            assert abs(got - want) < 1e-8
        for vi, t, x, z in ref["samples"]:
            px, pz, _, _ = tm.point_at_arc(path, tm.arc_at_path_time(path, t + path.offsets[vi]))
            assert abs(px - x) < 1e-6 and abs(pz - z) < 1e-6


def test_arc_and_path_time_are_inverse() -> None:
    path = tm.PATHS[0]
    for p in (0.0, 3.3, 45.0, 90.0):
        assert abs(tm.path_time_at_arc(path, tm.arc_at_path_time(path, p)) - p) < 1e-6


HOLD = {"d0": 0.0, "t0": 0.0, "hold": {"id": "h", "stopP": 50.0, "b": 1.1, "releaseAt": 60.0, "emergency": False}}


def test_a_hold_brakes_onto_its_stop_waits_and_restarts_smoothly() -> None:
    p = lambda t: tm.vehicle_path_time(0.0, HOLD, t)
    assert p(40) == 40 and p(48.9) == 48.9  # untouched until braking starts (TB before the stop)
    assert abs(p(50) - 49.725) < 1e-12
    assert p(51.1) == 50 and p(55) == 50 and p(60) == 50  # stopped exactly on its stop
    assert abs(p(61) - 50.17857142857143) < 1e-12
    assert abs(p(62.8) - 51.4) < 1e-12 and abs(p(70) - 58.6) < 1e-12
    # the rate is continuous everywhere — no jump into the brake, the stop, or the restart
    rates = [(p(t + 1e-4) - p(t)) / 1e-4 for t in [40 + 0.05 * i for i in range(700)]]
    assert max(abs(a - b) for a, b in itertools.pairwise(rates)) < 0.03
    assert min(rates) >= -1e-9 and max(rates) <= 1 + 1e-6


def test_a_finished_hold_folds_into_a_plain_delay_exactly_and_is_made_up() -> None:
    assert tm.hold_done_at(0.0, HOLD) == 62.8
    f = tm.fold(0.0, HOLD, 100)
    assert f["hold"] is None and abs(f["d0"] - 11.4) < 1e-9 and f["t0"] == 62.8
    for t in (62.8, 63, 80):
        assert abs(tm.vehicle_path_time(0.0, f, t) - tm.vehicle_path_time(0.0, HOLD, t)) < 0.08 * (t - 62.8) + 1e-9
    assert tm.catch_up_delay(f, 62.8 + 11.4 / tm.RHO + 1) == 0
