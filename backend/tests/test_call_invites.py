from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.call_invites import INVITE_TTL_SECONDS, CallInviteRegistry, wire


def _reg() -> CallInviteRegistry:
    return CallInviteRegistry()


def test_create_returns_a_pending_person_to_person_invite():
    r = _reg()
    inv = r.create(from_email="A@Example.com", from_sid="sid-a", to_email="B@Example.com")
    assert inv["from_email"] == "a@example.com"
    assert inv["to_email"] == "b@example.com"
    assert r.get(inv["inviteId"]) is not None


def test_invite_carries_no_session_id_and_no_livekit_room():
    """Eligibility stays the spatial session's job and LiveKit stays media-only — an invite must
    reference neither, which also makes it immune to an Ask-to-Join session re-key."""
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert "session_id" not in inv and "sessionId" not in inv
    assert "room" not in inv
    assert set(wire(inv)) == {"inviteId", "fromEmail", "toEmail"}


def test_wire_shape_hides_server_only_fields():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert "from_sid" not in wire(inv) and "created_at" not in wire(inv)


# --- single-shot resolution ---------------------------------------------------------------


def test_recipient_can_accept_once_and_late_accepts_are_no_ops():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.resolve(inv["inviteId"], actor_email="b@x.com", role="recipient") is not None
    assert r.resolve(inv["inviteId"], actor_email="b@x.com", role="recipient") is None


def test_decline_and_cancel_are_also_single_shot():
    r = _reg()
    i1 = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.resolve(i1["inviteId"], actor_email="b@x.com", role="recipient") is not None
    i2 = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.resolve(i2["inviteId"], actor_email="a@x.com", role="caller") is not None
    assert r.resolve(i2["inviteId"], actor_email="a@x.com", role="caller") is None


def test_accept_racing_cancel_first_terminal_state_wins():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    accepted = r.resolve(inv["inviteId"], actor_email="b@x.com", role="recipient")
    cancelled = r.resolve(inv["inviteId"], actor_email="a@x.com", role="caller")
    assert accepted is not None and cancelled is None


def test_caller_cannot_accept_their_own_invite():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.resolve(inv["inviteId"], actor_email="a@x.com", role="recipient") is None
    # A failed authority check must leave the invite intact.
    assert r.get(inv["inviteId"]) is not None


def test_recipient_cannot_cancel_and_a_stranger_can_resolve_nothing():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.resolve(inv["inviteId"], actor_email="b@x.com", role="caller") is None
    assert r.resolve(inv["inviteId"], actor_email="z@x.com", role="recipient") is None
    assert r.get(inv["inviteId"]) is not None


def test_resolving_an_unknown_invite_is_harmless():
    r = _reg()
    assert r.resolve("nope", actor_email="b@x.com", role="recipient") is None


def test_authority_check_normalizes_email_casing():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.resolve(inv["inviteId"], actor_email="B@X.COM", role="recipient") is not None


# --- duplicate / glare -------------------------------------------------------------------


def test_pending_between_detects_a_duplicate_reinvite():
    r = _reg()
    r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.pending_between("a@x.com", "b@x.com") is not None


def test_pending_between_detects_glare_in_the_reverse_direction():
    """Both people ringing each other at once must not create two competing invites."""
    r = _reg()
    r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.pending_between("b@x.com", "a@x.com") is not None


def test_pending_between_ignores_unrelated_pairs():
    r = _reg()
    r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.pending_between("a@x.com", "c@x.com") is None


# --- cleanup -----------------------------------------------------------------------------


def test_clear_sid_cancels_the_invites_that_socket_owns():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    cleared = r.clear_sid("sid-a")
    assert [c["inviteId"] for c in cleared] == [inv["inviteId"]]
    assert r.get(inv["inviteId"]) is None


def test_clear_sid_is_a_no_op_for_an_unrelated_socket():
    """A user has ~11 other sockets open; none of them owns the ring."""
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-call", to_email="b@x.com")
    assert r.clear_sid("sid-movement-sync") == []
    assert r.get(inv["inviteId"]) is not None


def test_recipient_side_disconnect_does_not_clear_the_invite():
    """A recipient refresh should keep ringing and be restored by the connect snapshot."""
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.clear_sid("sid-b-recipient") == []
    assert r.get(inv["inviteId"]) is not None


def test_ttl_expires_a_stale_ring():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    later = datetime.now(timezone.utc) + timedelta(seconds=INVITE_TTL_SECONDS + 1)
    expired = r.expired(now=later)
    assert [e["inviteId"] for e in expired] == [inv["inviteId"]]
    assert r.get(inv["inviteId"]) is None


def test_ttl_leaves_a_fresh_ring_alone():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    assert r.expired(now=datetime.now(timezone.utc) + timedelta(seconds=5)) == []
    assert r.get(inv["inviteId"]) is not None


def test_an_already_resolved_invite_cannot_also_expire():
    r = _reg()
    inv = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    r.resolve(inv["inviteId"], actor_email="b@x.com", role="recipient")
    later = datetime.now(timezone.utc) + timedelta(seconds=INVITE_TTL_SECONDS + 1)
    assert r.expired(now=later) == []


# --- snapshot ----------------------------------------------------------------------------


def test_pending_for_returns_both_directions_for_that_person_only():
    r = _reg()
    out = r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    inc = r.create(from_email="c@x.com", from_sid="sid-c", to_email="a@x.com")
    r.create(from_email="y@x.com", from_sid="sid-y", to_email="z@x.com")

    ids = {i["inviteId"] for i in r.pending_for("A@X.com")}
    assert ids == {out["inviteId"], inc["inviteId"]}
    assert r.pending_for("nobody@x.com") == []


def test_reset_clears_everything():
    r = _reg()
    r.create(from_email="a@x.com", from_sid="sid-a", to_email="b@x.com")
    r.reset()
    assert r.snapshot() == []
