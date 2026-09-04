from __future__ import annotations

import asyncio
import uuid

import pytest
import socketio
import uvicorn

from app import database as app_db
from app.config import settings
from app.database import Base
from app.main import app as combined_app
from app.repositories import chat as chat_repo
from app.repositories import toucan_delegation as repo
from app.repositories import toucan_urgency as urgency_repo
from app.services.chat_delegation import reply_gate
from app.services.chat_send import TOUCAN_CHAT_SENDER
from app.services.toucan.delegation import (
    SCOPE_DM_AND_GROUPS,
    combined_first_reply_text,
    first_reply_text,
    follow_up_reply_text,
)
from app.services.toucan.urgency import urgent_flagged_reply_text
from app.services.toucan_ai import provider

# A3 — URGENCY over the real socket path, on the isolated throwaway database. Same rig as
# test_toucan_delegation_socket.py. Everything here is deterministic: a provider call is a failure.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server(isolated_app_db, monkeypatch):
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
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


async def _settle(seconds: float = 0.4) -> None:
    await asyncio.sleep(seconds)


def _fresh(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


async def _dm(a: str, b: str) -> str:
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, a, b)
    return conv["id"]


async def _group(creator: str, members: list[str], title: str = "Team") -> str:
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.create_group_conversation(session, creator, members, title=title)
    return conv["id"]


async def _delegate(owner: str, minutes: int = 120, scope: str = SCOPE_DM_AND_GROUPS):
    async with app_db.async_session_maker() as session:
        row, _ = await repo.start_delegation(session, owner_email=owner, duration_minutes=minutes, scope=scope)
    return row


async def _messages(conv_id: str) -> list:
    async with app_db.async_session_maker() as session:
        return await chat_repo.list_messages(session, conv_id)


async def _toucan_texts(conv_id: str) -> list[str]:
    return [m.text for m in await _messages(conv_id) if m.sender_email == TOUCAN_CHAT_SENDER]


async def _flags(owner: str) -> list:
    async with app_db.async_session_maker() as session:
        return await urgency_repo.list_unseen(session, owner_email=owner)


async def _send(client, conv_id: str, text: str, temp: str = "t", mentions: list[str] | None = None) -> None:
    payload = {"conversationId": conv_id, "text": text, "clientTempId": temp}
    if mentions is not None:
        payload["mentionedEmails"] = mentions
    await client.emit("send_message", payload)
    await _settle()


# --- DM: the question becomes functional --------------------------------------------------------


