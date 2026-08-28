from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.repositories import talk_requests as talk_requests_repo

# Repository-layer coverage for "Request Permission to Talk" — mirrors
# tests/test_room_requests_repo.py's conventions for the analogous Request Entry repo.

pytestmark = pytest.mark.asyncio


async def test_create_request_defaults_to_pending(db_session):
    req = await talk_requests_repo.create_request(
        db_session, target_email="A@Example.com", requester_email="B@Example.com", kind="chat"
    )

    assert req["state"] == "pending"
    assert req["target_email"] == "a@example.com"
    assert req["requester_email"] == "b@example.com"
    assert req["kind"] == "chat"


async def test_create_request_is_idempotent_for_same_pending_pair(db_session):
    first = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="chat"
    )
    second = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="approach"
    )

    assert first["id"] == second["id"]


async def test_resolve_request_transitions_and_stamps_resolver(db_session):
    req = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="chat"
    )

    changed = await talk_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="A@Example.com", new_state="accepted"
    )

    assert changed is True
    updated = await talk_requests_repo.get_request_by_id(db_session, req["id"])
    assert updated["state"] == "accepted"
    assert updated["resolver_email"] == "a@example.com"


async def test_double_resolve_second_call_reports_unchanged(db_session):
    req = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="chat"
    )

    first = await talk_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="a@example.com", new_state="declined"
    )
    second = await talk_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="a@example.com", new_state="accepted"
    )

    assert first is True
    assert second is False


async def test_cancel_request_only_by_requester(db_session):
    req = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="chat"
    )

    wrong_person = await talk_requests_repo.cancel_request(
        db_session, request_id=req["id"], requester_email="a@example.com"
    )
    assert wrong_person is False

    right_person = await talk_requests_repo.cancel_request(
        db_session, request_id=req["id"], requester_email="b@example.com"
    )
    assert right_person is True


async def test_cancel_pending_for_target_cancels_only_pending_rows_for_that_target(db_session):
    stale = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="chat"
    )
    other_target = await talk_requests_repo.create_request(
        db_session, target_email="c@example.com", requester_email="b@example.com", kind="chat"
    )

    cancelled = await talk_requests_repo.cancel_pending_for_target(db_session, target_email="a@example.com")

    assert [r["id"] for r in cancelled] == [stale["id"]]
    updated_other = await talk_requests_repo.get_request_by_id(db_session, other_target["id"])
    assert updated_other["state"] == "pending"


async def test_get_cooldown_until_returns_none_with_no_prior_decline(db_session):
    cooldown = await talk_requests_repo.get_cooldown_until(
        db_session, target_email="a@example.com", requester_email="b@example.com"
    )
    assert cooldown is None


async def test_get_cooldown_until_returns_a_future_timestamp_right_after_a_decline(db_session):
    req = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="chat"
    )
    await talk_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="a@example.com", new_state="declined"
    )

    cooldown = await talk_requests_repo.get_cooldown_until(
        db_session, target_email="a@example.com", requester_email="b@example.com"
    )
    assert cooldown is not None
    assert cooldown > datetime.now(timezone.utc)
    assert cooldown < datetime.now(timezone.utc) + timedelta(minutes=16)


async def test_get_cooldown_until_scoped_to_the_exact_requester_target_pair(db_session):
    req = await talk_requests_repo.create_request(
        db_session, target_email="a@example.com", requester_email="b@example.com", kind="chat"
    )
    await talk_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="a@example.com", new_state="declined"
    )

    # A different requester targeting the same person is unaffected.
    cooldown_other_requester = await talk_requests_repo.get_cooldown_until(
        db_session, target_email="a@example.com", requester_email="c@example.com"
    )
    assert cooldown_other_requester is None

    # The same requester targeting a different person is unaffected.
    cooldown_other_target = await talk_requests_repo.get_cooldown_until(
        db_session, target_email="d@example.com", requester_email="b@example.com"
    )
    assert cooldown_other_target is None
