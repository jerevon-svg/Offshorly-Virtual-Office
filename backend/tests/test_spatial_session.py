from __future__ import annotations

from app.services.spatial_session import SpatialSessionRegistry


def test_start_places_a_member_in_a_session():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-a")

    assert registry.session_of("a@example.com") == "s1"
    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_start_is_idempotent_for_the_same_email_session_and_sid():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-a")
    registry.start("a@example.com", "s1", "sid-a")

    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_start_moves_a_member_between_sessions():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-a")
    registry.start("a@example.com", "s2", "sid-a")

    assert registry.session_of("a@example.com") == "s2"
    assert registry.snapshot() == [{"sessionId": "s2", "members": ["a@example.com"]}]


def test_multiple_members_in_the_same_session_are_grouped_together():
    registry = SpatialSessionRegistry()
    registry.start("b@example.com", "s1", "sid-b")
    registry.start("a@example.com", "s1", "sid-a")

    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com", "b@example.com"]}]


def test_leave_removes_the_member_and_returns_the_session_id():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-a")

    left = registry.leave("a@example.com")

    assert left == "s1"
    assert registry.session_of("a@example.com") is None


def test_leave_returns_none_for_an_email_not_in_any_session():
    registry = SpatialSessionRegistry()

    assert registry.leave("not-present@example.com") is None


def test_leave_drops_the_session_entirely_once_last_member_leaves():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-a")

    registry.leave("a@example.com")

    assert registry.snapshot() == []


def test_snapshot_ordering_is_stable_across_sessions_and_members():
    registry = SpatialSessionRegistry()
    registry.start("z@example.com", "s2", "sid-z")
    registry.start("b@example.com", "s1", "sid-b")
    registry.start("a@example.com", "s1", "sid-a")
    registry.start("y@example.com", "s2", "sid-y")

    assert registry.snapshot() == [
        {"sessionId": "s1", "members": ["a@example.com", "b@example.com"]},
        {"sessionId": "s2", "members": ["y@example.com", "z@example.com"]},
    ]


# --- Stage 0: sid-aware ownership -------------------------------------------------------


def test_one_email_can_own_the_same_session_from_multiple_sids():
    """Multi-tab: two of this user's sockets each emitted spatial_session_start for the same
    conversation. Both are co-owners; the member still appears exactly once."""
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-tab1")
    registry.start("a@example.com", "s1", "sid-tab2")

    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_clear_sid_keeps_membership_while_another_owning_sid_remains():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-tab1")
    registry.start("a@example.com", "s1", "sid-tab2")

    assert registry.clear_sid("sid-tab1") is None
    assert registry.session_of("a@example.com") == "s1"
    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_clear_sid_removes_membership_when_the_last_owning_sid_goes():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-tab1")
    registry.start("a@example.com", "s1", "sid-tab2")

    registry.clear_sid("sid-tab1")

    assert registry.clear_sid("sid-tab2") == "s1"
    assert registry.session_of("a@example.com") is None
    assert registry.snapshot() == []


def test_clear_sid_is_a_no_op_for_a_socket_that_never_started_a_session():
    """THE BUG THIS FIXES: the ~9 other sockets this user has open (movementSync, dndClient,
    RealChatService, ...) authenticate as the same email but never emit spatial_session_start.
    Their disconnects must not touch spatial membership at all."""
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-spatial")

    assert registry.clear_sid("sid-movement-sync") is None
    assert registry.clear_sid("sid-chat") is None
    assert registry.session_of("a@example.com") == "s1"
    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_clear_sid_of_an_unknown_sid_returns_none():
    registry = SpatialSessionRegistry()

    assert registry.clear_sid("never-seen") is None


def test_explicit_leave_drops_every_owning_sid():
    """Explicit leave is the user saying "I'm out" — it must not leave a stale sid behind that a
    later disconnect could use to re-broadcast a removal."""
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-tab1")
    registry.start("a@example.com", "s1", "sid-tab2")

    assert registry.leave("a@example.com") == "s1"
    assert registry.clear_sid("sid-tab1") is None
    assert registry.clear_sid("sid-tab2") is None
    assert registry.snapshot() == []


def test_moving_sessions_drops_ownership_held_by_the_old_sessions_sids():
    """Ask-to-Join upgrade path: the same socket re-starts under a NEW conversation id. A sid
    that was holding the OLD session open must not keep the (now-superseded) membership alive."""
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-old")
    registry.start("a@example.com", "s2", "sid-new")

    assert registry.session_of("a@example.com") == "s2"
    # sid-old no longer owns anything; its disconnect must not end the new session.
    assert registry.clear_sid("sid-old") is None
    assert registry.session_of("a@example.com") == "s2"
    assert registry.clear_sid("sid-new") == "s2"
    assert registry.snapshot() == []


def test_reconnect_reassert_under_a_new_sid_restores_membership():
    """Reconnect: the old sid was cleared by its own disconnect, then the client re-emits
    spatial_session_start over a brand-new sid (spatialSessionStore.ts's "connect" handler)."""
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-old")

    assert registry.clear_sid("sid-old") == "s1"
    assert registry.snapshot() == []

    registry.start("a@example.com", "s1", "sid-reconnected")

    assert registry.session_of("a@example.com") == "s1"
    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


# --- Stage 0: email normalization -------------------------------------------------------


def test_email_casing_and_whitespace_are_normalized():
    registry = SpatialSessionRegistry()
    registry.start("  A@Example.COM ", "s1", "sid-a")

    assert registry.session_of("a@example.com") == "s1"
    assert registry.session_of("A@EXAMPLE.COM") == "s1"
    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]


def test_differently_cased_emails_are_the_same_member_not_two():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-tab1")
    registry.start("A@Example.com", "s1", "sid-tab2")

    assert registry.snapshot() == [{"sessionId": "s1", "members": ["a@example.com"]}]
    assert registry.clear_sid("sid-tab1") is None
    assert registry.clear_sid("sid-tab2") == "s1"


def test_leave_normalizes_email_casing():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-a")

    assert registry.leave("A@EXAMPLE.COM") == "s1"
    assert registry.snapshot() == []


def test_reset_clears_membership_and_sid_ownership():
    registry = SpatialSessionRegistry()
    registry.start("a@example.com", "s1", "sid-a")

    registry.reset()

    assert registry.snapshot() == []
    assert registry.session_of("a@example.com") is None
    assert registry.clear_sid("sid-a") is None
