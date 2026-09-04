from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import socketio
import uvicorn

from app import database as app_db
from app.config import settings
from app.database import Base
from app.main import app as combined_app
from app.repositories import chat as chat_repo
from app.repositories import toucan_delegation as repo
from app.services import chat_delegation
from app.services.chat_assistant import BARE_REPLY
from app.services.chat_delegation import evaluate_and_reply, reply_gate
from app.services.chat_send import TOUCAN_CHAT_SENDER
from app.services.toucan.delegation import first_reply_text, follow_up_reply_text
from app.services.toucan_ai import provider

# A2.1 — Toucan acknowledging a DM on behalf of a delegated owner, over the real socket path.
# Same rig as test_chat_assistant_socket.py, but pointed at the isolated throwaway database so
# delegation rows never land in the developer's own DB.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server(isolated_app_db, monkeypatch):
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    # Deterministic-only: a provider call anywhere in these tests is a failure.
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")

    async def _never(*a, **k):
        raise AssertionError("provider must not be called under delegation")

    monkeypatch.setattr(provider, "_request_reply", _never)
    reply_gate.reset()
    async with app_db.engine.begin() as conn:
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
    reply_gate.reset()


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


async def _settle(seconds: float = 0.4) -> None:
    await asyncio.sleep(seconds)


def _fresh(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


async def _dm(a: str, b: str) -> str:
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, a, b)
    return conv["id"]


async def _delegate(owner: str, minutes: int = 120, now: datetime | None = None):
    async with app_db.async_session_maker() as session:
        row, _ = await repo.start_delegation(session, owner_email=owner, duration_minutes=minutes, now=now)
    return row


async def _messages(conv_id: str) -> list:
    async with app_db.async_session_maker() as session:
        return await chat_repo.list_messages(session, conv_id)


async def _toucan_messages(conv_id: str) -> list:
    return [m for m in await _messages(conv_id) if m.sender_email == TOUCAN_CHAT_SENDER]


async def _send_and_settle(client, conv_id: str, text: str, temp: str = "t") -> None:
    await client.emit("send_message", {"conversationId": conv_id, "text": text, "clientTempId": temp})
    await _settle()


# --- the happy path -------------------------------------------------------------------------------


