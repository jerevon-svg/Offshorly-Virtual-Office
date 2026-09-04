from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import socketio
import uvicorn
from sqlalchemy import func, select

from app import database as app_db
from app.config import settings
from app.database import Base
from app.main import app as combined_app
from app.main import fastapi_app
from app.models.conversation import Conversation, ConversationParticipant
from app.models.message import Message
from app.models.toucan import ToucanConversation, ToucanMessage
from app.repositories import chat as chat_repo
from app.services.toucan import context as toucan_context
from app.services.toucan.actions import (
    SendMessageRequest,
    SetStatusAction,
    parse_action_request,
    validate_ai_proposal,
)
from app.services.toucan.pending_actions import pending_actions
from app.services.toucan.roster import RosterPerson
from app.services.toucan_ai import provider

# A1 — TOUCAN SEND_MESSAGE. The promise under test is the T8 one, applied to the first action
# the server executes itself: NO CONFIRMATION = NOTHING SENT. A resolved recipient becomes a
# pending proposal only; the proposal sends exactly once, only via Confirm, only for its owner,
# only before its TTL — and it sends through the SAME chat write path normal chat uses, so the
# recipient gets an ordinary persisted, fanned-out Virtual Office message.

pytestmark = pytest.mark.asyncio

VIEWER = "bon@example.com"
MICAH = "micah@example.com"
OTHER = "angelo@example.com"

ROSTER = (
    RosterPerson(email=VIEWER, display_name="Bon"),
    RosterPerson(email=MICAH, display_name="Micah Reyes"),
    RosterPerson(email="alex.a@example.com", display_name="Alex Adams"),
    RosterPerson(email="alex.b@example.com", display_name="Alex Brown"),
    RosterPerson(email=OTHER, display_name="Angelo"),
)


@pytest.fixture(autouse=True)
async def _fresh_state(isolated_app_db, monkeypatch):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table in (ToucanMessage, ToucanConversation, Message, ConversationParticipant, Conversation):
            await conn.execute(table.__table__.delete())
    pending_actions.reset()

    async def fake_roster(_token):
        return ROSTER

    monkeypatch.setattr(toucan_context, "fetch_roster", fake_roster)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    yield
    pending_actions.reset()


class FakeProvider:
    def __init__(self, reply: object):
        self.reply = reply
        self.calls: list[dict] = []

    async def __call__(self, messages, *, model, max_output_tokens, timeout, tools=None):
        self.calls.append({"messages": messages, "tools": tools})
        return self.reply

    @property
    def sent_text(self) -> str:
        return json.dumps([c["messages"] for c in self.calls])


def _enable_ai(monkeypatch, reply: object) -> FakeProvider:
    fake = FakeProvider(reply)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(provider, "_request_reply", fake)
    return fake


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


async def _ask(client, question: str, *, email: str = VIEWER) -> httpx.Response:
    return await client.post("/toucan/ask", json={"question": question}, headers={"x-dev-email": email})


async def _confirm(client, action_id: str, *, email: str = VIEWER):
    return await client.post(f"/toucan/actions/{action_id}/confirm", headers={"x-dev-email": email})


async def _cancel(client, action_id: str, *, email: str = VIEWER):
    return await client.post(f"/toucan/actions/{action_id}/cancel", headers={"x-dev-email": email})


async def _chat_state() -> tuple[int, list[Message]]:
    async with app_db.async_session_maker() as session:
        convs = (await session.execute(select(func.count(Conversation.id)))).scalar_one()
        messages = list((await session.execute(select(Message))).scalars().all())
    return convs, messages


# --- deterministic parser (pure) ------------------------------------------------------------


@pytest.mark.parametrize(
    ("question", "recipient", "text"),
    [
        ("Message Micah that I'll be back at 3.", "Micah", "I'll be back at 3."),
        ("Tell Alex I'm running 10 minutes late", "Alex", "I'm running 10 minutes late"),
        ("send a message to Micah Reyes: on my way", "Micah Reyes", "on my way"),
        ("let Micah know that the review is done", "Micah", "the review is done"),
        ("please ping angelo, lunch is here", "angelo", "lunch is here"),
        ('dm micah "see you at 3"', "micah", "see you at 3"),
    ],
)
async def test_parser_captures_recipient_as_typed_and_exact_text(question, recipient, text):
    assert parse_action_request(question) == SendMessageRequest(recipient=recipient, text=text)


@pytest.mark.parametrize(
    "question",
    [
        "tell me who is online",
        "message everyone that lunch is here",
        "write a message saying I'm busy",
        "who is in the office",
        "tell Alex",
    ],
)
async def test_parser_never_treats_these_as_send_requests(question):
    assert not isinstance(parse_action_request(question), SendMessageRequest)


