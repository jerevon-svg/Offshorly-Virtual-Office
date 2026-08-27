from __future__ import annotations

import asyncio
from datetime import datetime, timezone

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


async def test_send_message_with_mention_persists_and_pushes_mention_count_to_mentioned_recipient(server):
    conv_id = await _seeded_conversation()  # participants: a, b

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    saved_future: asyncio.Future = asyncio.get_event_loop().create_future()
    mention_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @a.on("message_saved")
    async def on_saved(data):
        if not saved_future.done():
            saved_future.set_result(data)

    @b.on("mention_count")
    async def on_mention(data):
        if not mention_future.done():
            mention_future.set_result(data)

    await a.emit(
        "send_message",
        {
            "conversationId": conv_id,
            "text": "hey @b",
            "clientTempId": "tmp-mention",
            "mentionedEmails": ["b@example.com"],
        },
    )

    saved = await asyncio.wait_for(saved_future, timeout=2)
    assert saved["message"]["mentionedEmails"] == ["b@example.com"]

    mention_payload = await asyncio.wait_for(mention_future, timeout=2)
    assert mention_payload["conversationId"] == conv_id
    # Same ">= 1" convention as the sibling unread_count test above — this file's tests share a
    # persistent DM conversation (dm_key upsert is idempotent across the whole suite/db), so an
    # exact count would be brittle against other tests' accumulated messages in the same DM.
    assert mention_payload["count"] >= 1

    await a.disconnect()
    await b.disconnect()


async def test_send_message_without_mention_does_not_push_mention_count(server):
    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    got_mention_event = False

    @b.on("mention_count")
    async def on_mention(_data):
        nonlocal got_mention_event
        got_mention_event = True

    unread_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("unread_count")
    async def on_unread(data):
        if not unread_future.done():
            unread_future.set_result(data)

    await a.emit("send_message", {"conversationId": conv_id, "text": "no mention", "clientTempId": "tmp-3"})
    await asyncio.wait_for(unread_future, timeout=2)  # confirms the send round-trip completed
    await asyncio.sleep(0.1)

    assert got_mention_event is False

    await a.disconnect()
    await b.disconnect()


async def test_message_delivered_updates_watermark_and_emits_to_peer_only(server):
    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    async with async_session_maker() as session:
        msg = await chat_repo.insert_message(session, conv_id, "b@example.com", "hi a")
        await chat_repo.touch_conversation(session, conv_id, msg.sent_at)
        await session.commit()
        sent_at_iso = msg.sent_at

    receipt_future: asyncio.Future = asyncio.get_event_loop().create_future()
    a_got_receipt = False

    @b.on("delivery_receipt")
    async def on_receipt_b(data):
        if not receipt_future.done():
            receipt_future.set_result(data)

    @a.on("delivery_receipt")
    async def on_receipt_a(_data):
        nonlocal a_got_receipt
        a_got_receipt = True

    from app.schemas.chat import to_iso_z

    await a.emit(
        "message_delivered", {"conversationId": conv_id, "upToSentAt": to_iso_z(sent_at_iso)}
    )

    payload = await asyncio.wait_for(receipt_future, timeout=2)
    assert payload["conversationId"] == conv_id
    assert a_got_receipt is False

    async with async_session_maker() as session:
        watermarks = await chat_repo.get_participant_watermarks(session, conv_id)
        delivered_at, _ = watermarks["a@example.com"]
        assert delivered_at is not None

    await a.disconnect()
    await b.disconnect()


async def test_message_read_emits_unread_count_to_self_and_read_receipt_to_peer(server):
    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    a2 = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    unread_future: asyncio.Future = asyncio.get_event_loop().create_future()
    read_receipt_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @a2.on("unread_count")
    async def on_unread_a2(data):
        if not unread_future.done():
            unread_future.set_result(data)

    @b.on("read_receipt")
    async def on_read_receipt_b(data):
        if not read_receipt_future.done():
            read_receipt_future.set_result(data)

    # Wall-clock "now" rather than a fixed literal: the (a, b) conversation is deterministic
    # (dm_key-based) and the test DB persists across runs, so mark_read's monotonic-advance
    # guard (app/repositories/chat.py) would make a fixed past timestamp a no-op — and thus emit
    # no read_receipt at all — on any run after the first.
    from app.schemas.chat import to_iso_z

    up_to_sent_at = to_iso_z(datetime.now(timezone.utc))
    await a.emit("message_read", {"conversationId": conv_id, "upToSentAt": up_to_sent_at})

    unread_payload = await asyncio.wait_for(unread_future, timeout=2)
    read_receipt_payload = await asyncio.wait_for(read_receipt_future, timeout=2)
    assert unread_payload["conversationId"] == conv_id
    assert read_receipt_payload["conversationId"] == conv_id
    assert read_receipt_payload["readUpTo"] == up_to_sent_at

    await a.disconnect()
    await a2.disconnect()
    await b.disconnect()


async def test_message_delivered_from_non_participant_is_rejected_and_no_watermark_change(server):
    conv_id = await _seeded_conversation()
    c = await _connect_as(server, "c@example.com")

    err_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @c.on("chat_error")
    async def on_error(data):
        if not err_future.done():
            err_future.set_result(data)

    await c.emit(
        "message_delivered", {"conversationId": conv_id, "upToSentAt": "2026-01-01T00:00:00.000Z"}
    )

    err = await asyncio.wait_for(err_future, timeout=2)
    assert err["code"] == "forbidden"

    async with async_session_maker() as session:
        watermarks = await chat_repo.get_participant_watermarks(session, conv_id)
        assert "c@example.com" not in watermarks

    await c.disconnect()


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


async def test_typing_broadcasts_to_peer_only_with_server_verified_sender(server):
    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    peer_typing_future: asyncio.Future = asyncio.get_event_loop().create_future()
    a_got_peer_typing = False

    @b.on("peer_typing")
    async def on_peer_typing_b(data):
        if not peer_typing_future.done():
            peer_typing_future.set_result(data)

    @a.on("peer_typing")
    async def on_peer_typing_a(_data):
        nonlocal a_got_peer_typing
        a_got_peer_typing = True

    await a.emit("typing", {"conversationId": conv_id, "isTyping": True})

    payload = await asyncio.wait_for(peer_typing_future, timeout=2)
    assert payload["conversationId"] == conv_id
    assert payload["senderEmail"] == "a@example.com"
    assert payload["isTyping"] is True
    assert a_got_peer_typing is False

    await a.disconnect()
    await b.disconnect()


async def test_typing_from_non_participant_is_rejected_and_not_broadcast(server):
    conv_id = await _seeded_conversation()
    a = await _connect_as(server, "a@example.com")
    c = await _connect_as(server, "c@example.com")
    await asyncio.sleep(0.2)

    err_future: asyncio.Future = asyncio.get_event_loop().create_future()
    a_got_peer_typing = False

    @c.on("chat_error")
    async def on_error(data):
        if not err_future.done():
            err_future.set_result(data)

    @a.on("peer_typing")
    async def on_peer_typing_a(_data):
        nonlocal a_got_peer_typing
        a_got_peer_typing = True

    await c.emit("typing", {"conversationId": conv_id, "isTyping": True})

    err = await asyncio.wait_for(err_future, timeout=2)
    assert err["code"] == "forbidden"
    await asyncio.sleep(0.2)
    assert a_got_peer_typing is False

    await a.disconnect()
    await c.disconnect()
