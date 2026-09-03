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
    assert payload == {
        "conversationId": conv_id,
        "deliveredUpTo": to_iso_z(sent_at_iso),
        "recipientEmail": "a@example.com",  # server-verified acker identity
    }
    assert a_got_receipt is False

    async with async_session_maker() as session:
        watermarks = await chat_repo.get_participant_watermarks(session, conv_id)
        delivered_at, _ = watermarks["a@example.com"]
        assert delivered_at is not None

    await a.disconnect()
    await b.disconnect()


async def test_message_read_emits_counts_to_every_own_socket_and_read_receipt_to_peer(server):
    """After message_read, the authoritative unread_count/mention_count go to EVERY socket of the
    reader — the marking socket itself (its badge has no local decrement; see frontend
    useUnreadTotal) AND the reader's other sockets — while the peer gets a read_receipt."""
    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    a2 = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    # Collect EVERY count event per socket (not just the first): the shared test DB/deterministic
    # dm_key means straggler pushes from earlier tests' sends can still land on a fresh socket in
    # this user's room. What matters is the LAST state each socket was told after the read.
    counts: dict[tuple[str, str], list] = {
        ("a", "unread_count"): [],
        ("a", "mention_count"): [],
        ("a2", "unread_count"): [],
        ("a2", "mention_count"): [],
    }
    read_receipts: list = []
    b_count_events: list = []

    def _collect(key):
        async def handler(data):
            counts[key].append(data)

        return handler

    a.on("unread_count", _collect(("a", "unread_count")))
    a.on("mention_count", _collect(("a", "mention_count")))
    a2.on("unread_count", _collect(("a2", "unread_count")))
    a2.on("mention_count", _collect(("a2", "mention_count")))

    @b.on("read_receipt")
    async def on_read_receipt_b(data):
        read_receipts.append(data)

    @b.on("unread_count")
    async def on_unread_b(data):
        b_count_events.append(data)

    # Let any straggler pushes from earlier tests flush, then start counting from a clean slate.
    await asyncio.sleep(0.3)
    for events in counts.values():
        events.clear()

    # Wall-clock "now" rather than a fixed literal: the (a, b) conversation is deterministic
    # (dm_key-based) and the test DB persists across runs, so mark_read's monotonic-advance
    # guard (app/repositories/chat.py) would make a fixed past timestamp a no-op — and thus emit
    # no read_receipt at all — on any run after the first.
    from app.schemas.chat import to_iso_z

    up_to_sent_at = to_iso_z(datetime.now(timezone.utc))
    await a.emit("message_read", {"conversationId": conv_id, "upToSentAt": up_to_sent_at})
    await asyncio.sleep(0.5)

    # Marking socket AND the reader's other socket both receive both counts, and the final
    # state each was told is zero: the watermark was just advanced to "now".
    for key, events in counts.items():
        assert events, f"{key} received no count push after message_read"
        assert events[-1] == {"conversationId": conv_id, "count": 0}, (key, events)
    # Peer keeps its existing read_receipt, and is never told about a's counts.
    assert read_receipts, "peer received no read_receipt"
    assert read_receipts[-1] == {
        "conversationId": conv_id,
        "readUpTo": up_to_sent_at,
        "readerEmail": "a@example.com",  # server-verified session identity, never client-sent
    }
    assert b_count_events == []

    await a.disconnect()
    await a2.disconnect()
    await b.disconnect()