async def test_parser_still_yields_set_status_first():
    assert parse_action_request("set me to busy") == SetStatusAction(status="BUSY")


# --- proposal, never a send ----------------------------------------------------------------


async def test_unique_recipient_becomes_a_proposal_and_sends_nothing():
    async with await _client() as client:
        res = await _ask(client, "Message Micah that I'll be back at 3.")
    assert res.status_code == 200
    body = res.json()
    assert body["intent"] == "action_proposal"
    action = body["action"]
    assert action["action"] == "send_message"
    assert action["recipientEmail"] == MICAH
    assert action["recipientLabel"] == "Micah Reyes"
    assert action["message"] == "I'll be back at 3."
    assert action["summary"] == "Send message to Micah Reyes"
    assert "status" not in action
    assert "I'll be back at 3." in body["text"]
    # Nothing sent, and no DM created just for proposing.
    convs, messages = await _chat_state()
    assert (convs, messages) == (0, [])


@pytest.mark.parametrize(
    ("question", "fragment"),
    [
        ("Message Zed that I'm late", "don't know anyone called \"Zed\""),
        ("Tell Alex I'm running late", "More than one person matches \"Alex\""),
        ("Tell Bon I'm here", "That's you"),
    ],
)
async def test_unknown_ambiguous_or_self_recipient_asks_instead_of_proposing(question, fragment):
    async with await _client() as client:
        res = await _ask(client, question)
    assert res.status_code == 200
    body = res.json()
    assert fragment in body["text"]
    assert "action" not in body
    assert pending_actions._by_id == {}
    convs, messages = await _chat_state()
    assert (convs, messages) == (0, [])


# --- confirm / cancel / replay / expiry / owner --------------------------------------------


async def _propose(client, question: str = "Message Micah that I'll be back at 3.") -> str:
    res = await _ask(client, question)
    assert res.status_code == 200
    return res.json()["action"]["id"]


async def test_confirm_sends_exactly_once_creating_the_dm_only_now():
    async with await _client() as client:
        action_id = await _propose(client)
        assert (await _chat_state())[0] == 0

        res = await _confirm(client, action_id)
        assert res.status_code == 200
        result = res.json()
        assert result["outcome"] == "executed"
        assert result["action"] == "send_message"
        assert result["text"] == "Done — I sent your message to Micah Reyes."

        convs, messages = await _chat_state()
        assert convs == 1
        assert len(messages) == 1
        assert messages[0].sender_email == VIEWER
        assert messages[0].text == "I'll be back at 3."
        assert result["conversationId"] == messages[0].conversation_id
        assert result["messageId"] == messages[0].id
        async with app_db.async_session_maker() as session:
            conv = await chat_repo.get_conversation_by_id(session, messages[0].conversation_id)
        assert set(conv["participant_ids"]) == {VIEWER, MICAH}

        # Replay: the one-time entry is gone — nothing resends.
        assert (await _confirm(client, action_id)).status_code == 404
        assert len((await _chat_state())[1]) == 1


async def test_cancel_sends_nothing_and_leaves_no_conversation():
    async with await _client() as client:
        action_id = await _propose(client)
        res = await _cancel(client, action_id)
        assert res.status_code == 200
        assert res.json()["outcome"] == "cancelled"
        assert res.json()["text"] == "Okay, cancelled — I haven't sent anything."
        assert (await _confirm(client, action_id)).status_code == 404
    assert (await _chat_state()) == (0, [])


async def test_expired_proposal_cannot_send(monkeypatch):
    monkeypatch.setattr(settings, "TOUCAN_ACTION_TTL_SECONDS", 0.0)
    async with await _client() as client:
        action_id = await _propose(client)
        assert (await _confirm(client, action_id)).status_code == 404
    assert (await _chat_state()) == (0, [])


async def test_owner_mismatch_cannot_send_and_sender_is_always_the_confirming_identity():
    async with await _client() as client:
        action_id = await _propose(client)
        assert (await _confirm(client, action_id, email=OTHER)).status_code == 404
        assert (await _chat_state()) == (0, [])
        # The owner's entry is untouched and still sends — from the owner, never from anyone else.
        assert (await _confirm(client, action_id)).status_code == 200
    _, messages = await _chat_state()
    assert [m.sender_email for m in messages] == [VIEWER]


async def test_existing_dm_is_reused_and_known_at_proposal_time():
    async with app_db.async_session_maker() as session:
        existing = await chat_repo.upsert_conversation(session, VIEWER, MICAH)
    async with await _client() as client:
        res = await _ask(client, "tell micah on my way")
        action_id = res.json()["action"]["id"]
        result = (await _confirm(client, action_id)).json()
    assert result["conversationId"] == existing["id"]
    convs, messages = await _chat_state()
    assert convs == 1
    assert [m.conversation_id for m in messages] == [existing["id"]]