async def test_yes_to_the_question_records_one_flag_one_confirmation_and_one_owner_event(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    row = await _delegate(bon)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    b_urgent = _collector(b, "delegation_urgent_flagged")
    m_urgent = _collector(m, "delegation_urgent_flagged")

    await _send(m, conv_id, "can you look at the invoice?", "a")
    assert await _toucan_texts(conv_id) == [first_reply_text(bon)]
    assert await _flags(bon) == []

    # The "yes" lands well inside the cooldown — the carve-out lets the confirmation through.
    await _send(m, conv_id, "yes", "b")
    texts = await _toucan_texts(conv_id)
    assert texts == [first_reply_text(bon), urgent_flagged_reply_text([bon])]
    flags = await _flags(bon)
    assert len(flags) == 1
    flag = flags[0]
    assert (flag.delegation_id, flag.conversation_id, flag.requester_email) == (row.id, conv_id, micah)
    assert flag.message_reference is not None and flag.seen_at is None
    assert b_urgent == [
        {
            "flagId": flag.id,
            "delegationId": row.id,
            "conversationId": conv_id,
            "requesterEmail": micah,
            "flaggedAt": b_urgent[0]["flaggedAt"],
            "urgentCount": 1,
        }
    ]
    assert b_urgent[0]["flaggedAt"].endswith("Z")
    assert m_urgent == []  # owner-only, never to the requester

    # A second "yes" (and a "yes please") change nothing: no flag, no reply, no event.
    await _send(m, conv_id, "yes!", "c")
    await _send(m, conv_id, "yes please", "d")
    assert await _toucan_texts(conv_id) == texts
    assert len(await _flags(bon)) == 1
    assert len(b_urgent) == 1
    async with app_db.async_session_maker() as session:
        active = await repo.get_active_delegation(session, owner_email=bon)
    assert active.reply_count == 2
    for c in (b, m):
        await c.disconnect()


async def test_an_explicit_marker_in_the_first_message_flags_immediately_without_asking(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    b_urgent = _collector(b, "delegation_urgent_flagged")

    await _send(m, conv_id, "URGENT: the client demo is broken", "a")
    assert await _toucan_texts(conv_id) == [urgent_flagged_reply_text([bon])]
    assert len(await _flags(bon)) == 1 and len(b_urgent) == 1

    # A later ordinary message takes the A2 path (here: suppressed by the default cooldown), and a
    # repeated explicit marker is not a second flag.
    await _send(m, conv_id, "also urgent: the other thing", "b")
    assert len(await _flags(bon)) == 1 and len(b_urgent) == 1
    assert len(await _toucan_texts(conv_id)) == 1
    for c in (b, m):
        await c.disconnect()


async def test_negatives_create_nothing_and_a_bare_no_to_the_question_is_silence(server, monkeypatch):
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    b_urgent = _collector(b, "delegation_urgent_flagged")

    await _send(m, conv_id, "ping", "a")
    assert await _toucan_texts(conv_id) == [first_reply_text(bon)]
    await _send(m, conv_id, "no, not urgent", "b")
    await _send(m, conv_id, "no", "c")
    # Both negatives: no flag, no event, and no follow-up acknowledgement either — they answered.
    assert await _toucan_texts(conv_id) == [first_reply_text(bon)]
    assert await _flags(bon) == [] and b_urgent == []
    # An ordinary message afterwards resumes the A2 follow-up exactly as before.
    await _send(m, conv_id, "ok, then please look tomorrow", "d")
    assert await _toucan_texts(conv_id) == [first_reply_text(bon), follow_up_reply_text(bon)]
    for c in (b, m):
        await c.disconnect()


async def test_a_bare_yes_to_no_question_is_an_ordinary_message(server, monkeypatch):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)

    # Nothing outstanding: "yes" gets the ordinary first acknowledgement and no flag.
    await _send(m, conv_id, "yes", "a")
    assert await _toucan_texts(conv_id) == [first_reply_text(bon)]
    assert await _flags(bon) == []

    # Outside the urgency window the question has lapsed: another "yes" is ordinary again.
    monkeypatch.setattr(settings, "TOUCAN_URGENCY_WINDOW_SECONDS", 0.0)
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    await _send(m, conv_id, "yes", "b")
    assert await _toucan_texts(conv_id) == [first_reply_text(bon), follow_up_reply_text(bon)]
    assert await _flags(bon) == []
    await m.disconnect()


async def test_owner_and_toucan_never_flag_and_no_delegation_means_nothing(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send(m, conv_id, "urgent!", "a")  # no delegation
    assert await _toucan_texts(conv_id) == [] and await _flags(bon) == []
    await _delegate(bon)
    await _send(b, conv_id, "this is urgent, on it", "b")  # the owner's own words
    assert await _toucan_texts(conv_id) == [] and await _flags(bon) == [] and await _flags(micah) == []
    for c in (b, m):
        await c.disconnect()


# --- A2 protections are intact ------------------------------------------------------------------


async def test_cooldown_and_cap_still_bound_ordinary_messages_and_the_confirmation_counts(server, monkeypatch):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)

    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 3600.0)
    for i in range(3):
        await m.emit("send_message", {"conversationId": conv_id, "text": f"ping {i}", "clientTempId": f"c{i}"})
    await _settle(0.8)
    assert await _toucan_texts(conv_id) == [first_reply_text(bon)]

    # The confirmation is the ONLY thing that crosses the cooldown…
    await _send(m, conv_id, "yes", "y")
    assert await _toucan_texts(conv_id) == [first_reply_text(bon), urgent_flagged_reply_text([bon])]
    # …and it consumed A2 budget: with the cooldown off and the cap at 2, nothing more is said.
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_MAX_REPLIES_PER_CONVERSATION", 2)
    for i in range(3):
        await _send(m, conv_id, f"pong {i}", f"p{i}")
    assert len(await _toucan_texts(conv_id)) == 2
    human = [x for x in await _messages(conv_id) if x.sender_email == micah]
    assert len(human) == 7
    async with app_db.async_session_maker() as session:
        active = await repo.get_active_delegation(session, owner_email=bon)
    assert active.reply_count == 2
    await m.disconnect()


async def test_at_toucan_keeps_the_a14_path_even_when_it_says_urgent(server, monkeypatch):
    from app.services import chat_assistant

    async def _fake_reply(*a, **k):
        return "canned"

    monkeypatch.setattr(chat_assistant, "generate_chat_reply", _fake_reply, raising=False)
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send(m, conv_id, "@Toucan is Bon around? it's urgent", "a")
    assert await _flags(bon) == []
    texts = await _toucan_texts(conv_id)
    assert urgent_flagged_reply_text([bon]) not in texts and first_reply_text(bon) not in texts
    await m.disconnect()


# --- groups -------------------------------------------------------------------------------------


