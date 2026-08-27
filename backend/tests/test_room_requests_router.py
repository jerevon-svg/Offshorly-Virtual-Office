from __future__ import annotations

import httpx
import pytest

from app.database import Base, engine
from app.main import fastapi_app
from app.realtime.socket import dnd_registry, room_presence, sio

# Router-layer coverage for the "Request Entry / Knock" REST endpoints — mirrors
# tests/test_requests_router.py's conventions. Authorization here is against the ephemeral
# RoomPresenceRegistry/DndRegistry singletons (app/realtime/socket.py), not conversation
# membership, so each test seeds those directly rather than a DB-backed conversation.

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _fresh_state():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    room_presence._room_by_email.clear()
    dnd_registry._dnd_emails.clear()
    yield
    room_presence._room_by_email.clear()
    dnd_registry._dnd_emails.clear()


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


def _lock_room(room_id: str, occupant_email: str) -> None:
    room_presence.enter(occupant_email, room_id)
    dnd_registry.set_dnd(occupant_email, True)


async def test_create_request_against_unlocked_room_returns_400():
    async with await _client() as client:
        res = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )
    assert res.status_code == 400


async def test_create_request_against_locked_room_returns_201():
    _lock_room("design-team", "occupant@example.com")

    async with await _client() as client:
        res = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )

    assert res.status_code == 201
    body = res.json()
    assert body["roomId"] == "design-team"
    assert body["state"] == "pending"
    assert body["requesterEmail"] == "outsider@example.com"


async def test_duplicate_pending_request_returns_same_id():
    _lock_room("design-team", "occupant@example.com")

    async with await _client() as client:
        first = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )
        second = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )

    assert first.json()["id"] == second.json()["id"]


async def test_resolve_by_non_dnd_occupant_returns_403():
    _lock_room("design-team", "occupant@example.com")

    async with await _client() as client:
        create_res = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/room-requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("bystander@example.com"),
        )
    assert resolve_res.status_code == 403


async def test_resolve_accept_by_dnd_occupant_succeeds():
    _lock_room("design-team", "occupant@example.com")

    async with await _client() as client:
        create_res = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/room-requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("occupant@example.com"),
        )

    assert resolve_res.status_code == 200
    body = resolve_res.json()
    assert body["state"] == "accepted"
    assert body["resolverEmail"] == "occupant@example.com"


async def test_double_resolve_returns_409():
    _lock_room("design-team", "occupant@example.com")
    room_presence.enter("occupant2@example.com", "design-team")
    dnd_registry.set_dnd("occupant2@example.com", True)

    async with await _client() as client:
        create_res = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )
        request_id = create_res.json()["id"]

        first = await client.post(
            f"/room-requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("occupant@example.com"),
        )
        second = await client.post(
            f"/room-requests/{request_id}/resolve",
            json={"decision": "decline"},
            headers=_headers("occupant2@example.com"),
        )

    assert first.status_code == 200
    assert second.status_code == 409


async def test_resolve_notifies_requester_and_all_occupants(monkeypatch):
    _lock_room("design-team", "occupant@example.com")
    room_presence.enter("occupant2@example.com", "design-team")
    dnd_registry.set_dnd("occupant2@example.com", True)

    emitted: list[tuple[str, str]] = []

    async def _fake_emit(event, data, room=None):
        emitted.append((event, room))

    monkeypatch.setattr(sio, "emit", _fake_emit)

    async with await _client() as client:
        create_res = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )
        request_id = create_res.json()["id"]
        emitted.clear()

        resolve_res = await client.post(
            f"/room-requests/{request_id}/resolve",
            json={"decision": "decline"},
            headers=_headers("occupant@example.com"),
        )

    assert resolve_res.status_code == 200
    from app.realtime.socket import user_room

    resolved_rooms = [room for event, room in emitted if event == "room_request_resolved"]
    assert user_room("outsider@example.com") in resolved_rooms
    assert user_room("occupant@example.com") in resolved_rooms
    assert user_room("occupant2@example.com") in resolved_rooms


async def test_cancel_only_by_requester():
    _lock_room("design-team", "occupant@example.com")

    async with await _client() as client:
        create_res = await client.post(
            "/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com")
        )
        request_id = create_res.json()["id"]

        wrong = await client.post(f"/room-requests/{request_id}/cancel", headers=_headers("occupant@example.com"))
        assert wrong.status_code == 403

        right = await client.post(f"/room-requests/{request_id}/cancel", headers=_headers("outsider@example.com"))
        assert right.status_code == 200
        assert right.json()["state"] == "cancelled"


async def test_pending_endpoint_scopes_to_callers_current_room():
    _lock_room("design-team", "occupant@example.com")
    room_presence.enter("elsewhere@example.com", "dev-team")

    async with await _client() as client:
        await client.post("/room-requests", json={"roomId": "design-team"}, headers=_headers("outsider@example.com"))

        in_room = await client.get("/room-requests/pending", headers=_headers("occupant@example.com"))
        not_in_any_room = await client.get("/room-requests/pending", headers=_headers("elsewhere@example.com"))

    assert len(in_room.json()) == 1
    assert in_room.json()[0]["roomId"] == "design-team"
    assert not_in_any_room.json() == []
