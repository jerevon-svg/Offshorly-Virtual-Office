from __future__ import annotations

from app.services.room_presence import RoomPresenceRegistry


def test_enter_places_a_member_in_a_room():
    registry = RoomPresenceRegistry()
    registry.enter("a@example.com", "design-team")

    assert registry.room_of("a@example.com") == "design-team"
    assert registry.occupants("design-team") == ["a@example.com"]
    assert registry.snapshot() == [{"roomId": "design-team", "members": ["a@example.com"]}]


def test_enter_moves_a_member_between_rooms():
    registry = RoomPresenceRegistry()
    registry.enter("a@example.com", "design-team")
    registry.enter("a@example.com", "dev-team")

    assert registry.room_of("a@example.com") == "dev-team"
    assert registry.occupants("design-team") == []
    assert registry.occupants("dev-team") == ["a@example.com"]


def test_leave_removes_the_member_and_returns_the_room_id():
    registry = RoomPresenceRegistry()
    registry.enter("a@example.com", "design-team")

    left = registry.leave("a@example.com")

    assert left == "design-team"
    assert registry.room_of("a@example.com") is None
    assert registry.occupants("design-team") == []


def test_leave_returns_none_for_an_email_not_in_any_room():
    registry = RoomPresenceRegistry()

    assert registry.leave("nobody@example.com") is None


def test_multiple_occupants_in_the_same_room_are_grouped_and_sorted():
    registry = RoomPresenceRegistry()
    registry.enter("b@example.com", "design-team")
    registry.enter("a@example.com", "design-team")

    assert registry.occupants("design-team") == ["a@example.com", "b@example.com"]
    assert registry.snapshot() == [{"roomId": "design-team", "members": ["a@example.com", "b@example.com"]}]


def test_snapshot_omits_empty_rooms():
    registry = RoomPresenceRegistry()
    registry.enter("a@example.com", "design-team")
    registry.leave("a@example.com")

    assert registry.snapshot() == []