# --- live delivery through the extracted seam ------------------------------------------------


async def test_confirmed_send_reaches_a_connected_recipient_live_with_unread_count():
    """Micah is connected BEFORE the DM exists. Confirm must create the DM, migrate Micah's live
    socket into its room, and fan out incoming_message + unread_count — all via chat_send."""
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    micah = socketio.AsyncClient()
    try:
        await asyncio.wait_for(
            micah.connect(
                f"http://127.0.0.1:{port}", auth={"x-dev-email": MICAH},
                socketio_path="socket.io", transports=["websocket"],
            ),
            timeout=5,
        )
        await asyncio.sleep(0.2)
        incoming: asyncio.Future = asyncio.get_event_loop().create_future()
        unread: asyncio.Future = asyncio.get_event_loop().create_future()

        @micah.on("incoming_message")
        async def on_incoming(data):
            if not incoming.done():
                incoming.set_result(data)

        @micah.on("unread_count")
        async def on_unread(data):
            if not unread.done():
                unread.set_result(data)

        async with await _client() as client:
            action_id = await _propose(client)
            assert not incoming.done()  # proposing delivers nothing
            assert (await _confirm(client, action_id)).status_code == 200

        got = await asyncio.wait_for(incoming, timeout=2)
        count = await asyncio.wait_for(unread, timeout=2)
        assert got["message"]["text"] == "I'll be back at 3."
        assert got["message"]["senderId"] == VIEWER
        assert count["count"] == 1
        assert count["conversationId"] == got["message"]["conversationId"]
    finally:
        await micah.disconnect()
        srv.should_exit = True
        await task
        settings.APP_ENV = original_env


# --- the provider door --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {"recipient": "Micah"},
        {"text": "hi"},
        {"recipient": "Micah", "text": "hi", "sender": VIEWER},
        {"recipient": "Micah", "text": ""},
        {"recipient": 7, "text": "hi"},
        {"recipient": "Micah", "text": "x" * 2001},
        "not a dict",
    ],
)
async def test_malformed_provider_send_proposals_are_rejected(args):
    assert validate_ai_proposal("send_message", args) is None


async def test_provider_send_proposal_is_resolved_server_side(monkeypatch):
    _enable_ai(monkeypatch, ("Sure.", ("send_message", json.dumps({"recipient": "micah", "text": "be there soon"}))))
    async with await _client() as client:
        res = await _ask(client, "could you let my teammate micah know I'll be there soon")
    action = res.json()["action"]
    assert action["action"] == "send_message"
    assert action["recipientEmail"] == MICAH
    assert action["message"] == "be there soon"
    assert (await _chat_state()) == (0, [])


async def test_provider_naming_an_unknown_recipient_yields_a_question_not_a_proposal(monkeypatch):
    _enable_ai(monkeypatch, ("Sure.", ("send_message", json.dumps({"recipient": "Zed", "text": "hi"}))))
    async with await _client() as client:
        body = (await _ask(client, "would you mind letting Zed know hi")).json()
    assert "action" not in body
    assert "don't know anyone called \"Zed\"" in body["text"]


async def test_no_chat_bodies_reach_the_provider_even_after_a_send(monkeypatch):
    secret = "SECRET-DM-BODY-do-not-leak"
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, VIEWER, MICAH)
        await chat_repo.insert_message(session, conv["id"], MICAH, secret)
        await session.commit()
    fake = _enable_ai(monkeypatch, "Happy to help!")
    async with await _client() as client:
        action_id = await _propose(client, "message micah that the deck is ready")
        assert (await _confirm(client, action_id)).status_code == 200
        assert (await _ask(client, "what should I say to micah next")).status_code == 200
    assert fake.calls, "the unsupported question must have reached the provider"
    assert secret not in fake.sent_text
    assert "the deck is ready" not in fake.sent_text
    tool_names = [t["function"]["name"] for t in fake.calls[0]["tools"]]
    assert tool_names == ["set_status", "send_message"]


# --- set_status is untouched ----------------------------------------------------------------------


async def test_set_status_confirmation_still_works_and_sends_nothing():
    async with await _client() as client:
        res = await _ask(client, "set me to busy")
        action = res.json()["action"]
        assert action["action"] == "set_status"
        assert action["status"] == "BUSY"
        assert "recipientEmail" not in action and "message" not in action
        result = (await _confirm(client, action["id"])).json()
    assert result["outcome"] == "executed"
    assert result["status"] == "BUSY"
    assert result["conversationId"] is None
    assert (await _chat_state()) == (0, [])
