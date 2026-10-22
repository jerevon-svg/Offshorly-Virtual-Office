"""CAMPUS SCOOTERS — the registry's own rules (app/services/scooter_registry.py)."""
from __future__ import annotations

from app.services.scooter_registry import (
    POSE_MIN_INTERVAL_S,
    RECONNECT_GRACE_SECONDS,
    SCOOTER_IDS,
    ScooterRegistry,
    valid_at,
    valid_pose,
)

A, B = "a@example.com", "b@example.com"


def test_six_scooters_all_docked_with_stable_ids() -> None:
    r = ScooterRegistry()
    snap = r.snapshot()
    assert [s["id"] for s in snap] == list(SCOOTER_IDS)
    assert SCOOTER_IDS == ("scooter-r1", "scooter-r2", "scooter-r3", "scooter-r4", "scooter-l1", "scooter-l2")
    assert all(s["state"] == "docked" and s["rider"] is None for s in snap)
    assert set(snap[0]) == {"id", "state", "rider", "at", "since", "version", "pose", "accident"}


def test_first_claim_wins_the_second_is_taken() -> None:
    r = ScooterRegistry()
    s, why = r.claim("scooter-r1", A, "sa", now=1)
    assert why is None and s["state"] == "ridden" and s["rider"] == A
    s2, why2 = r.claim("scooter-r1", B, "sb", now=2)
    assert s2 is None and why2 == "taken"
    assert r.get("scooter-r1")["rider"] == A


def test_repeat_claim_by_the_rider_is_idempotent_and_one_rider_rides_one_scooter() -> None:
    r = ScooterRegistry()
    r.claim("scooter-r1", A, "sa", now=1)
    v = r.get("scooter-r1")["version"]
    s, why = r.claim("scooter-r1", A, "sa", now=2)
    assert why is None and s["version"] == v
    assert r.claim("scooter-r2", A, "sa", now=3) == (None, "already_riding")


def test_unknown_and_fallen_are_refused() -> None:
    r = ScooterRegistry()
    assert r.claim("scooter-x9", A, "sa") == (None, "unknown")
    r.get("scooter-l1")["state"] = "fallen"
    assert r.claim("scooter-l1", A, "sa") == (None, "fallen")


def test_only_the_rider_releases_and_it_goes_home() -> None:
    r = ScooterRegistry()
    r.claim("scooter-r2", A, "sa", now=1)
    assert r.release("scooter-r2", B, "sb", now=2) == (None, "not_rider")
    # the same person in ANOTHER live tab does not end the ride either
    assert r.release("scooter-r2", A, "other-tab", now=2) == (None, "not_rider")
    s, why = r.release("scooter-r2", A, "sa", now=3)
    assert why is None and s["state"] == "docked" and s["rider"] is None and s["since"] == 3
    assert r.release("scooter-r2", A, "sa", now=4) == (None, "not_rider")


def test_release_with_a_position_leaves_it_standing_for_anyone() -> None:
    r = ScooterRegistry()
    r.claim("scooter-r3", A, "sa", now=1)
    at = {"x": 100.0, "z": 1500.0, "yaw": 1.5}
    s, _ = r.release("scooter-r3", A, "sa", at=at, now=2)
    assert s["state"] == "standing" and s["at"] == at
    s2, why = r.claim("scooter-r3", B, "sb", now=3)
    assert why is None and s2["rider"] == B and s2["at"] is None


def test_a_second_tab_of_the_same_rider_cannot_take_a_live_ride() -> None:
    r = ScooterRegistry()
    r.claim("scooter-r1", A, "tab1", now=1)
    assert r.claim("scooter-r1", A, "tab2", now=2) == (None, "taken")


def test_disconnect_keeps_the_scooter_for_the_grace_and_a_refresh_takes_it_back() -> None:
    r = ScooterRegistry()
    r.claim("scooter-l2", A, "old", now=10)
    assert r.orphan_sid("old", now=11) == ["scooter-l2"]
    assert r.orphan_sid("old", now=12) == []  # marked once
    assert r.claim("scooter-l2", B, "sb", now=12) == (None, "taken")  # not free during the grace
    s, why = r.claim("scooter-l2", A, "new", now=13)
    assert why is None and s["rider_sid"] == "new" and s["lost_at"] is None
    assert r.expire_lost("scooter-l2", now=11 + RECONNECT_GRACE_SECONDS + 1) is None  # reclaimed: stays


def test_an_abandoned_scooter_goes_home_after_the_grace_only() -> None:
    r = ScooterRegistry()
    r.claim("scooter-r4", A, "sa", now=100)
    r.orphan_sid("sa", now=100)
    assert r.expire_lost("scooter-r4", now=100 + RECONNECT_GRACE_SECONDS - 1) is None
    s = r.expire_lost("scooter-r4", now=100 + RECONNECT_GRACE_SECONDS)
    assert s is not None and s["state"] == "docked" and s["rider"] is None
    assert r.claim("scooter-r4", B, "sb", now=200)[1] is None


