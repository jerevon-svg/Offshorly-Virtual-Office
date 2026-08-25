from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.models.conversation import Conversation
from app.realtime.socket import sio, user_room
from app.repositories import chat as chat_repo
from app.repositories import requests as requests_repo

# Router-layer coverage for Stage 2's /requests REST endpoints — see
# backend/app/routers/requests.py. Uses httpx's ASGI transport directly against the FastAPI app
# (not the socketio-wrapped combined app used by test_chat_socket.py) since these are plain REST
# endpoints; the dev x-dev-email bypass (app/auth/deps.py) authenticates each call.

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _fresh_schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def _seed_group() -> dict:
    async with async_session_maker() as session:
        return await chat_repo.create_group_conversation(
            session, "a@example.com", ["b@example.com", "c@example.com"], title="Squad"
        )


async def _seed_dm() -> dict:
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
        await chat_repo.insert_message(session, conv["id"], "a@example.com", "hello from a")
        await session.commit()
        return conv


async def test_create_request_returns_201():
    conv = await _seed_group()
    async with await _client() as client:
        res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": conv["id"]},
            headers=_headers("d@example.com"),
        )
    assert res.status_code == 201
    body = res.json()
    assert body["kind"] == "join_group"
    assert body["state"] == "pending"
    assert body["requesterEmail"] == "d@example.com"


async def test_resolve_by_non_participant_returns_403():
    conv = await _seed_group()
    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": conv["id"]},
            headers=_headers("d@example.com"),
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("outsider@example.com"),
        )
    assert resolve_res.status_code == 403


async def test_double_resolve_returns_409():
    conv = await _seed_group()
    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": conv["id"]},
            headers=_headers("d@example.com"),
        )
        request_id = create_res.json()["id"]

        first = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )
        second = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "decline"},
            headers=_headers("b@example.com"),
        )
    assert first.status_code == 200
    assert second.status_code == 409


async def test_accept_join_adds_participant_and_sets_result_conversation_id():
    conv = await _seed_group()
    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": conv["id"]},
            headers=_headers("d@example.com"),
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )

    assert resolve_res.status_code == 200
    body = resolve_res.json()
    assert body["state"] == "accepted"
    assert body["resultConversationId"] == conv["id"]

    async with async_session_maker() as session:
        is_participant = await chat_repo.is_participant(session, conv["id"], "d@example.com")
    assert is_participant is True


async def test_resolve_notifies_other_participant_not_just_requester(monkeypatch):
    """Bug fix regression: when A resolves a join request, B (a different existing participant
    who also saw the original `request_created` prompt) must also get `request_resolved` on
    their own user room, not just the requester's — otherwise B's prompt is left stuck stale."""
    conv = await _seed_group()  # participants: a, b, c

    emitted: list[tuple[str, str]] = []

    async def _fake_emit(event, data, room=None):
        emitted.append((event, room))

    monkeypatch.setattr(sio, "emit", _fake_emit)

    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": conv["id"]},
            headers=_headers("d@example.com"),
        )
        request_id = create_res.json()["id"]

        emitted.clear()  # only care about the resolve-time emit, not create_request's fan-out

        resolve_res = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )

    assert resolve_res.status_code == 200
    resolved_rooms = [room for event, room in emitted if event == "request_resolved"]
    # b/c never became the requester and were never removed from the conversation, so both must
    # still hear about the resolution — not just d (the requester) or a (the resolver).
    assert user_room("b@example.com") in resolved_rooms
    assert user_room("c@example.com") in resolved_rooms
    assert user_room("d@example.com") in resolved_rooms
    # No duplicate emits to the same room.
    assert len(resolved_rooms) == len(set(resolved_rooms))


async def test_cancel_notifies_other_participant_not_just_requester(monkeypatch):
    """Same fan-out fix, for the cancel path: another participant's stale prompt must clear too."""
    conv = await _seed_group()  # participants: a, b, c

    emitted: list[tuple[str, str]] = []

    async def _fake_emit(event, data, room=None):
        emitted.append((event, room))

    monkeypatch.setattr(sio, "emit", _fake_emit)

    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": conv["id"]},
            headers=_headers("d@example.com"),
        )
        request_id = create_res.json()["id"]

        emitted.clear()

        cancel_res = await client.post(
            f"/requests/{request_id}/cancel",
            headers=_headers("d@example.com"),
        )

    assert cancel_res.status_code == 200
    cancelled_rooms = [room for event, room in emitted if event == "request_cancelled"]
    assert user_room("a@example.com") in cancelled_rooms
    assert user_room("b@example.com") in cancelled_rooms
    assert user_room("c@example.com") in cancelled_rooms
    assert user_room("d@example.com") in cancelled_rooms
    assert len(cancelled_rooms) == len(set(cancelled_rooms))


