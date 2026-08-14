from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.realtime.socket import _dev_email_from_auth
from app.repositories import chat as chat_repo

# Port of backend/src/socket.test.ts: real server + real socket.io client, exercising authz
# rejection and emit targeting (sender-only vs room-minus-sender vs per-recipient).

pytestmark = pytest.mark.asyncio


async def test_dev_bypass_gate_is_off_when_not_development():
    original = settings.APP_ENV
    try:
        settings.APP_ENV = "production"
        assert _dev_email_from_auth({"x-dev-email": "a@example.com"}) is None

        settings.APP_ENV = "development"
        assert _dev_email_from_auth({"x-dev-email": "A@Example.com"}) == "a@example.com"
    finally:
        settings.APP_ENV = original


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


async def _seeded_conversation():
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
        return conv["id"]


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def test_dev_bypass_authenticates_and_disconnects_cleanly(server):
    a = await _connect_as(server, "a@example.com")
    assert a.connected
    await a.disconnect()


async def test_send_message_emits_saved_to_sender_only_and_incoming_to_others(server):
    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    saved_future: asyncio.Future = asyncio.get_event_loop().create_future()
    incoming_future: asyncio.Future = asyncio.get_event_loop().create_future()
    a_got_incoming = False
    b_got_saved = False

    @a.on("message_saved")
    async def on_saved(data):
        if not saved_future.done():
            saved_future.set_result(data)

    @a.on("incoming_message")
    async def on_incoming_a(_data):
        nonlocal a_got_incoming
        a_got_incoming = True

    @b.on("incoming_message")
    async def on_incoming_b(data):
        if not incoming_future.done():
            incoming_future.set_result(data)

    @b.on("message_saved")
    async def on_saved_b(_data):
        nonlocal b_got_saved
        b_got_saved = True

    await a.emit("send_message", {"conversationId": conv_id, "text": "hi b", "clientTempId": "tmp-1"})

    saved = await asyncio.wait_for(saved_future, timeout=2)
    incoming = await asyncio.wait_for(incoming_future, timeout=2)

    assert saved["clientTempId"] == "tmp-1"
    assert saved["message"]["senderId"] == "a@example.com"
    assert incoming["message"]["senderId"] == "a@example.com"
    assert a_got_incoming is False
    assert b_got_saved is False

    await a.disconnect()
    await b.disconnect()


async def test_send_message_pushes_unread_count_to_recipient_only(server):
    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    unread_future: asyncio.Future = asyncio.get_event_loop().create_future()
    a_got_unread = False

    @b.on("unread_count")
    async def on_unread_b(data):
        if not unread_future.done():
            unread_future.set_result(data)

    @a.on("unread_count")
    async def on_unread_a(_data):
        nonlocal a_got_unread
        a_got_unread = True

    await a.emit("send_message", {"conversationId": conv_id, "text": "hi again", "clientTempId": "tmp-2"})

    payload = await asyncio.wait_for(unread_future, timeout=2)
    assert payload["conversationId"] == conv_id
    assert payload["count"] >= 1
    assert a_got_unread is False

    await a.disconnect()
    await b.disconnect()


async def test_send_message_from_non_participant_is_rejected(server):
    conv_id = await _seeded_conversation()
    c = await _connect_as(server, "c@example.com")

    err_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @c.on("chat_error")
    async def on_error(data):
        if not err_future.done():
            err_future.set_result(data)

    await c.emit("send_message", {"conversationId": conv_id, "text": "sneaky", "clientTempId": "tmp-3"})

    err = await asyncio.wait_for(err_future, timeout=2)
    assert err["code"] == "forbidden"

    await c.disconnect()
