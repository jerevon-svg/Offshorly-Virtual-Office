from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.repositories import chat as chat_repo

# Realtime half of message reactions — same real-server/real-client harness as
# test_chat_socket.py. Covers authorization, room targeting, and the no-op suppression.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]

    yield f"http://127.0.0.1:{port}"

    srv.should_exit = True
    await task
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def _seed_dm_with_message(text: str = "hi b"):
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
        message = await chat_repo.insert_message(session, conv["id"], "a@example.com", text)
        await session.commit()
        return conv["id"], message.id


def _future() -> asyncio.Future:
    return asyncio.get_event_loop().create_future()


async def test_reaction_reaches_every_participant_including_the_reactor(server):
    conv_id, message_id = await _seed_dm_with_message()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await a.emit("join_conversation", {"conversationId": conv_id})
    await b.emit("join_conversation", {"conversationId": conv_id})
    await asyncio.sleep(0.2)

    a_event, b_event = _future(), _future()

    @a.on("message_reaction")
    async def on_a(data):
        if not a_event.done():
            a_event.set_result(data)

    @b.on("message_reaction")
    async def on_b(data):
        if not b_event.done():
            b_event.set_result(data)

    await b.emit("add_reaction", {"messageId": message_id, "emoji": "👍"})

    # Unlike incoming_message (which skips the sender), a reaction echoes back to the reactor
    # too — there is no optimistic local apply, so the reactor needs the echo to render.
    got_b = await asyncio.wait_for(b_event, timeout=2)
    got_a = await asyncio.wait_for(a_event, timeout=2)

    for got in (got_a, got_b):
        assert got == {
            "messageId": message_id,
            "emoji": "👍",
            "reactorEmail": "b@example.com",
            "action": "add",
        }

    await a.disconnect()
    await b.disconnect()


async def test_reaction_survives_history_reload(server):
    conv_id, message_id = await _seed_dm_with_message()

    b = await _connect_as(server, "b@example.com")
    await b.emit("join_conversation", {"conversationId": conv_id})
    await asyncio.sleep(0.2)

    done = _future()

    @b.on("message_reaction")
    async def on_b(data):
        if not done.done():
            done.set_result(data)

    await b.emit("add_reaction", {"messageId": message_id, "emoji": "🎉"})
    await asyncio.wait_for(done, timeout=2)

    # Fresh session, as a refresh/reconnect would do.
    async with async_session_maker() as session:
        groups = await chat_repo.get_reactions_for_message(session, message_id)
    assert groups == [{"emoji": "🎉", "count": 1, "reactors": ["b@example.com"]}]

    await b.disconnect()


async def test_reactor_identity_comes_from_the_session_not_the_payload(server):
    conv_id, message_id = await _seed_dm_with_message()

    b = await _connect_as(server, "b@example.com")
    await b.emit("join_conversation", {"conversationId": conv_id})
    await asyncio.sleep(0.2)

    got = _future()

    @b.on("message_reaction")
    async def on_b(data):
        if not got.done():
            got.set_result(data)

    # A client trying to attribute its reaction to someone else.
    await b.emit(
        "add_reaction",
        {"messageId": message_id, "emoji": "👍", "reactorEmail": "a@example.com"},
    )
    event = await asyncio.wait_for(got, timeout=2)

    assert event["reactorEmail"] == "b@example.com"
    async with async_session_maker() as session:
        groups = await chat_repo.get_reactions_for_message(session, message_id)
    assert groups[0]["reactors"] == ["b@example.com"]

    await b.disconnect()


async def test_non_participant_is_rejected_and_nothing_persists(server):
    _conv_id, message_id = await _seed_dm_with_message()

    outsider = await _connect_as(server, "c@example.com")
    await asyncio.sleep(0.2)

    err = _future()

    @outsider.on("chat_error")
    async def on_err(data):
        if not err.done():
            err.set_result(data)

    await outsider.emit("add_reaction", {"messageId": message_id, "emoji": "👍"})
    payload = await asyncio.wait_for(err, timeout=2)

    assert payload["code"] == "forbidden"
    async with async_session_maker() as session:
        assert await chat_repo.get_reactions_for_message(session, message_id) == []

    await outsider.disconnect()


