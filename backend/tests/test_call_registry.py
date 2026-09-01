from __future__ import annotations

from app.services.call_registry import CallRegistry


def test_room_is_minted_once_and_reused_for_the_same_session():
    r = CallRegistry()
    first = r.room_for_session("conv-1")
    assert r.room_for_session("conv-1") == first


def test_room_name_is_not_derived_from_the_session_id():
    """Conversation ids must never leak into LiveKit's room namespace."""
    r = CallRegistry()
    room = r.room_for_session("conv-secret-id")
    assert "conv-secret-id" not in room
    assert room.startswith("vo-call-")


def test_different_sessions_get_different_rooms():
    r = CallRegistry()
    assert r.room_for_session("conv-1") != r.room_for_session("conv-2")


def test_existing_room_lookup_does_not_mint():
    r = CallRegistry()
    assert r.existing_room_for_session("conv-1") is None
    assert r.existing_room_for_session("conv-1") is None


def test_join_records_a_participant_and_reports_the_change():
    r = CallRegistry()
    assert r.join("conv-1", "a@example.com", "sid-a") is True
    assert r.participants("conv-1") == ["a@example.com"]
    assert r.has_active_call("conv-1") is True


def test_join_is_idempotent_at_the_email_level():
    r = CallRegistry()
    r.join("conv-1", "a@example.com", "sid-tab1")
    assert r.join("conv-1", "A@Example.com", "sid-tab2") is False
    assert r.participants("conv-1") == ["a@example.com"]


def test_no_active_call_until_someone_actually_connects():
    """Minting a room (issuing a token) is not an active call — only a live connection is."""
    r = CallRegistry()
    r.room_for_session("conv-1")
    assert r.has_active_call("conv-1") is False
    assert r.snapshot() == []


def test_leave_removes_only_that_sids_claim():
    r = CallRegistry()
    r.join("conv-1", "a@example.com", "sid-tab1")
    r.join("conv-1", "a@example.com", "sid-tab2")
    assert r.leave("a@example.com", "sid-tab1") is False
    assert r.participants("conv-1") == ["a@example.com"]
    assert r.leave("a@example.com", "sid-tab2") is True


def test_clear_sid_is_a_no_op_for_a_socket_that_never_joined_media():
    r = CallRegistry()
    r.join("conv-1", "a@example.com", "sid-call")
    assert r.clear_sid("sid-unrelated") is False
    assert r.participants("conv-1") == ["a@example.com"]


def test_clear_sid_removes_a_disconnected_participant():
    r = CallRegistry()
    r.join("conv-1", "a@example.com", "sid-a")
    r.join("conv-1", "b@example.com", "sid-b")
    assert r.clear_sid("sid-a") is True
    assert r.participants("conv-1") == ["b@example.com"]


def test_room_is_forgotten_once_the_last_participant_leaves():
    """So the NEXT call in this conversation gets a fresh room, not a dead one."""
    r = CallRegistry()
    room = r.room_for_session("conv-1")
    r.join("conv-1", "a@example.com", "sid-a")
    r.leave("a@example.com", "sid-a")
    assert r.has_active_call("conv-1") is False
    assert r.existing_room_for_session("conv-1") is None
    assert r.room_for_session("conv-1") != room


def test_snapshot_only_lists_sessions_with_a_live_participant():
    r = CallRegistry()
    r.room_for_session("conv-empty")
    r.join("conv-live", "a@example.com", "sid-a")
    snap = r.snapshot()
    assert [s["sessionId"] for s in snap] == ["conv-live"]
    assert snap[0]["participants"] == ["a@example.com"]
    assert set(snap[0]) == {"sessionId", "room", "participants"}


def test_snapshot_carries_no_track_or_mute_state():
    """LiveKit owns media detail — this registry must never mirror it."""
    r = CallRegistry()
    r.join("conv-1", "a@example.com", "sid-a")
    assert set(r.snapshot()[0]) == {"sessionId", "room", "participants"}


# --- Ask-to-Join upgrade -----------------------------------------------------------------


def test_rekey_preserves_the_same_room_for_the_new_session_id():
    r = CallRegistry()
    room = r.room_for_session("old-conv")
    r.join("old-conv", "a@example.com", "sid-a")
    r.join("old-conv", "b@example.com", "sid-b")

    assert r.rekey_session("old-conv", "new-conv") == room
    assert r.room_for_session("new-conv") == room
    assert r.existing_room_for_session("old-conv") is None
    # Connected participants are untouched — nobody has to hop rooms.
    assert r.participants("new-conv") == ["a@example.com", "b@example.com"]
    assert r.has_active_call("new-conv") is True


def test_rekey_lets_a_third_person_join_the_same_existing_room():
    r = CallRegistry()
    room = r.room_for_session("old-conv")
    r.join("old-conv", "a@example.com", "sid-a")
    r.rekey_session("old-conv", "new-conv")

    assert r.room_for_session("new-conv") == room  # joiner's token targets the SAME room
    r.join("new-conv", "c@example.com", "sid-c")
    assert r.participants("new-conv") == ["a@example.com", "c@example.com"]


def test_rekey_is_a_no_op_when_no_call_exists():
    r = CallRegistry()
    assert r.rekey_session("old-conv", "new-conv") is None
    assert r.existing_room_for_session("new-conv") is None


def test_rekey_to_the_same_id_is_harmless():
    r = CallRegistry()
    room = r.room_for_session("conv-1")
    assert r.rekey_session("conv-1", "conv-1") == room
    assert r.room_for_session("conv-1") == room


def test_reset_clears_everything():
    r = CallRegistry()
    r.join("conv-1", "a@example.com", "sid-a")
    r.reset()
    assert r.snapshot() == []
    assert r.existing_room_for_session("conv-1") is None
    assert r.clear_sid("sid-a") is False