async def test_group_receipts_carry_server_verified_identity_and_go_to_other_members_only(server):
    """3-member group: b's read/delivery acks fan out to a AND c (the other participants) with
    readerEmail/recipientEmail == b (from b's session, not the payload), and never back to b."""
    from app.schemas.chat import to_iso_z

    async with async_session_maker() as session:
        conv = await chat_repo.create_group_conversation(
            session, "a@example.com", ["b@example.com", "c@example.com"], None
        )
        await session.commit()
    conv_id = conv["id"]

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    c = await _connect_as(server, "c@example.com")
    await asyncio.sleep(0.2)

    async with async_session_maker() as session:
        msg = await chat_repo.insert_message(session, conv_id, "a@example.com", "hello group")
        await session.commit()
        up_to = to_iso_z(msg.sent_at)

    got: dict[str, list] = {"a": [], "b": [], "c": []}
    for name, client in (("a", a), ("b", b), ("c", c)):
        for evt in ("read_receipt", "delivery_receipt"):

            def _mk(name=name, evt=evt):
                async def handler(data):
                    got[name].append((evt, data))

                return handler

            client.on(evt, _mk())

    # A spoofed identity in the payload must be ignored — the server uses b's session email.
    await b.emit(
        "message_read", {"conversationId": conv_id, "upToSentAt": up_to, "readerEmail": "mallory@example.com"}
    )
    await b.emit(
        "message_delivered",
        {"conversationId": conv_id, "upToSentAt": up_to, "recipientEmail": "mallory@example.com"},
    )
    await asyncio.sleep(0.5)

    expected_read = ("read_receipt", {"conversationId": conv_id, "readUpTo": up_to, "readerEmail": "b@example.com"})
    expected_delivered = (
        "delivery_receipt",
        {"conversationId": conv_id, "deliveredUpTo": up_to, "recipientEmail": "b@example.com"},
    )
    for name in ("a", "c"):
        assert expected_read in got[name], (name, got[name])
        assert expected_delivered in got[name], (name, got[name])
    assert got["b"] == []

    # History for the sender now derives the same fact from b's watermark: readBy/deliveredTo == [b].
    async with async_session_maker() as session:
        watermarks = await chat_repo.get_participant_watermarks(session, conv_id)
        delivered_to, read_by = chat_repo.compute_message_receipts(msg, watermarks)
    assert read_by == ["b@example.com"]
    assert delivered_to == ["b@example.com"]

    await a.disconnect()
    await b.disconnect()
    await c.disconnect()


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


async def test_send_seam_without_origin_sid_reaches_whole_room_and_pushes_unread(server):
    """The extracted write path (services/chat_send.py) called with no originating socket — the
    shape a non-socket server-side sender uses: incoming_message reaches EVERY participant socket
    (the sender's own included, since nothing is skipped), no message_saved echo is emitted, and
    the recipient's unread_count still arrives on their per-user room."""
    from app.services.chat_send import send_chat_message

    conv_id = await _seeded_conversation()

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    incoming_a: asyncio.Future = asyncio.get_event_loop().create_future()
    incoming_b: asyncio.Future = asyncio.get_event_loop().create_future()
    unread_b: asyncio.Future = asyncio.get_event_loop().create_future()
    saved_seen = False

    @a.on("incoming_message")
    async def on_incoming_a(data):
        if not incoming_a.done():
            incoming_a.set_result(data)

    @b.on("incoming_message")
    async def on_incoming_b(data):
        if not incoming_b.done():
            incoming_b.set_result(data)

    @b.on("unread_count")
    async def on_unread_b(data):
        if not unread_b.done():
            unread_b.set_result(data)

    @a.on("message_saved")
    async def on_saved(_data):
        nonlocal saved_seen
        saved_seen = True

    async with async_session_maker() as session:
        payload = await send_chat_message(
            session, conversation_id=conv_id, sender_email="a@example.com", text="  from the seam  "
        )

    got_a = await asyncio.wait_for(incoming_a, timeout=2)
    got_b = await asyncio.wait_for(incoming_b, timeout=2)
    unread = await asyncio.wait_for(unread_b, timeout=2)

    assert payload["senderId"] == "a@example.com"
    assert payload["text"] == "from the seam"
    assert got_a["message"]["id"] == payload["id"]
    assert got_b["message"]["id"] == payload["id"]
    assert unread["conversationId"] == conv_id
    assert unread["count"] >= 1  # shared dev DB accumulates across tests, like the socket unread test
    assert saved_seen is False

    await a.disconnect()
    await b.disconnect()


async def test_join_participant_sockets_lets_recipient_connected_before_conversation_receive_live(server):
    """A conversation created AFTER both participants connected has no live sockets in its room.
    With join_participant_sockets the seam migrates them in before fan-out, so the recipient
    gets incoming_message without reconnecting."""
    from app.services.chat_send import send_chat_message

    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    conv_id = await _seeded_conversation()  # created after connect — nobody is in its room yet

    incoming_b: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("incoming_message")
    async def on_incoming_b(data):
        if not incoming_b.done():
            incoming_b.set_result(data)

    async with async_session_maker() as session:
        await send_chat_message(
            session,
            conversation_id=conv_id,
            sender_email="a@example.com",
            text="first ever",
            join_participant_sockets=True,
        )

    got_b = await asyncio.wait_for(incoming_b, timeout=2)
    assert got_b["message"]["text"] == "first ever"
    assert got_b["message"]["senderId"] == "a@example.com"

    await a.disconnect()
    await b.disconnect()


