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
    FAILURE_REPLY,
    build_context_window,
    detect_toucan_invocation,
    reply_to_invocation,
)
from app.services.chat_send import TOUCAN_CHAT_SENDER
from app.services.toucan_ai import provider

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


def _fresh(prefix: str) -> str:
    """Unique identity per run: the socket rig shares the developer's dev database, so a fixed
    email pair would reopen the same DM and accumulate rows across runs."""
    import uuid

    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


async def _seed(session, conv_id: str, sender: str, text: str, minute: int):
    """Insert with an explicit, strictly increasing sent_at — back-to-back inserts otherwise share
    a millisecond and the recent-window order among ties would be arbitrary."""
    from datetime import datetime, timezone

    m = await chat_repo.insert_message(session, conv_id, sender, text)
    m.sent_at = datetime(2026, 9, 3, 9, 0, minute % 60, (minute // 60) * 1000, tzinfo=timezone.utc)
    return m


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
    assert detect_toucan_invocation(FAILURE_REPLY) is None


# --- provider fake (same seam as test_toucan_ai.py) --------------------------------------------------


class FakeProvider:
    def __init__(self, reply: object = "You decided on blue; Micah updates it tomorrow."):
        self.reply = reply
        self.calls: list[dict] = []

    async def __call__(self, messages, *, model, max_output_tokens, timeout, tools=None):
        self.calls.append({"messages": messages, "tools": tools, "timeout": timeout})
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply

    @property
    def system(self) -> str:
        return self.calls[-1]["messages"][0]["content"]

    @property
    def window(self) -> list[dict]:
        import json

        return json.loads(self.system.split("oldest first) ===\n", 1)[1])


@pytest.fixture
def ai(monkeypatch) -> FakeProvider:
    fake = FakeProvider()
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(provider, "_request_reply", fake)
    return fake


@pytest.fixture
def ai_off(monkeypatch) -> FakeProvider:
    fake = FakeProvider(AssertionError("provider must not be called"))
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(provider, "_request_reply", fake)
    return fake


# --- in-chat reply over the real socket path -----------------------------------------------------


async def test_dm_invocation_replies_in_the_same_conversation_after_the_human_message(server, ai_off):
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
    assert ai_off.calls == []  # bare @Toucan never consults the provider

    await a.disconnect()
    await b.disconnect()


async def test_group_invocation_with_prompt_reaches_every_member_once_and_keeps_employee_mentions(server, ai):
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
        assert seen[1]["message"]["text"] == "You decided on blue; Micah updates it tomorrow."
    # Exactly one provider call, with the prompt (tokens stripped) and NO tools; the invoking
    # message is not in the window (it is the prompt), so a fresh group gives an empty window.
    assert len(ai.calls) == 1 and ai.calls[0]["tools"] is None
    assert ai.calls[0]["messages"][1] == {"role": "user", "content": "can you help @B?"}
    assert ai.window == []
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


# --- A1.4.3: conversation-scoped context ------------------------------------------------------------


def _msg(i: int, sender: str, text: str, minute: int):
    from datetime import datetime, timezone

    return Message(
        id=f"m{i}",
        conversation_id="c",
        sender_email=sender,
        text=text,
        sent_at=datetime(2026, 9, 3, 10, minute, tzinfo=timezone.utc),
    )


from app.models.message import Message


async def test_window_is_chronological_labelled_and_excludes_the_invocation_and_toucan():
    msgs = [
        _msg(3, "bon@example.com", "@Toucan what did we decide?", 3),
        _msg(1, "bon@example.com", "We should use the blue version.", 1),
        _msg(2, "micah.reyes@example.com", "Okay, I'll update it tomorrow.", 2),
        _msg(9, TOUCAN_CHAT_SENDER, BARE_REPLY, 0),
    ]
    window = build_context_window(msgs, invoker_email="bon@example.com", invoking_message_id="m3")
    assert window == [
        {"author": "Bon (asking)", "text": "We should use the blue version."},
        {"author": "Micah Reyes", "text": "Okay, I'll update it tomorrow."},
    ]
    assert all("@" not in t["author"] for t in window)


async def test_window_caps_message_count_each_text_and_total_size_dropping_oldest_first():
    msgs = [_msg(i, "b@example.com", f"message {i:02d} " + "x" * 50, i) for i in range(30)]
    window = build_context_window(msgs, invoker_email="a@example.com", invoking_message_id=None, max_messages=20)
    assert len(window) == 20
    assert window[0]["text"].startswith("message 10") and window[-1]["text"].startswith("message 29")

    clipped = build_context_window(
        [_msg(1, "b@example.com", "y" * 1000, 1)], invoker_email="a@example.com", invoking_message_id=None,
        max_message_chars=100,
    )
    assert len(clipped[0]["text"]) == 100 and clipped[0]["text"].endswith("…")

    bounded = build_context_window(
        msgs, invoker_email="a@example.com", invoking_message_id=None, max_messages=20, max_total_chars=200
    )
    assert sum(len(t["text"]) for t in bounded) <= 200
    assert bounded and bounded[-1]["text"].startswith("message 29")  # newest survive, oldest dropped


async def test_prompted_dm_invocation_sends_only_this_conversations_recent_window(server, ai):
    bon_email, micah_email, alex_email = _fresh("bon"), _fresh("micah"), _fresh("alex")
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, bon_email, micah_email)
        other = await chat_repo.upsert_conversation(session, bon_email, alex_email)
        await _seed(session, other["id"], alex_email, "SECRET-OTHER-DM-do-not-leak", 0)
        await _seed(session, conv["id"], TOUCAN_CHAT_SENDER, BARE_REPLY, 1)
        await _seed(session, conv["id"], bon_email, "We should use the blue version.", 2)
        await _seed(session, conv["id"], micah_email, "Okay, I'll update it tomorrow.", 3)
        await session.commit()
    conv_id = conv["id"]
    bon = await _connect_as(server, bon_email)
    micah = await _connect_as(server, micah_email)
    await asyncio.sleep(0.2)
    micah_incoming = _collector(micah, "incoming_message")

    await bon.emit("send_message", {"conversationId": conv_id, "text": "@Toucan what did we decide?", "clientTempId": "q"})
    await _wait_until(lambda: len(micah_incoming) >= 2)

    assert micah_incoming[1]["message"]["senderId"] == TOUCAN_CHAT_SENDER
    assert micah_incoming[1]["message"]["text"] == "You decided on blue; Micah updates it tomorrow."
    assert len(ai.calls) == 1
    assert ai.calls[0]["messages"][1]["content"] == "what did we decide?"
    # Only this conversation, oldest first, speakers distinguished, no Toucan echo, no duplication
    # of the invocation, and no office context / memories blocks.
    assert [t["text"] for t in ai.window] == ["We should use the blue version.", "Okay, I'll update it tomorrow."]
    assert ai.window[0]["author"].startswith("Bon") and ai.window[0]["author"].endswith("(asking)")
    assert ai.window[1]["author"].startswith("Micah") and "asking" not in ai.window[1]["author"]
    assert "SECRET-OTHER-DM" not in ai.system
    assert "OFFICE CONTEXT" not in ai.system and "SAVED MEMORIES" not in ai.system
    assert "@example.com" not in ai.system
    # Persisted like any message and visible on reload for the peer.
    async with httpx.AsyncClient(base_url=server) as http:
        res = await http.get(f"/conversations/{conv_id}/messages", headers={"x-dev-email": micah_email})
    assert [m["senderId"] for m in res.json()][-2:] == [bon_email, TOUCAN_CHAT_SENDER]

    await bon.disconnect()
    await micah.disconnect()


async def test_window_never_exceeds_twenty_messages_over_the_socket(server, ai):
    w1, w2 = _fresh("w1"), _fresh("w2")
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, w1, w2)
        for i in range(30):
            await _seed(session, conv["id"], w2, f"note {i:02d}", i)
        await session.commit()
    a = await _connect_as(server, w1)
    b = await _connect_as(server, w2)
    await asyncio.sleep(0.2)
    b_incoming = _collector(b, "incoming_message")
    await a.emit("send_message", {"conversationId": conv["id"], "text": "@toucan summarize", "clientTempId": "s"})
    await _wait_until(lambda: len(b_incoming) >= 2)
    texts = [t["text"] for t in ai.window]
    assert len(texts) == 20
    assert texts == [f"note {i:02d}" for i in range(10, 30)]
    await a.disconnect()
    await b.disconnect()