def test_versions_and_since_move_on_every_change() -> None:
    r = ScooterRegistry()
    v0 = r.get("scooter-r1")["version"]
    r.claim("scooter-r1", A, "sa", now=5)
    r.release("scooter-r1", A, "sa", now=6)
    s = r.get("scooter-r1")
    assert s["version"] == v0 + 2 and s["since"] == 6


def test_valid_at() -> None:
    assert valid_at({"x": 1, "z": 2, "yaw": 0.5}) == {"x": 1.0, "z": 2.0, "yaw": 0.5}
    for bad in (None, [], {"x": 1, "z": 2}, {"x": "1", "z": 2, "yaw": 0}, {"x": float("nan"), "z": 2, "yaw": 0}, {"x": True, "z": 2, "yaw": 0}, {"x": 1e9, "z": 0, "yaw": 0}):
        assert valid_at(bad) is None


# ---- S2: the rider's pose stream ------------------------------------------------------------------------

POSE = {"x": 1200.0, "z": 1330.0, "y": 0.2, "heading": 1.2, "speed": 150.0, "lean": 0.1, "pitch": 0.0}


def test_only_the_current_rider_on_its_own_socket_may_stream() -> None:
    r = ScooterRegistry()
    assert r.accept_pose("scooter-r1", A, "sa", 1, POSE, now=1) == "not_rider"  # nobody rides it
    r.claim("scooter-r1", A, "sa", now=1)
    assert r.accept_pose("scooter-r1", B, "sb", 1, POSE, now=2) == "not_rider"
    assert r.accept_pose("scooter-r1", A, "other-tab", 1, POSE, now=2) == "not_rider"
    assert r.accept_pose("scooter-x", A, "sa", 1, POSE, now=2) == "unknown"
    assert r.accept_pose("scooter-r1", A, "sa", 1, POSE, now=2) is None
    assert r.wire(r.get("scooter-r1"))["pose"] == POSE  # kept for whoever joins next


def test_out_of_order_duplicate_and_too_fast_poses_are_dropped() -> None:
    r = ScooterRegistry()
    r.claim("scooter-r2", A, "sa", now=0)
    assert r.accept_pose("scooter-r2", A, "sa", 5, POSE, now=1) is None
    assert r.accept_pose("scooter-r2", A, "sa", 5, POSE, now=2) == "stale"
    assert r.accept_pose("scooter-r2", A, "sa", 4, POSE, now=2) == "stale"
    assert r.accept_pose("scooter-r2", A, "sa", 6, POSE, now=1 + POSE_MIN_INTERVAL_S / 2) == "too_fast"
    assert r.accept_pose("scooter-r2", A, "sa", 6, POSE, now=1 + POSE_MIN_INTERVAL_S) is None


def test_a_lost_ride_streams_nothing_and_a_new_ride_starts_its_stream_again() -> None:
    r = ScooterRegistry()
    r.claim("scooter-l1", A, "sa", now=0)
    r.accept_pose("scooter-l1", A, "sa", 40, POSE, now=1)
    r.orphan_sid("sa", now=2)
    assert r.accept_pose("scooter-l1", A, "sa", 41, POSE, now=3) == "not_rider"
    r.claim("scooter-l1", A, "sb", now=4)  # back on a new socket: its own sequence from scratch
    assert r.wire(r.get("scooter-l1"))["pose"] is None
    assert r.accept_pose("scooter-l1", A, "sb", 0, POSE, now=5) is None
    r.release("scooter-l1", A, "sb", now=6)
    assert r.wire(r.get("scooter-l1"))["pose"] is None


def test_valid_pose_keeps_known_fields_and_the_reserved_drift_block() -> None:
    raw = {"scooterId": "scooter-r1", "seq": 3, "t": 1_800_000_000_000, **POSE, "junk": 1,
           "fx": {"drift": -1, "charge": 0.5, "slip": 0.3, "boost": True, "sparkles": 9}}
    v = valid_pose(raw)
    assert v == {"scooterId": "scooter-r1", "seq": 3, "t": 1.8e12, "pose": {**POSE, "fx": {"drift": -1, "charge": 0.5, "slip": 0.3, "boost": True}}}
    assert valid_pose({**raw, "fx": None})["pose"].get("fx") is None
    for bad in (
        None, {**raw, "seq": -1}, {**raw, "seq": True}, {**raw, "seq": 1.5}, {**raw, "x": float("inf")},
        {**raw, "lean": 5}, {**raw, "speed": -500}, {**raw, "scooterId": ""}, {**raw, "t": "now"},
        {**raw, "fx": {"drift": 2}}, {**raw, "fx": {"charge": 1.5}}, {**raw, "fx": {"boost": 1}}, {**raw, "fx": []},
        {k: v for k, v in raw.items() if k != "heading"},
    ):
        assert valid_pose(bad) is None, bad