async def test_group_yes_without_a_fresh_mention_answers_the_outstanding_question(server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    row = await _delegate(bon)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    a = await _connect_as(server, alex)
    await asyncio.sleep(0.2)
    b_urgent = _collector(b, "delegation_urgent_flagged")
    a_urgent = _collector(a, "delegation_urgent_flagged")

    await _send(m, conv_id, "@Bon can you look at this?", "a", mentions=[bon])
    assert await _toucan_texts(conv_id) == [first_reply_text(bon)]
    # Chatter from somebody else, no mention: nothing (A2), and no flag.
    await _send(a, conv_id, "lunch?", "b", mentions=[])
    assert len(await _toucan_texts(conv_id)) == 1 and await _flags(bon) == []
    # Micah answers Toucan without re-mentioning Bon.
    await _send(m, conv_id, "yes", "c", mentions=[])
    assert await _toucan_texts(conv_id) == [first_reply_text(bon), urgent_flagged_reply_text([bon])]
    flags = await _flags(bon)
    assert len(flags) == 1 and flags[0].requester_email == micah and flags[0].delegation_id == row.id
    assert len(b_urgent) == 1 and a_urgent == []
    for c in (b, m, a):
        await c.disconnect()


async def test_group_explicit_marker_needs_a_mention_and_dm_scope_rows_never_flag(server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    await _delegate(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send(m, conv_id, "urgent: prod is down", "a", mentions=[])  # no mention, no question
    assert await _toucan_texts(conv_id) == [] and await _flags(bon) == []
    await _send(m, conv_id, "@Bon urgent: prod is down", "b", mentions=[bon])
    assert await _toucan_texts(conv_id) == [urgent_flagged_reply_text([bon])]
    assert len(await _flags(bon)) == 1
    await m.disconnect()


async def test_a_dm_scoped_row_never_flags_in_a_group(server):
    # A dm-scoped (A2.1) row is not addressed in groups at all — not for urgency either.
    dm_owner, peer = _fresh("dm"), _fresh("peer")
    conv_id = await _group(dm_owner, [peer])
    await _delegate(dm_owner, scope="dm")
    p = await _connect_as(server, peer)
    await asyncio.sleep(0.2)
    await _send(p, conv_id, f"@{dm_owner} urgent", "c", mentions=[dm_owner])
    assert await _toucan_texts(conv_id) == [] and await _flags(dm_owner) == []
    await p.disconnect()


async def test_two_delegated_owners_earn_one_combined_confirmation_and_one_flag_each(server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(alex, [bon, micah])
    bon_row = await _delegate(bon)
    micah_row = await _delegate(micah)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    a = await _connect_as(server, alex)
    await asyncio.sleep(0.2)
    b_urgent = _collector(b, "delegation_urgent_flagged")
    m_urgent = _collector(m, "delegation_urgent_flagged")

    await _send(a, conv_id, "@Bon @Micah ping", "a", mentions=[bon, micah])
    assert await _toucan_texts(conv_id) == [combined_first_reply_text([bon, micah])]
    await _send(a, conv_id, "yes it is", "b", mentions=[])
    assert await _toucan_texts(conv_id) == [
        combined_first_reply_text([bon, micah]),
        urgent_flagged_reply_text([bon, micah]),
    ]
    bon_flags, micah_flags = await _flags(bon), await _flags(micah)
    assert [f.delegation_id for f in bon_flags] == [bon_row.id]
    assert [f.delegation_id for f in micah_flags] == [micah_row.id]
    assert len(b_urgent) == 1 and len(m_urgent) == 1
    assert b_urgent[0]["delegationId"] == bon_row.id and m_urgent[0]["delegationId"] == micah_row.id
    for c in (b, m, a):
        await c.disconnect()


# --- return: the flags outlive the delegation -----------------------------------------------------


async def test_flags_survive_the_delegation_ending_and_the_owner_marks_them_seen(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    await _delegate(bon)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send(m, conv_id, "asap please", "a")
    assert len(await _flags(bon)) == 1
    async with app_db.async_session_maker() as session:
        ended = await repo.end_delegation(session, owner_email=bon)
    assert ended is not None
    flags = await _flags(bon)
    assert len(flags) == 1
    # Once ended, a new declaration has no live delegation to attach to.
    await _send(m, conv_id, "urgent again", "b")
    assert len(await _flags(bon)) == 1 and len(await _toucan_texts(conv_id)) == 1
    async with app_db.async_session_maker() as session:
        assert await urgency_repo.mark_seen(session, owner_email=bon, flag_ids=[flags[0].id]) == 1
    assert await _flags(bon) == []
    for c in (b, m):
        await c.disconnect()
