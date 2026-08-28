from __future__ import annotations

from app.services.position_registry import PositionRegistry


def _start(registry, email="a@example.com", movement_id="m1", **overrides):
    kwargs = dict(
        movement_id=movement_id,
        origin={"x": 0.0, "y": 0.0},
        path=[{"x": 10.0, "y": 0.0}],
        room_id=None,
        duration_ms=500,
        started_at=1_000,
    )
    kwargs.update(overrides)
    return registry.start(email, **kwargs)


def test_revision_is_monotonic_per_employee():
    registry = PositionRegistry()

    r1 = _start(registry, movement_id="m1", started_at=1000)
    r2 = registry.arrive(
        "a@example.com",
        movement_id="m1",
        at={"x": 10.0, "y": 0.0},
        facing="right",
        state="standing",
        seat_key=None,
        room_id=None,
        now_ms=1500,
    ).revision
    r3 = _start(registry, movement_id="m2", started_at=2000)

    assert r1 == 1
    assert r2 == 2
    assert r3 == 3


def test_revision_is_independent_per_employee():
    registry = PositionRegistry()

    r_a = _start(registry, email="a@example.com", movement_id="m1")
    r_b = _start(registry, email="b@example.com", movement_id="m1")

    assert r_a == 1
    assert r_b == 1


def test_start_supersedes_prior_active_movement():
    registry = PositionRegistry()

    _start(registry, movement_id="m1")
    _start(registry, movement_id="m2")

    entry = registry.get("a@example.com")
    assert entry.active.movement_id == "m2"


def test_arrive_rejects_wrong_movement_id():
    registry = PositionRegistry()
    _start(registry, movement_id="m1")

    result = registry.arrive(
        "a@example.com",
        movement_id="does-not-match",
        at={"x": 10.0, "y": 0.0},
        facing="right",
        state="standing",
        seat_key=None,
        room_id=None,
        now_ms=1500,
    )

    assert result is None


def test_arrive_rejects_when_no_active_movement():
    registry = PositionRegistry()

    result = registry.arrive(
        "nobody@example.com",
        movement_id="m1",
        at={"x": 10.0, "y": 0.0},
        facing="right",
        state="standing",
        seat_key=None,
        room_id=None,
        now_ms=1500,
    )

    assert result is None


def test_arrive_for_superseded_old_movement_id_is_rejected():
    registry = PositionRegistry()
    _start(registry, movement_id="m1")
    _start(registry, movement_id="m2")

    # a stale arrival for the first (superseded) movement must be rejected
    result = registry.arrive(
        "a@example.com",
        movement_id="m1",
        at={"x": 10.0, "y": 0.0},
        facing="right",
        state="standing",
        seat_key=None,
        room_id=None,
        now_ms=1500,
    )

    assert result is None
    # the second (still active) movement is untouched
    assert registry.get("a@example.com").active.movement_id == "m2"


def test_arrive_clears_active_and_updates_stable():
    registry = PositionRegistry()
    _start(registry, movement_id="m1")

    stable = registry.arrive(
        "a@example.com",
        movement_id="m1",
        at={"x": 10.0, "y": 0.0},
        facing="right",
        state="sitting",
        seat_key="desk-1",
        room_id="design-team",
        now_ms=1500,
    )

    entry = registry.get("a@example.com")
    assert entry.active is None
    assert stable.x == 10.0
    assert stable.state == "sitting"
    assert stable.seat_key == "desk-1"
    assert stable.room_id == "design-team"


def test_load_stable_seeds_when_no_memory_entry():
    registry = PositionRegistry()

    registry.load_stable(
        [
            {
                "email": "a@example.com",
                "x": 1.0,
                "y": 2.0,
                "facing": "front",
                "state": "standing",
                "seat_key": None,
                "room_id": None,
                "revision": 5,
                "updated_at": 12345,
            }
        ]
    )

    entry = registry.get("a@example.com")
    assert entry.stable.x == 1.0
    assert entry.stable.y == 2.0
    assert entry.stable.revision == 5

    # revision counter continues from the DB value
    next_rev = registry.next_revision("a@example.com")
    assert next_rev == 6


