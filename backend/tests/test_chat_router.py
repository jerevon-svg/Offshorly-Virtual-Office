from __future__ import annotations

import httpx
import pytest

from app.database import Base, engine
from app.main import fastapi_app

# Router-layer coverage for POST /conversations/group (the Global Chat "New Group Chat" manual
# creation flow) — mirrors test_requests_router.py's ASGITransport + x-dev-email pattern.

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


async def test_create_group_conversation_returns_new_group():
    async with await _client() as client:
        res = await client.post(
            "/conversations/group",
            json={"participantEmails": ["b@example.com", "c@example.com"]},
            headers=_headers("a@example.com"),
        )
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "group"
    assert sorted(body["participantIds"]) == ["a@example.com", "b@example.com", "c@example.com"]


async def test_create_group_conversation_is_idempotent_by_exact_member_set():
    async with await _client() as client:
        first = await client.post(
            "/conversations/group",
            json={"participantEmails": ["b@example.com", "c@example.com"]},
            headers=_headers("a@example.com"),
        )
        second = await client.post(
            "/conversations/group",
            json={"participantEmails": ["c@example.com", "b@example.com"]},
            headers=_headers("a@example.com"),
        )
    assert first.json()["id"] == second.json()["id"]


async def test_create_group_conversation_requires_at_least_two_unique_members():
    async with await _client() as client:
        res = await client.post(
            "/conversations/group",
            json={"participantEmails": []},
            headers=_headers("a@example.com"),
        )
    assert res.status_code == 400


# --- POST /conversations/{id}/read -------------------------------------------------------------
# The request session is autoflush=False (app/database.py), so mark_read's in-memory watermark
# change is invisible to unread_count's re-SELECT unless the router flushes first — without it the
# endpoint returned the PRE-read count. Mirrors the socket-layer fix in test_chat_socket.py.


async def _dm_with_one_unread_for_a() -> tuple[str, str]:
    """Fresh DM a<->peer with exactly one message FROM the peer (unread for a). The peer email is
    unique per call: the dm_key is deterministic and the test DB persists across runs, so reusing
    b@example.com would accumulate unread messages run over run. Returns (conversation id, peer)."""
    from uuid import uuid4

    from app.database import async_session_maker
    from app.repositories import chat as chat_repo

    peer = f"peer-{uuid4().hex[:12]}@example.com"
    async with await _client() as client:
        res = await client.post("/conversations", json={"peerEmail": peer}, headers=_headers("a@example.com"))
        assert res.status_code == 200
        conv_id = res.json()["id"]
    async with async_session_maker() as session:
        await chat_repo.insert_message(session, conv_id, peer, "hello a")
        await session.commit()
    return conv_id, peer


async def _unread_via_list(client: httpx.AsyncClient, email: str, conv_id: str) -> int:
    res = await client.get("/conversations", headers=_headers(email))
    assert res.status_code == 200
    return next(c["unreadCount"] for c in res.json() if c["id"] == conv_id)


async def test_mark_read_returns_authoritative_zero_immediately_and_persists_watermark():
    from datetime import datetime, timezone

    from app.database import async_session_maker
    from app.repositories import chat as chat_repo
    from app.schemas.chat import to_iso_z

    conv_id, peer = await _dm_with_one_unread_for_a()
    async with await _client() as client:
        assert await _unread_via_list(client, "a@example.com", conv_id) == 1

        res = await client.post(
            f"/conversations/{conv_id}/read",
            json={"upToSentAt": to_iso_z(datetime.now(timezone.utc))},
            headers=_headers("a@example.com"),
        )
        assert res.status_code == 200
        # Authoritative POST-read count in the same response — not the stale pre-read 1.
        assert res.json() == {"unreadCount": 0}

        # Watermark persisted (get_db commits): a fresh request and a fresh session both agree.
        assert await _unread_via_list(client, "a@example.com", conv_id) == 0
    async with async_session_maker() as session:
        assert await chat_repo.unread_count(session, conv_id, "a@example.com") == 0
        watermarks = await chat_repo.get_participant_watermarks(session, conv_id)
        assert watermarks["a@example.com"][1] is not None  # (last_delivered_at, last_read_at)
        # The peer's own watermark is untouched by a's read.
        assert watermarks[peer][1] is None


async def test_mark_read_rejects_non_participant_and_unauthenticated_without_touching_watermarks():
    from app.database import async_session_maker
    from app.repositories import chat as chat_repo

    conv_id, _peer = await _dm_with_one_unread_for_a()
    async with async_session_maker() as session:
        before = await chat_repo.get_participant_watermarks(session, conv_id)
    async with await _client() as client:
        forbidden = await client.post(f"/conversations/{conv_id}/read", headers=_headers("c@example.com"))
        assert forbidden.status_code == 403
        assert forbidden.json() == {"error": "Not a participant in this conversation"}

        unauth = await client.post(f"/conversations/{conv_id}/read")
        assert unauth.status_code == 401

        # a's unread is still 1 — neither rejected call advanced anyone's watermark.
        assert await _unread_via_list(client, "a@example.com", conv_id) == 1
    async with async_session_maker() as session:
        after = await chat_repo.get_participant_watermarks(session, conv_id)
    assert after == before
    assert "c@example.com" not in after