async def test_provider_failure_yields_the_deterministic_failure_reply_and_keeps_the_human_message(server, monkeypatch):
    fake = FakeProvider(RuntimeError("boom"))
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(provider, "_request_reply", fake)
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "f1@example.com", "f2@example.com")
    a = await _connect_as(server, "f1@example.com")
    b = await _connect_as(server, "f2@example.com")
    await asyncio.sleep(0.2)
    b_incoming = _collector(b, "incoming_message")
    await a.emit("send_message", {"conversationId": conv["id"], "text": "@Toucan what now?", "clientTempId": "f"})
    await _wait_until(lambda: len(b_incoming) >= 2)
    assert b_incoming[0]["message"]["text"] == "@Toucan what now?"
    assert b_incoming[1]["message"]["text"] == FAILURE_REPLY
    assert "boom" not in b_incoming[1]["message"]["text"]
    async with async_session_maker() as session:
        msgs = await chat_repo.list_messages(session, conv["id"])
    assert [m.text for m in msgs][-2:] == ["@Toucan what now?", FAILURE_REPLY]
    assert len(fake.calls) == 1
    await a.disconnect()
    await b.disconnect()


async def test_empty_or_unusable_provider_output_also_falls_back(server, monkeypatch):
    fake = FakeProvider(("   ", None))
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(provider, "_request_reply", fake)
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "e1@example.com", "e2@example.com")
    sent = await reply_to_invocation(conv["id"], "e1@example.com", "anything", None)
    assert sent is not None and sent["text"] == FAILURE_REPLY


async def test_non_member_and_lost_membership_never_read_history_or_call_provider(server, ai_off, monkeypatch):
    reads: list[str] = []
    original = chat_repo.list_recent_messages

    async def spy(session, conversation_id, limit):
        reads.append(conversation_id)
        return await original(session, conversation_id, limit)

    monkeypatch.setattr(chat_repo, "list_recent_messages", spy)
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, "n1@example.com", "n2@example.com")
        await chat_repo.insert_message(session, conv["id"], "n2@example.com", "private note")
        await session.commit()

    assert await reply_to_invocation(conv["id"], "intruder@example.com", "summarize", None) is None
    assert await reply_to_invocation("no-such-conversation", "n1@example.com", "summarize", None) is None
    assert await reply_to_invocation(conv["id"], TOUCAN_CHAT_SENDER, "summarize", None) is None
    assert reads == [] and ai_off.calls == []

    # Membership lost between the human send and the background task → nothing at all.
    async with async_session_maker() as session:
        from sqlalchemy import delete

        from app.models.conversation import ConversationParticipant

        await session.execute(
            delete(ConversationParticipant).where(
                ConversationParticipant.conversation_id == conv["id"],
                ConversationParticipant.participant_email == "n1@example.com",
            )
        )
        await session.commit()
    assert await reply_to_invocation(conv["id"], "n1@example.com", "summarize", None) is None
    assert reads == [] and ai_off.calls == []
    assert len(await _toucan_messages(conv["id"])) == 0