def test_load_stable_keeps_memory_when_entry_already_exists():
    registry = PositionRegistry()
    _start(registry, movement_id="m1", started_at=1000)
    registry.arrive(
        "a@example.com",
        movement_id="m1",
        at={"x": 99.0, "y": 99.0},
        facing="left",
        state="standing",
        seat_key=None,
        room_id=None,
        now_ms=1500,
    )
    memory_stable = registry.get("a@example.com").stable

    registry.load_stable(
        [
            {
                "email": "a@example.com",
                "x": 1.0,
                "y": 2.0,
                "facing": "front",
                "state": "standing",
                "seat_key": None,
                "room_id": None,
                "revision": 100,
                "updated_at": 12345,
            }
        ]
    )

    # memory data wins — not overwritten by the DB row
    assert registry.get("a@example.com").stable is memory_stable
    assert registry.get("a@example.com").stable.x == 99.0

    # but the revision counter is bumped to the max so future revisions stay monotonic
    next_rev = registry.next_revision("a@example.com")
    assert next_rev == 101


def test_snapshot_shape():
    registry = PositionRegistry()
    _start(registry, movement_id="m1", started_at=1000, room_id="design-team", duration_ms=750)

    snapshot = registry.snapshot()

    assert snapshot == [
        {
            "email": "a@example.com",
            "revision": 1,
            "pos": {"x": 0.0, "y": 0.0},
            "facing": "front",
            "state": "standing",
            "seatKey": None,
            "roomId": "design-team",
            "updatedAt": 1000,
            "active": {
                "movementId": "m1",
                "origin": {"x": 0.0, "y": 0.0},
                "path": [{"x": 10.0, "y": 0.0}],
                "roomId": "design-team",
                "durationMs": 750,
                "startedAt": 1000,
            },
        }
    ]


def test_snapshot_active_is_none_after_arrival():
    registry = PositionRegistry()
    _start(registry, movement_id="m1")
    registry.arrive(
        "a@example.com",
        movement_id="m1",
        at={"x": 10.0, "y": 0.0},
        facing="right",
        state="standing",
        seat_key=None,
        room_id=None,
        now_ms=1500,
    )

    snapshot = registry.snapshot()
    assert snapshot[0]["active"] is None


def test_reset_clears_all_state():
    registry = PositionRegistry()
    _start(registry, movement_id="m1")

    registry.reset()

    assert registry.get("a@example.com") is None
    assert registry.snapshot() == []
    assert registry.next_revision("a@example.com") == 1


def test_snapshot_own_email_present_with_active_null_but_stable_intact():
    registry = PositionRegistry()
    _start(registry, email="a@example.com", movement_id="m1")
    _start(registry, email="b@example.com", movement_id="m1")

    snapshot = registry.snapshot(own_email="a@example.com")

    emails = [entry["email"] for entry in snapshot]
    assert "a@example.com" in emails
    assert "b@example.com" in emails

    own_entry = next(e for e in snapshot if e["email"] == "a@example.com")
    assert own_entry["active"] is None
    assert own_entry["pos"] == {"x": 0.0, "y": 0.0}
    assert own_entry["revision"] == 1

    peer_entry = next(e for e in snapshot if e["email"] == "b@example.com")
    assert peer_entry["active"] is not None
    assert peer_entry["active"]["movementId"] == "m1"


def test_snapshot_own_email_is_case_and_whitespace_insensitive():
    registry = PositionRegistry()
    _start(registry, email="a@example.com", movement_id="m1")
    _start(registry, email="b@example.com", movement_id="m1")

    snapshot = registry.snapshot(own_email="  A@Example.com  ")

    own_entry = next(e for e in snapshot if e["email"] == "a@example.com")
    assert own_entry["active"] is None

    peer_entry = next(e for e in snapshot if e["email"] == "b@example.com")
    assert peer_entry["active"] is not None


def test_snapshot_without_own_email_is_unchanged():
    registry = PositionRegistry()
    _start(registry, email="a@example.com", movement_id="m1")

    snapshot = registry.snapshot()

    assert [entry["email"] for entry in snapshot] == ["a@example.com"]
    assert snapshot[0]["active"] is not None