async def test_remove_reaction_is_authorized_the_same_way(server):
    _conv_id, message_id = await _seed_dm_with_message()
    async with async_session_maker() as session:
        await chat_repo.add_reaction(session, message_id, "b@example.com", "👍")
        await session.commit()

    outsider = await _connect_as(server, "c@example.com")
    await asyncio.sleep(0.2)

    err = _future()

    @outsider.on("chat_error")
    async def on_err(data):
        if not err.done():
            err.set_result(data)

    await outsider.emit("remove_reaction", {"messageId": message_id, "emoji": "👍"})
    assert (await asyncio.wait_for(err, timeout=2))["code"] == "forbidden"

    # B's reaction is untouched by the rejected attempt.
    async with async_session_maker() as session:
        groups = await chat_repo.get_reactions_for_message(session, message_id)
    assert groups == [{"emoji": "👍", "count": 1, "reactors": ["b@example.com"]}]

    await outsider.disconnect()


async def test_unknown_message_and_unsupported_emoji_are_rejected(server):
    conv_id, message_id = await _seed_dm_with_message()

    b = await _connect_as(server, "b@example.com")
    await b.emit("join_conversation", {"conversationId": conv_id})
    await asyncio.sleep(0.2)

    errors: list[dict] = []

    @b.on("chat_error")
    async def on_err(data):
        errors.append(data)

    await b.emit("add_reaction", {"messageId": "no-such-message", "emoji": "👍"})
    await b.emit("add_reaction", {"messageId": message_id, "emoji": "🦄"})
    await b.emit("add_reaction", {"messageId": message_id})
    await asyncio.sleep(0.4)

    # Compared as a multiset, not a sequence: the three handlers run as concurrent tasks and
    # the not_found path awaits a DB round-trip while the two validation paths short-circuit
    # before touching the DB, so response arrival order is legitimately non-deterministic.
    assert sorted(e["code"] for e in errors) == ["invalid_reaction", "invalid_reaction", "not_found"]
    async with async_session_maker() as session:
        assert await chat_repo.get_reactions_for_message(session, message_id) == []

    await b.disconnect()


async def test_duplicate_add_broadcasts_once(server):
    conv_id, message_id = await _seed_dm_with_message()

    b = await _connect_as(server, "b@example.com")
    await b.emit("join_conversation", {"conversationId": conv_id})
    await asyncio.sleep(0.2)

    events: list[dict] = []

    @b.on("message_reaction")
    async def on_b(data):
        events.append(data)

    await b.emit("add_reaction", {"messageId": message_id, "emoji": "👍"})
    await asyncio.sleep(0.3)
    # A double-click: already-true end state, so the server stays silent rather than emitting
    # a phantom change.
    await b.emit("add_reaction", {"messageId": message_id, "emoji": "👍"})
    await asyncio.sleep(0.4)

    assert len(events) == 1
    async with async_session_maker() as session:
        groups = await chat_repo.get_reactions_for_message(session, message_id)
    assert groups == [{"emoji": "👍", "count": 1, "reactors": ["b@example.com"]}]

    await b.disconnect()


async def test_reacting_does_not_push_unread_or_mention_counts(server):
    conv_id, message_id = await _seed_dm_with_message()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await a.emit("join_conversation", {"conversationId": conv_id})
    await b.emit("join_conversation", {"conversationId": conv_id})
    await asyncio.sleep(0.2)

    counter_events: list[str] = []
    reaction_seen = _future()

    @a.on("unread_count")
    async def on_unread(_data):
        counter_events.append("unread_count")

    @a.on("mention_count")
    async def on_mention(_data):
        counter_events.append("mention_count")

    @a.on("message_reaction")
    async def on_reaction(data):
        if not reaction_seen.done():
            reaction_seen.set_result(data)

    await b.emit("add_reaction", {"messageId": message_id, "emoji": "👍"})
    await asyncio.wait_for(reaction_seen, timeout=2)
    await asyncio.sleep(0.3)

    # The reaction arrived, and NO counter event rode along with it.
    assert counter_events == []

    await a.disconnect()
    await b.disconnect()
