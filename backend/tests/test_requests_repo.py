from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.request import ConversationRequest
from app.repositories import chat as chat_repo
from app.repositories import requests as requests_repo

# Repository-layer coverage for Stage 2's "Ask to Join + Group Conversation" request flow —
# see backend/app/repositories/requests.py.

pytestmark = pytest.mark.asyncio


async def _seed_group(db_session):
    return await chat_repo.create_group_conversation(
        db_session, "a@example.com", ["b@example.com", "c@example.com"], title="Squad"
    )


async def test_create_request_returns_same_pending_row_idempotently_on_duplicate(db_session):
    conv = await _seed_group(db_session)
    conv_id = conv["id"]

    first = await requests_repo.create_request(
        db_session, kind="join_group", requester_email="d@example.com", conversation_id=conv_id
    )
    second = await requests_repo.create_request(
        db_session, kind="join_group", requester_email="D@Example.com", conversation_id=conv_id
    )

    assert first["id"] == second["id"]
    assert second["state"] == "pending"


async def test_resolve_request_second_attempt_returns_false(db_session):
    conv = await _seed_group(db_session)
    conv_id = conv["id"]
    req = await requests_repo.create_request(
        db_session, kind="join_group", requester_email="d@example.com", conversation_id=conv_id
    )

    first = await requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="a@example.com", new_state="accepted"
    )
    second = await requests_repo.resolve_request(
        db_session, request_id=req["id"], resolver_email="b@example.com", new_state="declined"
    )

    assert first is True
    assert second is False


async def test_cancel_request_returns_false_for_wrong_requester(db_session):
    conv = await _seed_group(db_session)
    conv_id = conv["id"]
    req = await requests_repo.create_request(
        db_session, kind="join_group", requester_email="d@example.com", conversation_id=conv_id
    )

    result = await requests_repo.cancel_request(
        db_session, request_id=req["id"], requester_email="not-the-requester@example.com"
    )
    assert result is False

    result_correct = await requests_repo.cancel_request(
        db_session, request_id=req["id"], requester_email="d@example.com"
    )
    assert result_correct is True


async def test_list_pending_for_participant_scoped_to_own_conversations(db_session):
    conv_a = await _seed_group(db_session)
    conv_b = await chat_repo.create_group_conversation(
        db_session, "x@example.com", ["y@example.com"], title="Other"
    )

    req_a = await requests_repo.create_request(
        db_session, kind="join_group", requester_email="d@example.com", conversation_id=conv_a["id"]
    )
    await requests_repo.create_request(
        db_session, kind="join_group", requester_email="z@example.com", conversation_id=conv_b["id"]
    )

    pending_for_a = await requests_repo.list_pending_for_participant(db_session, "a@example.com")
    assert [r["id"] for r in pending_for_a] == [req_a["id"]]

    pending_for_unrelated = await requests_repo.list_pending_for_participant(
        db_session, "nobody@example.com"
    )
    assert pending_for_unrelated == []


async def test_expire_stale_count_is_correct(db_session):
    conv = await _seed_group(db_session)
    conv_id = conv["id"]

    req = await requests_repo.create_request(
        db_session, kind="join_group", requester_email="d@example.com", conversation_id=conv_id
    )
    # Backdate created_at directly so it looks stale without needing to sleep in the test.
    result = await db_session.execute(
        select(ConversationRequest).where(ConversationRequest.id == req["id"])
    )
    row = result.scalar_one()
    row.created_at = datetime.now(timezone.utc) - timedelta(days=2)
    await db_session.commit()

    count = await requests_repo.expire_stale(
        db_session, older_than=datetime.now(timezone.utc) - timedelta(days=1)
    )
    assert count == 1

    updated = await requests_repo.get_request_by_id(db_session, req["id"])
    assert updated["state"] == "expired"
