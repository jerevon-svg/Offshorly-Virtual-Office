from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import socketio
import uvicorn
from sqlalchemy import delete, func, select

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
    GroupTarget,
    SendMessageRequest,
    parse_action_request,
    resolve_group_targets,
)
from app.services.toucan.pending_actions import pending_actions
from app.services.toucan.roster import RosterPerson
from app.services.toucan_ai import provider

# A1.3 — EXPLICIT GROUP SENDS. Same action, same pending gate, same chat seam as the A1.2 DM
# path; what is new is resolution: an EXISTING group the caller already belongs to, matched by
# title, never created, never guessed — and a person/group name collision is a question.

pytestmark = pytest.mark.asyncio

VIEWER = "bon@example.com"
MICAH = "micah@example.com"
ALEX = "alex.a@example.com"
OUTSIDER = "zed@example.com"

ROSTER = (
    RosterPerson(email=VIEWER, display_name="Bon"),
    RosterPerson(email=MICAH, display_name="Micah Reyes"),
    RosterPerson(email=ALEX, display_name="Alex Adams"),
    RosterPerson(email=OUTSIDER, display_name="Zed Zulu"),
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


async def _group(title: str, *members: str) -> str:
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.create_group_conversation(session, members[0], list(members[1:]), title)
    return conv["id"]


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


async def _ask(client, question: str, *, email: str = VIEWER) -> httpx.Response:
    return await client.post("/toucan/ask", json={"question": question}, headers={"x-dev-email": email})


async def _confirm(client, action_id: str, *, email: str = VIEWER):
    return await client.post(f"/toucan/actions/{action_id}/confirm", headers={"x-dev-email": email})


async def _cancel(client, action_id: str, *, email: str = VIEWER):
    return await client.post(f"/toucan/actions/{action_id}/cancel", headers={"x-dev-email": email})


async def _state() -> tuple[int, list[Message]]:
    async with app_db.async_session_maker() as session:
        convs = (await session.execute(select(func.count(Conversation.id)))).scalar_one()
        messages = list((await session.execute(select(Message))).scalars().all())
    return convs, messages


# --- pure resolution ---------------------------------------------------------------------------


def _targets(*titles: str) -> list[GroupTarget]:
    return [GroupTarget(conversation_id=f"g{i}", title=t) for i, t in enumerate(titles)]


@pytest.mark.parametrize(
    ("query", "titles", "expected"),
    [
        ("Design Team", ("Design Team", "Marketing"), ("Design Team",)),
        ("design-team", ("Design Team",), ("Design Team",)),
        ("Design", ("Design Team", "Marketing"), ("Design Team",)),
        ("Design", ("Design Team", "Design Review"), ("Design Team", "Design Review")),
        ("Design Team chat", ("Design Team",), ()),
        ("Sales", ("Design Team",), ()),
        ("Design Team", ("Design Team", "Design Team"), ("Design Team", "Design Team")),
    ],
)
async def test_group_resolution_is_exact_first_then_prefix_and_returns_every_candidate(query, titles, expected):
    assert tuple(t.title for t in resolve_group_targets(_targets(*titles), query)) == expected


async def test_connectorless_phrasing_offers_longest_recipient_readings_first():
    request = parse_action_request("Tell Project Alpha I'll join after lunch")
    assert isinstance(request, SendMessageRequest)
    assert request.readings() == (
        ("Project Alpha I'll", "join after lunch"),
        ("Project Alpha", "I'll join after lunch"),
        ("Project", "Alpha I'll join after lunch"),
    )
    # Equality still ignores the readings, so the A1.2 parser contract is unchanged.
    assert request == SendMessageRequest(recipient="Project", text="Alpha I'll join after lunch")


# --- proposal -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("question", "text"),
    [
        ("Message Design Team that I'll be late.", "I'll be late."),
        ("Send a message to Design Team: meeting moved to 3 PM", "meeting moved to 3 PM"),
        ("Tell Design Team I'll join after lunch", "I'll join after lunch"),
        ("tell the design team I'll join after lunch", "I'll join after lunch"),
    ],
)
async def test_unique_group_title_becomes_a_proposal_with_exact_text_and_sends_nothing(question, text):
    group_id = await _group("Design Team", VIEWER, MICAH, ALEX)
    async with await _client() as client:
        body = (await _ask(client, question)).json()
    assert body["intent"] == "action_proposal", body
    action = body["action"]
    assert action["action"] == "send_message"
    assert action["targetKind"] == "group"
    assert action["recipientLabel"] == "Design Team"
    assert action["message"] == text
    assert action["summary"] == "Send message to Design Team"
    assert "recipientEmail" not in action
    assert text in body["text"]
    convs, messages = await _state()
    assert (convs, messages) == (1, [])
    assert pending_actions._by_id[action["id"]].action.conversation_id == group_id


