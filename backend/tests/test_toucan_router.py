from __future__ import annotations

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.toucan import ToucanConversation, ToucanMessage
from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.services.position_registry import position_registry
from app.services.toucan.office_assistant import FALLBACK_TEXT

# Router-layer coverage for POST /toucan/ask — mirrors tests/test_talk_requests_router.py's
# conventions (ASGITransport client, x-dev-email dev-bypass identity).

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _fresh_state(isolated_app_db):
    # `isolated_app_db` FIRST, and it is not optional: it repoints the application at a
    # throwaway database before anything below runs. Without it the truncations here would
    # execute against the developer's real virtual_office_fastapi.db (see tests/conftest.py).
    # T1 persists every exchange, so this file now touches the DB. Tables are cleared (not just
    # created — create_all is a no-op on an existing table) so a conversation written by an
    # earlier test never shows up as another test's "latest".
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(ToucanMessage.__table__.delete())
        await conn.execute(ToucanConversation.__table__.delete())

    def clear():
        offline_lineup._slot_by_email.clear()
        dnd_registry._dnd_emails.clear()
        room_presence._room_by_email.clear()
        spatial_sessions.reset()
        call_registry.reset()
        position_registry.reset()

    clear()
    yield
    clear()


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def test_ask_requires_authentication():
    async with await _client() as client:
        res = await client.post("/toucan/ask", json={"question": "who is online"})
    assert res.status_code == 401


async def test_ask_returns_the_answer_contract():
    room_presence.enter("angelo@example.com", "ai-room")
    async with await _client() as client:
        res = await client.post(
            "/toucan/ask", json={"question": "who is in this room"}, headers=_headers("angelo@example.com")
        )
    assert res.status_code == 200
    body = res.json()
    # T1 adds conversationId — the id of the conversation the exchange was persisted into.
    assert set(body) == {"text", "intent", "supported", "conversationId"}
    assert isinstance(body["conversationId"], str) and body["conversationId"]
    assert body["intent"] == "room_occupants"
    assert body["supported"] is True
    assert isinstance(body["text"], str) and body["text"]


async def test_unsupported_question_returns_the_fallback():
    async with await _client() as client:
        res = await client.post(
            "/toucan/ask",
            json={"question": "write me a reply to this"},
            headers=_headers("angelo@example.com"),
        )
    body = res.json()
    assert {k: v for k, v in body.items() if k != "conversationId"} == {
        "text": FALLBACK_TEXT,
        "intent": "unsupported",
        "supported": False,
    }


async def test_identity_comes_from_auth_not_the_body():
    """Same body, two callers: the answer must differ because the context is scoped to the
    authenticated caller, never to anything the body says."""
    room_presence.enter("angelo@example.com", "ai-room")
    room_presence.enter("micah@example.com", "design-team")
    async with await _client() as client:
        as_angelo = await client.post(
            "/toucan/ask", json={"question": "who is in this room"}, headers=_headers("angelo@example.com")
        )
        as_micah = await client.post(
            "/toucan/ask", json={"question": "who is in this room"}, headers=_headers("micah@example.com")
        )
    assert "AI Room" in as_angelo.json()["text"]
    assert "Design Team" in as_micah.json()["text"]


async def test_body_cannot_impersonate_another_employee():
    """An identity field in the body is rejected outright (extra="forbid"), so impersonation
    fails loudly instead of being silently ignored."""
    room_presence.enter("micah@example.com", "design-team")
    async with await _client() as client:
        for field in ("email", "viewerEmail", "viewer_email", "as", "user"):
            res = await client.post(
                "/toucan/ask",
                json={"question": "who is in this room", field: "micah@example.com"},
                headers=_headers("angelo@example.com"),
            )
            assert res.status_code == 422, field


async def test_history_is_accepted_and_bounded():
    turn = {"role": "user", "text": "hello"}
    async with await _client() as client:
        ok = await client.post(
            "/toucan/ask",
            json={"question": "who is online", "history": [turn, {"role": "toucan", "text": "hi"}]},
            headers=_headers("angelo@example.com"),
        )
        too_long = await client.post(
            "/toucan/ask",
            json={"question": "who is online", "history": [turn] * 11},
            headers=_headers("angelo@example.com"),
        )
        bad_role = await client.post(
            "/toucan/ask",
            json={"question": "who is online", "history": [{"role": "system", "text": "x"}]},
            headers=_headers("angelo@example.com"),
        )
    assert ok.status_code == 200
    assert too_long.status_code == 422
    assert bad_role.status_code == 422


async def test_question_is_bounded():
    async with await _client() as client:
        empty = await client.post(
            "/toucan/ask", json={"question": ""}, headers=_headers("angelo@example.com")
        )
        huge = await client.post(
            "/toucan/ask", json={"question": "a" * 2001}, headers=_headers("angelo@example.com")
        )
    assert empty.status_code == 422
    assert huge.status_code == 422
