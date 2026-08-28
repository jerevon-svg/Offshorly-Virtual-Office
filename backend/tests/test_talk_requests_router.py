from __future__ import annotations

import httpx
import pytest

from app.database import Base, engine
from app.main import fastapi_app
from app.models.talk_request import TalkRequest
from app.realtime.socket import dnd_registry, sio

# Router-layer coverage for "Request Permission to Talk" — mirrors
# tests/test_room_requests_router.py's conventions.
#
# UNLIKE room_requests's tests, the cooldown check here matches on (target_email,
# requester_email) regardless of state — a stale DECLINED row from an earlier test in this file
# would otherwise wrongly 429 a later test reusing the same pair. Explicitly clear the table
# (not just create_all, which is a no-op on an already-existing table) each test for isolation.

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _fresh_state():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(TalkRequest.__table__.delete())
    dnd_registry._dnd_emails.clear()
    yield
    dnd_registry._dnd_emails.clear()


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def test_create_request_against_a_non_dnd_target_returns_400():
    async with await _client() as client:
        res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
    assert res.status_code == 400


async def test_create_request_against_self_returns_400():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("a@example.com")
        )
    assert res.status_code == 400


async def test_create_request_against_dnd_target_returns_201():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com", "kind": "chat"}, headers=_headers("b@example.com")
        )
    assert res.status_code == 201
    body = res.json()
    assert body["targetEmail"] == "a@example.com"
    assert body["requesterEmail"] == "b@example.com"
    assert body["kind"] == "chat"
    assert body["state"] == "pending"


async def test_duplicate_pending_request_returns_same_id():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        first = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
        second = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
    assert first.json()["id"] == second.json()["id"]


async def test_resolve_by_non_target_returns_403():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        create_res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/talk-requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("bystander@example.com"),
        )
    assert resolve_res.status_code == 403


async def test_resolve_accept_by_target_succeeds():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        create_res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
        request_id = create_res.json()["id"]

        resolve_res = await client.post(
            f"/talk-requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )
    assert resolve_res.status_code == 200
    assert resolve_res.json()["state"] == "accepted"


async def test_decline_then_immediate_retry_returns_429_with_cooldown_until():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        create_res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
        request_id = create_res.json()["id"]

        await client.post(
            f"/talk-requests/{request_id}/resolve",
            json={"decision": "decline"},
            headers=_headers("a@example.com"),
        )

        retry_res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
    assert retry_res.status_code == 429
    assert "cooldownUntil" in retry_res.json()


async def test_double_resolve_returns_409():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        create_res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
        request_id = create_res.json()["id"]

        first = await client.post(
            f"/talk-requests/{request_id}/resolve",
            json={"decision": "accept"},
            headers=_headers("a@example.com"),
        )
        second = await client.post(
            f"/talk-requests/{request_id}/resolve",
            json={"decision": "decline"},
            headers=_headers("a@example.com"),
        )
    assert first.status_code == 200
    assert second.status_code == 409


async def test_resolve_notifies_requester_and_target(monkeypatch):
    dnd_registry.set_dnd("a@example.com", True)

    emitted: list[tuple[str, str]] = []

    async def _fake_emit(event, data, room=None):
        emitted.append((event, room))

    monkeypatch.setattr(sio, "emit", _fake_emit)

    async with await _client() as client:
        create_res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
        request_id = create_res.json()["id"]
        emitted.clear()

        resolve_res = await client.post(
            f"/talk-requests/{request_id}/resolve",
            json={"decision": "decline"},
            headers=_headers("a@example.com"),
        )

    assert resolve_res.status_code == 200
    from app.realtime.socket import user_room

    resolved_rooms = [room for event, room in emitted if event == "talk_request_resolved"]
    assert user_room("a@example.com") in resolved_rooms
    assert user_room("b@example.com") in resolved_rooms


async def test_cancel_only_by_requester():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        create_res = await client.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com")
        )
        request_id = create_res.json()["id"]

        wrong = await client.post(f"/talk-requests/{request_id}/cancel", headers=_headers("a@example.com"))
        assert wrong.status_code == 403

        right = await client.post(f"/talk-requests/{request_id}/cancel", headers=_headers("b@example.com"))
        assert right.status_code == 200
        assert right.json()["state"] == "cancelled"


async def test_pending_endpoint_scopes_to_target():
    dnd_registry.set_dnd("a@example.com", True)
    async with await _client() as client:
        await client.post("/talk-requests", json={"targetEmail": "a@example.com"}, headers=_headers("b@example.com"))

        target_view = await client.get("/talk-requests/pending", headers=_headers("a@example.com"))
        requester_view = await client.get("/talk-requests/pending", headers=_headers("b@example.com"))

    assert len(target_view.json()) == 1
    assert requester_view.json() == []