async def test_dm_send_still_resolves_a_person_with_target_kind_dm():
    await _group("Design Team", VIEWER, MICAH)
    async with await _client() as client:
        action = (await _ask(client, "Message Micah that I'll be back at 3.")).json()["action"]
    assert action["targetKind"] == "dm"
    assert action["recipientEmail"] == MICAH
    assert action["recipientLabel"] == "Micah Reyes"
    assert action["message"] == "I'll be back at 3."


@pytest.mark.parametrize(
    ("question", "fragment"),
    [
        ("Message Sales that I'll be late", "you're not in a group chat by that name"),
        ("Message Design that I'll be late", "More than one of your group chats matches \"Design\""),
    ],
)
async def test_unknown_or_ambiguous_group_asks_and_mints_nothing(question, fragment):
    await _group("Design Team", VIEWER, MICAH)
    await _group("Design Review", VIEWER, ALEX)
    async with await _client() as client:
        body = (await _ask(client, question)).json()
    assert fragment in body["text"], body["text"]
    assert "action" not in body
    assert pending_actions._by_id == {}
    assert (await _state())[1] == []


async def test_a_group_the_caller_does_not_belong_to_is_unknown_to_them():
    await _group("Marketing", MICAH, ALEX)  # Bon is not a member
    async with await _client() as client:
        body = (await _ask(client, "Message Marketing that I'll be late")).json()
    assert "action" not in body
    assert "you're not in a group chat by that name" in body["text"]
    assert (await _state())[1] == []


async def test_person_and_group_sharing_a_name_is_a_question_not_a_guess():
    await _group("Micah", VIEWER, MICAH, ALEX)  # a group literally titled like the person
    async with await _client() as client:
        body = (await _ask(client, "Message Micah that I'll be late")).json()
    assert "action" not in body
    assert "could be a person (\"Micah Reyes\") or a group chat (\"Micah\")" in body["text"]
    assert "the person or the group" in body["text"]
    assert pending_actions._by_id == {}


async def test_toucan_never_creates_a_group():
    async with await _client() as client:
        for q in (
            "Message Design Team that hi",
            "Send a message to Design Team: hi",
            "create a group called Design Team",
        ):
            res = await _ask(client, q)
            assert res.status_code == 200
            assert "action" not in res.json()
    assert (await _state()) == (0, [])


# --- confirm / cancel / replay / expiry / membership ---------------------------------------------


async def _propose(client, question: str = "Message Design Team that I'll be late.") -> str:
    body = (await _ask(client, question)).json()
    assert "action" in body, body
    return body["action"]["id"]


async def test_confirm_sends_exactly_once_into_the_existing_group():
    group_id = await _group("Design Team", VIEWER, MICAH, ALEX)
    async with await _client() as client:
        action_id = await _propose(client)
        assert (await _state())[1] == []
        res = await _confirm(client, action_id)
        assert res.status_code == 200
        result = res.json()
        assert result["outcome"] == "executed"
        assert result["targetKind"] == "group"
        assert result["conversationId"] == group_id
        assert result["text"] == "Done — I sent your message to Design Team."
        convs, messages = await _state()
        assert convs == 1  # nothing new was created
        assert [(m.conversation_id, m.sender_email, m.text) for m in messages] == [
            (group_id, VIEWER, "I'll be late.")
        ]
        assert result["messageId"] == messages[0].id
        assert (await _confirm(client, action_id)).status_code == 404
        assert len((await _state())[1]) == 1
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.get_conversation_by_id(session, group_id)
    assert set(conv["participant_ids"]) == {VIEWER, MICAH, ALEX}  # membership untouched


async def test_cancel_and_expiry_send_nothing(monkeypatch):
    await _group("Design Team", VIEWER, MICAH)
    async with await _client() as client:
        action_id = await _propose(client)
        res = await _cancel(client, action_id)
        assert res.json()["outcome"] == "cancelled"
        assert res.json()["text"] == "Okay, cancelled — I haven't sent anything."
        assert (await _confirm(client, action_id)).status_code == 404

        monkeypatch.setattr(settings, "TOUCAN_ACTION_TTL_SECONDS", 0.0)
        action_id = await _propose(client)
        assert (await _confirm(client, action_id)).status_code == 404
    assert (await _state())[1] == []


