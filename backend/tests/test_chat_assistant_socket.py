from __future__ import annotations

import asyncio

import httpx
import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.repositories import chat as chat_repo
from app.services.chat_assistant import (
    BARE_REPLY,
    PROMPT_ACK_REPLY,
    detect_toucan_invocation,
    reply_to_invocation,
)
from app.services.chat_send import TOUCAN_CHAT_SENDER

# A1.4.2 — "@Toucan" inside a DM or group produces a deterministic Toucan reply in that same
# conversation, authored by the reserved sender, AFTER the human message has taken the ordinary
# path. Real server + real socket clients, same rig as test_chat_socket.py.

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


def _collector(client: socketio.AsyncClient, event: str) -> list[dict]:
    seen: list[dict] = []

    @client.on(event)
    async def _on(data):
        seen.append(data)

    return seen


async def _wait_until(pred, timeout: float = 2.0) -> None:
    deadline = asyncio.get_event_loop().time() + timeout
    while not pred():
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.02)


async def _toucan_messages(conv_id: str) -> list:
    async with async_session_maker() as session:
        msgs = await chat_repo.list_messages(session, conv_id)
    return [m for m in msgs if m.sender_email == TOUCAN_CHAT_SENDER]


# --- detection (pure) ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "prompt"),
    [
        ("@Toucan", ""),
        ("@toucan help", "help"),
        ("hey @Toucan help us", "hey help us"),
        ("@TOUCAN, are you there?", ", are you there?"),
        ("@Toucan @toucan hello @Toucan", "hello"),
        ("ping @toucan.", "ping ."),
        ("(@Toucan)", "( )"),
    ],
)
async def test_detection_accepts_whole_token_anywhere_case_insensitively(text, prompt):
    assert detect_toucan_invocation(text) == prompt


@pytest.mark.parametrize("text", ["toucan", "@ToucanBird", "email@toucan.com", "@toucan-bird", "", "Toucan @ work"])
async def test_detection_rejects_lookalikes(text):
    assert detect_toucan_invocation(text) is None


async def test_the_fixed_replies_can_never_re_invoke_toucan():
    assert detect_toucan_invocation(BARE_REPLY) is None
    assert detect_toucan_invocation(PROMPT_ACK_REPLY) is None


# --- in-chat reply over the real socket path -----------------------------------------------------


async def test_dm_invocation_replies_in_the_same_conversation_after_the_human_message(server):
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
    conv_id = conv["id"]
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)
    a_saved = _collector(a, "message_saved")
    a_incoming = _collector(a, "incoming_message")
    b_incoming = _collector(b, "incoming_message")
    b_unread = _collector(b, "unread_count")

    await a.emit("send_message", {"conversationId": conv_id, "text": "@Toucan", "clientTempId": "t1"})
    await _wait_until(lambda: len(b_incoming) >= 2 and len(a_incoming) >= 1)

    # Human message first, Toucan second — for the peer.
    assert [m["message"]["senderId"] for m in b_incoming] == ["a@example.com", TOUCAN_CHAT_SENDER]
    assert b_incoming[1]["message"]["text"] == BARE_REPLY
    assert b_incoming[1]["message"]["conversationId"] == conv_id
    assert b_incoming[1]["message"]["mentionedEmails"] == []
    # The invoker got their own echo, then Toucan's reply as an incoming message.
    assert a_saved[0]["clientTempId"] == "t1"
    assert a_incoming[0]["message"]["senderId"] == TOUCAN_CHAT_SENDER
    # Persisted in order, and Toucan was never added as a participant.
    async with async_session_maker() as session:
        msgs = await chat_repo.list_messages(session, conv_id)
        conv_after = await chat_repo.get_conversation_by_id(session, conv_id)
    assert [m.sender_email for m in msgs][-2:] == ["a@example.com", TOUCAN_CHAT_SENDER]
    assert msgs[-2].sent_at <= msgs[-1].sent_at
    assert set(conv_after["participant_ids"]) == {"a@example.com", "b@example.com"}
    assert any(u["conversationId"] == conv_id for u in b_unread)

    # Reload compatibility: the REST history the client fetches on reopen carries both.
    async with httpx.AsyncClient(base_url=server) as http:
        res = await http.get(f"/conversations/{conv_id}/messages", headers={"x-dev-email": "b@example.com"})
    assert res.status_code == 200
    senders = [m["senderId"] for m in res.json()]
    assert senders[-2:] == ["a@example.com", TOUCAN_CHAT_SENDER]

    await a.disconnect()
    await b.disconnect()


