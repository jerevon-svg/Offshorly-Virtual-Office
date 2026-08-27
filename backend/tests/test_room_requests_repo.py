from __future__ import annotations

import pytest

from app.repositories import room_requests as room_requests_repo

# Repository-layer coverage for the "Request Entry / Knock" flow — mirrors
# tests/test_requests_repo.py's conventions for the analogous Ask-to-Join repo.

pytestmark = pytest.mark.asyncio


async def test_create_request_defaults_to_pending(db_session):
    req = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="D@Example.com"
    )

    assert req["state"] == "pending"
    assert req["requester_email"] == "d@example.com"
    assert req["room_id"] == "design-team"


async def test_create_request_is_idempotent_for_same_pending_room_and_requester(db_session):
    first = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )
    second = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )

    assert first["id"] == second["id"]


async def test_create_request_allows_a_new_pending_after_prior_one_resolved(db_session):
    first = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )
    await room_requests_repo.resolve_request(
        db_session, request_id=first["id"], resolver_email="a@example.com", new_state="declined"
    )

    second = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )

    assert second["id"] != first["id"]
    assert second["state"] == "pending"


async def test_resolve_request_transitions_and_stamps_resolver(db_session):
    req = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )

    changed = await room_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="A@Example.com", new_state="accepted"
    )

    assert changed is True
    updated = await room_requests_repo.get_request_by_id(db_session, req["id"])
    assert updated["state"] == "accepted"
    assert updated["resolver_email"] == "a@example.com"
    assert updated["resolved_at"] is not None


async def test_double_resolve_second_call_reports_unchanged(db_session):
    req = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )

    first = await room_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="a@example.com", new_state="accepted"
    )
    second = await room_requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="b@example.com", new_state="declined"
    )

    assert first is True
    assert second is False
    updated = await room_requests_repo.get_request_by_id(db_session, req["id"])
    assert updated["state"] == "accepted"
    assert updated["resolver_email"] == "a@example.com"


async def test_cancel_request_only_by_requester(db_session):
    req = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )

    wrong_person = await room_requests_repo.cancel_request(
        db_session, request_id=req["id"], requester_email="a@example.com"
    )
    assert wrong_person is False

    right_person = await room_requests_repo.cancel_request(
        db_session, request_id=req["id"], requester_email="d@example.com"
    )
    assert right_person is True

    updated = await room_requests_repo.get_request_by_id(db_session, req["id"])
    assert updated["state"] == "cancelled"


async def test_cancel_pending_for_room_cancels_only_pending_rows_in_that_room(db_session):
    stale = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )
    other_room = await room_requests_repo.create_request(
        db_session, room_id="dev-team", requester_email="e@example.com"
    )
    already_resolved = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="f@example.com"
    )
    await room_requests_repo.resolve_request(
        db_session, request_id=already_resolved["id"], resolver_email="a@example.com", new_state="declined"
    )

    cancelled = await room_requests_repo.cancel_pending_for_room(db_session, room_id="design-team")

    assert [r["id"] for r in cancelled] == [stale["id"]]

    updated_stale = await room_requests_repo.get_request_by_id(db_session, stale["id"])
    assert updated_stale["state"] == "cancelled"

    updated_other_room = await room_requests_repo.get_request_by_id(db_session, other_room["id"])
    assert updated_other_room["state"] == "pending"


async def test_cancel_pending_for_room_with_no_pending_rows_returns_empty(db_session):
    cancelled = await room_requests_repo.cancel_pending_for_room(db_session, room_id="design-team")
    assert cancelled == []


async def test_list_pending_for_room_orders_by_created_at(db_session):
    first = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="d@example.com"
    )
    second = await room_requests_repo.create_request(
        db_session, room_id="design-team", requester_email="e@example.com"
    )

    pending = await room_requests_repo.list_pending_for_room(db_session, "design-team")

    assert [r["id"] for r in pending] == [first["id"], second["id"]]