async def test_accept_dm_creates_group_and_leaves_dm_untouched():
    """Core Stage A fix: c asking to join a DM between a/b must form a NEW group conversation
    when accepted, never silently upgrade the DM in place — the original DM (same dm_key, same
    participants, same message history) must be untouched afterward."""
    dm = await _seed_dm()  # participants: a, b

    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": dm["id"]},
            headers=_headers("c@example.com"),
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )

    assert resolve_res.status_code == 200
    body = resolve_res.json()
    new_conversation_id = body["resultConversationId"]
    assert new_conversation_id is not None
    assert new_conversation_id != dm["id"]

    async with async_session_maker() as session:
        new_conv = await chat_repo.get_conversation_by_id(session, new_conversation_id)
        assert new_conv["type"] == "group"
        assert set(new_conv["participant_ids"]) == {"a@example.com", "b@example.com", "c@example.com"}

        original = await session.execute(select(Conversation).where(Conversation.id == dm["id"]))
        original_row = original.scalar_one()
        assert original_row.type == "dm"

        original_dm = await chat_repo.get_conversation_by_id(session, dm["id"])
        assert original_dm["type"] == "dm"
        assert set(original_dm["participant_ids"]) == {"a@example.com", "b@example.com"}
        assert original_row.dm_key == chat_repo.dm_key("a@example.com", "b@example.com")

        messages = await chat_repo.list_messages(session, dm["id"])
        assert any(m.text == "hello from a" for m in messages)

        c_in_dm = await chat_repo.is_participant(session, dm["id"], "c@example.com")
        assert c_in_dm is False


async def test_dm_upgrade_broadcasts_to_all_three(monkeypatch):
    dm = await _seed_dm()  # participants: a, b

    emitted: list[tuple[str, dict, str]] = []

    async def _fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(sio, "emit", _fake_emit)

    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": dm["id"]},
            headers=_headers("c@example.com"),
        )
        request_id = create_res.json()["id"]

        emitted.clear()

        resolve_res = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )

    assert resolve_res.status_code == 200
    group_id = resolve_res.json()["resultConversationId"]

    upgraded = [(data, room) for event, data, room in emitted if event == "conversation_upgraded"]
    upgraded_rooms = [room for _, room in upgraded]
    assert user_room("a@example.com") in upgraded_rooms
    assert user_room("b@example.com") in upgraded_rooms
    assert user_room("c@example.com") in upgraded_rooms
    assert len(upgraded_rooms) == len(set(upgraded_rooms))

    for data, _room in upgraded:
        assert data["oldConversationId"] == dm["id"]
        assert data["newConversationId"] == group_id
        assert set(data["participants"]) == {"a@example.com", "b@example.com", "c@example.com"}


async def test_dm_upgrade_migrates_connected_sids(monkeypatch):
    dm = await _seed_dm()  # participants: a, b

    fake_sids = {
        user_room("a@example.com"): [("sid-a", "eio-a")],
        user_room("b@example.com"): [("sid-b", "eio-b")],
        user_room("c@example.com"): [("sid-c", "eio-c")],
    }

    def _fake_get_participants(namespace, room):
        return iter(fake_sids.get(room, []))

    entered: list[tuple[str, str]] = []

    async def _fake_enter_room(sid, room, namespace="/"):
        entered.append((sid, room))

    async def _fake_emit(event, data, room=None):
        return None

    monkeypatch.setattr(sio.manager, "get_participants", _fake_get_participants)
    monkeypatch.setattr(sio, "enter_room", _fake_enter_room)
    monkeypatch.setattr(sio, "emit", _fake_emit)

    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": dm["id"]},
            headers=_headers("c@example.com"),
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )

    assert resolve_res.status_code == 200
    group_id = resolve_res.json()["resultConversationId"]

    entered_sids = {sid for sid, room in entered if room == group_id}
    assert entered_sids == {"sid-a", "sid-b", "sid-c"}


async def test_accept_group_add_still_uses_same_conversation(monkeypatch):
    """Accepting a join request against an already-existing 3+ person group must NOT create a
    new conversation and must NOT emit conversation_upgraded — the requester is simply added to
    the same group id."""
    conv = await _seed_group()  # participants: a, b, c

    emitted: list[tuple[str, str]] = []

    async def _fake_emit(event, data, room=None):
        emitted.append((event, room))

    monkeypatch.setattr(sio, "emit", _fake_emit)

    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": conv["id"]},
            headers=_headers("d@example.com"),
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )

    assert resolve_res.status_code == 200
    body = resolve_res.json()
    assert body["resultConversationId"] == conv["id"]

    async with async_session_maker() as session:
        is_participant = await chat_repo.is_participant(session, conv["id"], "d@example.com")
    assert is_participant is True

    upgraded_events = [event for event, _room in emitted if event == "conversation_upgraded"]
    assert upgraded_events == []


async def test_double_accept_dm_creates_only_one_group():
    """Two sequential accept attempts on the same pending request: the second must hit the
    already-resolved (409) path, and only ONE group conversation must exist for a/b/c."""
    dm = await _seed_dm()  # participants: a, b

    async with await _client() as client:
        create_res = await client.post(
            "/requests",
            json={"kind": "join_group", "conversationId": dm["id"]},
            headers=_headers("c@example.com"),
        )
        request_id = create_res.json()["id"]

        first = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )
        second = await client.post(
            f"/requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("b@example.com"),
        )

    assert first.status_code == 200
    assert second.status_code == 409

    group_id = first.json()["resultConversationId"]
    assert group_id is not None

    async with async_session_maker() as session:
        # The request's result_conversation_id never moved between the two attempts (the second
        # never got far enough to touch it) — confirm only one group with these exact members
        # exists, keyed off that id specifically rather than scanning every group conversation
        # in the (shared, cross-test) DB.
        full = await chat_repo.get_conversation_by_id(session, group_id)
        assert full["type"] == "group"
        assert set(full["participant_ids"]) == {"a@example.com", "b@example.com", "c@example.com"}

        final_request = await requests_repo.get_request_by_id(session, request_id)
        assert final_request["result_conversation_id"] == group_id