async def test_incoming_dm_earns_exactly_one_toucan_acknowledgement(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    m_saved = _collector(m, "message_saved")
    m_incoming = _collector(m, "incoming_message")
    b_incoming = _collector(b, "incoming_message")
    b_unread = _collector(b, "unread_count")

    await m.emit("send_message", {"conversationId": conv_id, "text": "Bon, can you review the PR?", "clientTempId": "t1"})
    await _wait_until(lambda: len(b_incoming) >= 2 and len(m_incoming) >= 1)
    await _settle()

    expected = first_reply_text(bon)
    # The human message persisted and fanned out untouched, THEN Toucan's acknowledgement.
    assert m_saved[0]["clientTempId"] == "t1"
    assert [x["message"]["senderId"] for x in b_incoming] == [micah, TOUCAN_CHAT_SENDER]
    assert b_incoming[1]["message"]["text"] == expected
    assert m_incoming[0]["message"]["senderId"] == TOUCAN_CHAT_SENDER
    assert m_incoming[0]["message"]["text"] == expected
    assert expected.startswith("Toucan — assisting ") and "is currently unavailable" in expected
    assert "Is this urgent?" in expected

    msgs = await _messages(conv_id)
    assert [x.sender_email for x in msgs] == [micah, TOUCAN_CHAT_SENDER]
    assert msgs[0].text == "Bon, can you review the PR?"
    # Exactly one automatic reply — Toucan's own message never re-triggers the evaluation.
    assert len(await _toucan_messages(conv_id)) == 1
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.get_conversation_by_id(session, conv_id)
        active = await repo.get_active_delegation(session, owner_email=bon)
        owner_unread = await chat_repo.unread_count(session, conv_id, bon)
        sender_unread = await chat_repo.unread_count(session, conv_id, micah)
    assert set(conv["participant_ids"]) == {bon, micah}  # Toucan never became a participant
    assert active.reply_count == 1

    # UNREAD / ATTENTION CHARACTERIZATION (A2.1 records the fact; A2.2/A2.3 decide). The send
    # seam treats Toucan as the sender and every participant as a recipient, so the DELEGATED
    # OWNER's own unread count includes Toucan's acknowledgement (their peer's message + the
    # ack = 2), and the SENDER gets the ack as unread too (1). Both received a live unread_count
    # push for it.
    assert owner_unread == 2
    assert sender_unread == 1
    assert [u["count"] for u in b_unread if u["conversationId"] == conv_id][-1] == 2

    await b.disconnect()
    await m.disconnect()


async def test_owner_sending_in_their_own_dm_never_triggers_a_reply(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    b = await _connect_as(server, bon)
    await asyncio.sleep(0.2)
    await _send_and_settle(b, conv_id, "back for a second")
    assert await _toucan_messages(conv_id) == []
    await b.disconnect()


async def test_no_delegation_means_no_reply(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send_and_settle(m, conv_id, "hello?")
    assert await _toucan_messages(conv_id) == []
    await m.disconnect()


async def test_expired_and_cancelled_delegations_are_silent_and_expiry_is_recorded(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    # Started three hours ago for one hour: durable row says active, the clock says expired.
    row = await _delegate(bon, minutes=60, now=datetime.now(timezone.utc) - timedelta(hours=3))
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send_and_settle(m, conv_id, "anyone there?")
    assert await _toucan_messages(conv_id) == []
    async with app_db.async_session_maker() as session:
        refreshed = await session.get(type(row), row.id)
    assert refreshed.status == "ended" and refreshed.ended_reason == "expired"

    # A fresh delegation that the owner cancels before the message arrives.
    await _delegate(bon)
    async with app_db.async_session_maker() as session:
        ended = await repo.end_delegation(session, owner_email=bon)
    assert ended.ended_reason == "cancelled"
    await _send_and_settle(m, conv_id, "still there?", "t2")
    assert await _toucan_messages(conv_id) == []
    await m.disconnect()


async def test_cooldown_and_cap_bound_rapid_incoming_messages(server, monkeypatch):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)

    # Cooldown: three rapid messages → one acknowledgement.
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 3600.0)
    for i in range(3):
        await m.emit("send_message", {"conversationId": conv_id, "text": f"ping {i}", "clientTempId": f"c{i}"})
    await _settle(0.8)
    assert len(await _toucan_messages(conv_id)) == 1

    # Cap: with the cooldown off, replies stop at the per-conversation cap, and the second one
    # is the shorter follow-up wording.
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_MAX_REPLIES_PER_CONVERSATION", 2)
    for i in range(4):
        await _send_and_settle(m, conv_id, f"pong {i}", f"p{i}")
    toucan = await _toucan_messages(conv_id)
    assert [t.text for t in toucan] == [first_reply_text(bon), follow_up_reply_text(bon)]
    human = [x for x in await _messages(conv_id) if x.sender_email == micah]
    assert len(human) == 7  # every human message persisted regardless
    async with app_db.async_session_maker() as session:
        active = await repo.get_active_delegation(session, owner_email=bon)
    assert active.reply_count == 2
    await m.disconnect()


async def test_an_explicit_at_toucan_message_gets_the_a14_reply_not_the_delegation_ack(server):
    """Regression + boundary: A1.4 still answers "@Toucan" inside a delegated DM, and the
    delegation does NOT also acknowledge — the sender was talking to Toucan, not to the owner."""
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send_and_settle(m, conv_id, "@Toucan")
    toucan = await _toucan_messages(conv_id)
    assert [t.text for t in toucan] == [BARE_REPLY]
    await m.disconnect()


# --- direct evaluation: the guards that the socket path cannot easily reach -----------------------


async def test_evaluation_refuses_toucan_senders_groups_and_non_participant_owners(server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _dm(alex, micah)  # Bon is NOT in this DM
    await _delegate(bon)
    # A delegated owner who is not a participant earns nothing.
    assert await evaluate_and_reply(conv_id, micah, "m1") is None
    # A Toucan-authored sender is refused before any lookup.
    assert await evaluate_and_reply(conv_id, TOUCAN_CHAT_SENDER, "m2") is None
    # A sender who is not a participant of the conversation earns nothing either.
    assert await evaluate_and_reply(conv_id, bon, "m3") is None
    # Groups are out of scope at A2.1 even when a delegated owner is a member.
    async with app_db.async_session_maker() as session:
        group = await chat_repo.create_group_conversation(session, bon, [micah, alex], title="Team")
    assert await evaluate_and_reply(group["id"], micah, "m4") is None
    assert await _toucan_messages(conv_id) == [] and await _toucan_messages(group["id"]) == []
    # Unknown conversation: nothing, no exception.
    assert await evaluate_and_reply("no-such-conversation", micah, "m5") is None


async def test_the_same_saved_message_cannot_be_acknowledged_twice(server, monkeypatch):
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    first = await evaluate_and_reply(conv_id, micah, "same-id")
    assert first is not None and first["senderId"] == TOUCAN_CHAT_SENDER
    assert await evaluate_and_reply(conv_id, micah, "same-id") is None
    assert len(await _toucan_messages(conv_id)) == 1


async def test_evaluation_reads_no_history_and_calls_no_provider(server, monkeypatch):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)

    def _forbidden(*a, **k):
        raise AssertionError("delegation must not read conversation history")

    monkeypatch.setattr(chat_repo, "list_recent_messages", _forbidden)
    monkeypatch.setattr(chat_repo, "list_messages", _forbidden)
    assert not hasattr(chat_delegation, "generate_conversation_reply")
    saved = await evaluate_and_reply(conv_id, micah, "m1")
    assert saved is not None and saved["text"] == first_reply_text(bon)
