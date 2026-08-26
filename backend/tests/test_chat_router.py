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