async def test_membership_removed_between_proposal_and_confirm_fails_closed():
    group_id = await _group("Design Team", VIEWER, MICAH, ALEX)
    async with await _client() as client:
        action_id = await _propose(client)
        async with app_db.async_session_maker() as session:
            await session.execute(
                delete(ConversationParticipant).where(
                    ConversationParticipant.conversation_id == group_id,
                    ConversationParticipant.participant_email == VIEWER,
                )
            )
            await session.commit()
        res = await _confirm(client, action_id)
        assert res.status_code == 409
        assert res.json()["error"] == "Not a participant"
        # Consumed, not retryable into a send.
        assert (await _confirm(client, action_id)).status_code == 404
    assert (await _state())[1] == []


async def test_owner_mismatch_cannot_send_to_the_owners_group():
    await _group("Design Team", VIEWER, MICAH)
    async with await _client() as client:
        action_id = await _propose(client)
        assert (await _confirm(client, action_id, email=MICAH)).status_code == 404
        assert (await _state())[1] == []


# --- live fan-out through the seam --------------------------------------------------------------


async def test_confirmed_group_send_reaches_both_connected_members_live_with_unread_counts():
    group_id = await _group("Design Team", VIEWER, MICAH, ALEX)
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    clients: dict[str, socketio.AsyncClient] = {}
    try:
        incoming: dict[str, asyncio.Future] = {}
        unread: dict[str, asyncio.Future] = {}
        for email in (MICAH, ALEX):
            c = socketio.AsyncClient()
            await asyncio.wait_for(
                c.connect(f"http://127.0.0.1:{port}", auth={"x-dev-email": email},
                          socketio_path="socket.io", transports=["websocket"]),
                timeout=5,
            )
            clients[email] = c
            incoming[email] = asyncio.get_event_loop().create_future()
            unread[email] = asyncio.get_event_loop().create_future()

            def _bind(e, sock):
                @sock.on("incoming_message")
                async def on_incoming(data):
                    if not incoming[e].done():
                        incoming[e].set_result(data)

                @sock.on("unread_count")
                async def on_unread(data):
                    if not unread[e].done():
                        unread[e].set_result(data)

            _bind(email, c)
        await asyncio.sleep(0.2)

        async with await _client() as client:
            action_id = await _propose(client)
            await asyncio.sleep(0.1)
            assert not any(f.done() for f in incoming.values())  # proposing delivers nothing
            assert (await _confirm(client, action_id)).status_code == 200

        for email in (MICAH, ALEX):
            got = await asyncio.wait_for(incoming[email], timeout=2)
            count = await asyncio.wait_for(unread[email], timeout=2)
            assert got["message"]["text"] == "I'll be late."
            assert got["message"]["senderId"] == VIEWER
            assert got["message"]["conversationId"] == group_id
            assert count == {"conversationId": group_id, "count": 1}
    finally:
        for c in clients.values():
            await c.disconnect()
        srv.should_exit = True
        await task
        settings.APP_ENV = original_env


# --- privacy + regression -----------------------------------------------------------------------


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


async def test_no_group_message_bodies_or_titles_enter_ai_context(monkeypatch):
    group_id = await _group("Quokka Squad", VIEWER, MICAH)
    secret = "SECRET-GROUP-BODY-do-not-leak"
    async with app_db.async_session_maker() as session:
        await chat_repo.insert_message(session, group_id, MICAH, secret)
        await session.commit()
    fake = FakeProvider("Happy to help!")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(provider, "_request_reply", fake)
    async with await _client() as client:
        action_id = await _propose(client, "message quokka squad that the deck is ready")
        assert (await _confirm(client, action_id)).status_code == 200
        assert (await _ask(client, "what should I tell the team next")).status_code == 200
    assert fake.calls
    assert secret not in fake.sent_text
    assert "the deck is ready" not in fake.sent_text
    assert "Quokka Squad" not in fake.sent_text


async def test_provider_relayed_group_name_is_resolved_server_side(monkeypatch):
    await _group("Design Team", VIEWER, MICAH)
    fake = FakeProvider(("Sure.", ("send_message", json.dumps({"recipient": "design team", "text": "running late"}))))
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(provider, "_request_reply", fake)
    async with await _client() as client:
        action = (await _ask(client, "would you mind letting the design folks know I'm running late")).json()["action"]
    assert action["targetKind"] == "group"
    assert action["recipientLabel"] == "Design Team"
    assert action["message"] == "running late"
    assert (await _state())[1] == []


async def test_set_status_is_unaffected():
    await _group("Design Team", VIEWER, MICAH)
    async with await _client() as client:
        action = (await _ask(client, "set me to busy")).json()["action"]
        assert action["action"] == "set_status" and "targetKind" not in action
        result = (await _confirm(client, action["id"])).json()
    assert result["outcome"] == "executed" and result["status"] == "BUSY"
    assert (await _state())[1] == []
