from __future__ import annotations

from app.services.spatial_session import SpatialSessionRegistry


def test_start_places_a_member_in_a_session():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1")

    assert registry.session_of("a@example.com") == "s1"
    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_start_is_idempotent_for_the_same_email_and_session():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1")
    registry.start("a@example.com", "s1")

    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_start_moves_a_member_between_sessions():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1")
    registry.start("a@example.com", "s2")

    assert registry.session_of("a@example.com") == "s2"
    assert registry.snapshot() == [{"sessionId": "s2", "members": ["a@example.com"]}]


def test_multiple_members_in_the_same_session_are_grouped_together():
    registry = SpatialSessionRegistry()
    registry.start("b@example.com", "s1")
    registry.start("a@example.com", "s1")

    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com", "b@example.com"]}]


def test_leave_removes_the_member_and_returns_the_session_id():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1")

    left = registry.leave("a@example.com")

    assert left == "s1"
    assert registry.session_of("a@example.com") is None


def test_leave_returns_none_for_an_email_not_in_any_session():
    registry = SpatialSessionRegistry()

    assert registry.leave("not-present@example.com") is None


def test_leave_drops_the_session_entirely_once_last_member_leaves():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1")

    registry.leave("a@example.com")

    assert registry.snapshot() == []


def test_snapshot_ordering_is_stable_across_sessions_and_members():
    registry = SpatialSessionRegistry()
    registry.start("z@example.com", "s2")
    registry.start("b@example.com", "s1")
    registry.start("a@example.com", "s1")
    registry.start("y@example.com", "s2")

    assert registry.snapshot() == [
        {"sessionId": "s1", "members": ["a@example.com", "b@example.com"]},
        {"sessionId": "s2", "members": ["y@example.com", "z@example.com"]},
    ]