async def test_group_invocation_with_prompt_reaches_every_member_once_and_keeps_employee_mentions(server):
    async with async_session_maker() as session:
        conv = await chat_repo.create_group_conversation(
            session, "a@example.com", ["b@example.com", "c@example.com"], "Design Team"
        )
    conv_id = conv["id"]
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    c = await _connect_as(server, "c@example.com")
    await asyncio.sleep(0.2)
    b_incoming = _collector(b, "incoming_message")
    c_incoming = _collector(c, "incoming_message")
    b_mentions = _collector(b, "mention_count")

    await a.emit(
        "send_message",
        {
            "conversationId": conv_id,
            "text": "@Toucan can you help @B? @toucan",
            "clientTempId": "t2",
            "mentionedEmails": ["b@example.com"],
        },
    )
    await _wait_until(lambda: len(b_incoming) >= 2 and len(c_incoming) >= 2)
    await asyncio.sleep(0.3)  # let any spurious second reply arrive — it must not

    for seen in (b_incoming, c_incoming):
        assert [m["message"]["senderId"] for m in seen] == ["a@example.com", TOUCAN_CHAT_SENDER]
        assert seen[1]["message"]["text"] == PROMPT_ACK_REPLY
    # The human's employee mention survived untouched and still pushed a mention count to B.
    assert b_incoming[0]["message"]["mentionedEmails"] == ["b@example.com"]
    assert b_mentions and b_mentions[0]["conversationId"] == conv_id
    # Two @toucan tokens → exactly one reply, and the reply pings nobody.
    toucan_msgs = await _toucan_messages(conv_id)
    assert len(toucan_msgs) == 1
    assert toucan_msgs[0].mentioned_emails is None

    await a.disconnect()
    await b.disconnect()
    await c.disconnect()


async def test_lookalike_text_never_triggers_a_reply(server):
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
    conv_id = conv["id"]
    before = len(await _toucan_messages(conv_id))
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)
    b_incoming = _collector(b, "incoming_message")

    for text in ("toucan", "@ToucanBird", "mail me at email@toucan.com"):
        await a.emit("send_message", {"conversationId": conv_id, "text": text, "clientTempId": text})
    await _wait_until(lambda: len(b_incoming) >= 3)
    await asyncio.sleep(0.4)

    assert all(m["message"]["senderId"] == "a@example.com" for m in b_incoming)
    assert len(await _toucan_messages(conv_id)) == before

    await a.disconnect()
    await b.disconnect()


# --- safety: membership, missing conversation, recursion -------------------------------------------


async def test_reply_is_skipped_when_invoker_is_not_or_no_longer_a_participant(server):
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")
    conv_id = conv["id"]
    before = len(await _toucan_messages(conv_id))

    assert await reply_to_invocation(conv_id, "intruder@example.com", "") is None
    assert await reply_to_invocation("no-such-conversation", "a@example.com", "") is None
    # Toucan can never be its own invoker.
    assert await reply_to_invocation(conv_id, TOUCAN_CHAT_SENDER, "") is None
    assert len(await _toucan_messages(conv_id)) == before

    # A real participant still gets a reply through the same function.
    sent = await reply_to_invocation(conv_id, "a@example.com", "")
    assert sent is not None and sent["senderId"] == TOUCAN_CHAT_SENDER
    assert len(await _toucan_messages(conv_id)) == before + 1
