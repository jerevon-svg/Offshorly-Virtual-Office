from __future__ import annotations

import httpx
import pytest

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.repositories import chat as chat_repo

# History serialization for reactions — same ASGITransport + x-dev-email harness as
# test_chat_router.py. Proves the GET /conversations/{id}/messages payload carries grouped
# reactions, and that pre-existing text-only messages still come back with reactions: [].

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _fresh_schema():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    settings.APP_ENV = original_env


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def test_history_returns_grouped_reactions_and_empty_list_for_unreacted():
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
        reacted = await chat_repo.insert_message(session, conv["id"], "a@example.com", "react to me")
        plain = await chat_repo.insert_message(session, conv["id"], "a@example.com", "plain")
        await session.commit()
        await chat_repo.add_reaction(session, reacted.id, "b@example.com", "👍")
        await chat_repo.add_reaction(session, reacted.id, "a@example.com", "👍")
        await chat_repo.add_reaction(session, reacted.id, "b@example.com", "🎉")
        await session.commit()

    async with await _client() as client:
        res = await client.get(
            f"/conversations/{conv['id']}/messages", headers=_headers("a@example.com")
        )

    assert res.status_code == 200
    by_id = {m["id"]: m for m in res.json()}

    assert by_id[reacted.id]["reactions"] == [
        {"emoji": "👍", "count": 2, "reactors": ["a@example.com", "b@example.com"]},
        {"emoji": "🎉", "count": 1, "reactors": ["b@example.com"]},
    ]
    # A message nobody reacted to — the backward-compatibility case every pre-feature row hits.
    assert by_id[plain.id]["reactions"] == []


async def test_history_for_a_conversation_with_no_reactions_at_all_is_unchanged():
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
        await chat_repo.insert_message(session, conv["id"], "a@example.com", "hello")
        await session.commit()

    async with await _client() as client:
        res = await client.get(
            f"/conversations/{conv['id']}/messages", headers=_headers("b@example.com")
        )

    body = res.json()
    assert len(body) == 1
    assert body[0]["reactions"] == []
    # The rest of the established wire shape is untouched.
    assert body[0]["text"] == "hello"
    assert body[0]["mentionedEmails"] == []
    assert body[0]["deliveredTo"] == []
    assert body[0]["readBy"] == []


async def test_non_participant_cannot_read_history_or_its_reactions():
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
        msg = await chat_repo.insert_message(session, conv["id"], "a@example.com", "private")
        await session.commit()
        await chat_repo.add_reaction(session, msg.id, "b@example.com", "👍")
        await session.commit()

    async with await _client() as client:
        res = await client.get(
            f"/conversations/{conv['id']}/messages", headers=_headers("c@example.com")
        )

    assert res.status_code == 403


async def test_reactions_do_not_bump_the_conversation_list_ordering():
    """last_message_at drives GET /conversations ordering — a reaction on an older conversation
    must not float it above a newer one."""
    async with async_session_maker() as session:
        older = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
        old_msg = await chat_repo.insert_message(session, older["id"], "a@example.com", "old")
        await chat_repo.touch_conversation(session, older["id"], old_msg.sent_at)
        await session.commit()

        newer = await chat_repo.create_group_conversation(
            session, "a@example.com", ["b@example.com", "c@example.com"], "Newer"
        )
        new_msg = await chat_repo.insert_message(session, newer["id"], "a@example.com", "new")
        await chat_repo.touch_conversation(session, newer["id"], new_msg.sent_at)
        await session.commit()

        await chat_repo.add_reaction(session, old_msg.id, "b@example.com", "👍")
        await session.commit()

    async with await _client() as client:
        res = await client.get("/conversations", headers=_headers("a@example.com"))

    ordering = [c["id"] for c in res.json()]
    assert ordering.index(newer["id"]) < ordering.index(older["id"])
    # And the reaction produced no unread for anyone.
    assert all(c["unreadCount"] == 0 for c in res.json() if c["id"] == older["id"])