# --- A1.4.1: the reserved Toucan sender -----------------------------------------------------------


async def test_reserved_toucan_sender_can_write_into_an_existing_conversation_without_membership(server):
    """Toucan is not a participant, yet its message persists, reaches every participant socket
    live, and bumps every participant's unread count (all of them are recipients)."""
    from app.services.chat_send import TOUCAN_CHAT_SENDER, send_chat_message

    conv_id = await _seeded_conversation()
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    incoming = {e: asyncio.get_event_loop().create_future() for e in ("a", "b")}
    unread = {e: asyncio.get_event_loop().create_future() for e in ("a", "b")}
    for key, client in (("a", a), ("b", b)):

        def bind(k, c):
            @c.on("incoming_message")
            async def on_incoming(data):
                if not incoming[k].done():
                    incoming[k].set_result(data)

            @c.on("unread_count")
            async def on_unread(data):
                if not unread[k].done():
                    unread[k].set_result(data)

        bind(key, client)

    async with async_session_maker() as session:
        payload = await send_chat_message(
            session, conversation_id=conv_id, sender_email=TOUCAN_CHAT_SENDER, text="Squawk — noted."
        )
        conv = await chat_repo.get_conversation_by_id(session, conv_id)

    assert payload["senderId"] == TOUCAN_CHAT_SENDER
    for key in ("a", "b"):
        got = await asyncio.wait_for(incoming[key], timeout=2)
        assert got["message"]["id"] == payload["id"]
        assert got["message"]["senderId"] == TOUCAN_CHAT_SENDER
        count = await asyncio.wait_for(unread[key], timeout=2)
        assert count["conversationId"] == conv_id and count["count"] >= 1
    # Still exactly two humans in the conversation — Toucan was never added.
    assert set(conv["participant_ids"]) == {"a@example.com", "b@example.com"}

    await a.disconnect()
    await b.disconnect()


async def test_reserved_toucan_sender_cannot_write_into_a_missing_conversation(server):
    from app.services.chat_send import (
        TOUCAN_CHAT_SENDER,
        ChatSendError,
        send_chat_message,
    )

    async with async_session_maker() as session:
        with pytest.raises(ChatSendError) as exc:
            await send_chat_message(
                session, conversation_id="does-not-exist", sender_email=TOUCAN_CHAT_SENDER, text="hi"
            )
    assert exc.value.code == "invalid_message"


async def test_arbitrary_non_participant_is_still_rejected_by_the_seam(server):
    from app.services.chat_send import ChatSendError, send_chat_message

    conv_id = await _seeded_conversation()
    async with async_session_maker() as session:
        with pytest.raises(ChatSendError) as exc:
            await send_chat_message(
                session, conversation_id=conv_id, sender_email="intruder@example.com", text="let me in"
            )
        messages = await chat_repo.list_messages(session, conv_id)
    assert exc.value.code == "forbidden"
    assert all(m.sender_email != "intruder@example.com" for m in messages)


async def test_a_socket_session_claiming_the_toucan_identity_is_refused(server):
    """Only server-side code may author as Toucan — a (dev-bypass) session using the reserved
    email gets chat_error and nothing is persisted or delivered."""
    from app.services.chat_send import TOUCAN_CHAT_SENDER

    conv_id = await _seeded_conversation()
    fake = await _connect_as(server, TOUCAN_CHAT_SENDER)
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    error_future: asyncio.Future = asyncio.get_event_loop().create_future()
    b_got_incoming = False

    @fake.on("chat_error")
    async def on_error(data):
        if not error_future.done():
            error_future.set_result(data)

    @b.on("incoming_message")
    async def on_incoming(_data):
        nonlocal b_got_incoming
        b_got_incoming = True

    await fake.emit("send_message", {"conversationId": conv_id, "text": "I am the bird", "clientTempId": "x"})
    err = await asyncio.wait_for(error_future, timeout=2)
    await asyncio.sleep(0.2)
    assert err["code"] == "forbidden"
    assert b_got_incoming is False
    async with async_session_maker() as session:
        messages = await chat_repo.list_messages(session, conv_id)
    assert all(m.text != "I am the bird" for m in messages)

    await fake.disconnect()
    await b.disconnect()
