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


# =====================================================================================================
# A2.2 — groups: only a server-validated @mention of a delegated owner earns a reply; several
# mentioned owners earn ONE combined reply.
# =====================================================================================================

from app.services.chat_assistant import FAILURE_REPLY
from app.services.toucan.delegation import (
    SCOPE_DM_AND_GROUPS,
    combined_first_reply_text,
    combined_follow_up_reply_text,
)


async def _group(creator: str, members: list[str], title: str = "Team") -> str:
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.create_group_conversation(session, creator, members, title=title)
    return conv["id"]


async def _delegate_groups(owner: str, minutes: int = 120, now=None):
    async with app_db.async_session_maker() as session:
        row, _ = await repo.start_delegation(
            session, owner_email=owner, duration_minutes=minutes, scope=SCOPE_DM_AND_GROUPS, now=now
        )
    return row


async def _send_group(client, conv_id: str, text: str, mentions: list[str] | None, temp: str = "g") -> None:
    payload = {"conversationId": conv_id, "text": text, "clientTempId": temp}
    if mentions is not None:
        payload["mentionedEmails"] = mentions
    await client.emit("send_message", payload)
    await _settle()


async def test_validated_group_mention_of_a_delegated_owner_earns_one_reply_that_fans_out(server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    await _delegate_groups(bon)
    m = await _connect_as(server, micah)
    a = await _connect_as(server, alex)
    b = await _connect_as(server, bon)
    await asyncio.sleep(0.2)
    a_in = _collector(a, "incoming_message")
    b_in = _collector(b, "incoming_message")
    m_in = _collector(m, "incoming_message")

    await _send_group(m, conv_id, "@Bon can you look at this?", [bon])
    await _wait_until(lambda: len(a_in) >= 2 and len(b_in) >= 2 and len(m_in) >= 1)
    await _settle()

    expected = first_reply_text(bon)
    assert [x["message"]["senderId"] for x in a_in] == [micah, TOUCAN_CHAT_SENDER]
    assert a_in[1]["message"]["text"] == expected and expected.startswith("Toucan — assisting ")
    assert b_in[1]["message"]["text"] == expected
    assert m_in[0]["message"]["text"] == expected
    msgs = await _messages(conv_id)
    assert [x.sender_email for x in msgs] == [micah, TOUCAN_CHAT_SENDER]
    assert msgs[0].mentioned_emails == [bon]
    assert len(await _toucan_messages(conv_id)) == 1
    async with app_db.async_session_maker() as session:
        active = await repo.get_active_delegation(session, owner_email=bon)
        owner_unread = await chat_repo.unread_count(session, conv_id, bon)
        peer_unread = await chat_repo.unread_count(session, conv_id, alex)
    assert active.reply_count == 1
    # Unread characterization for groups, same seam behavior as DMs: the owner's unread includes
    # the human message and Toucan's acknowledgement (2); every other member sees both too (2).
    assert owner_unread == 2 and peer_unread == 2
    for c in (m, a, b):
        await c.disconnect()


async def test_group_chatter_plain_names_dm_scope_expired_and_cancelled_are_silent(server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)

    # scope="dm" (an A2.1 row) never answers in a group, even when validly mentioned.
    await _delegate(bon)
    await _send_group(m, conv_id, "@Bon ping", [bon], "s1")
    assert await _toucan_messages(conv_id) == []

    # Upgrade to groups: chatter and a plain-text name earn nothing.
    await _delegate_groups(bon)
    await _send_group(m, conv_id, "anyone free for lunch?", None, "s2")
    await _send_group(m, conv_id, "Bon said he'd review it", None, "s3")
    await _send_group(m, conv_id, "@Bon-ish text without a validated mention", [], "s4")
    assert await _toucan_messages(conv_id) == []

    # Expired.
    await _delegate_groups(bon, minutes=60, now=datetime.now(timezone.utc) - timedelta(hours=3))
    await _send_group(m, conv_id, "@Bon?", [bon], "s5")
    assert await _toucan_messages(conv_id) == []

    # Cancelled.
    await _delegate_groups(bon)
    async with app_db.async_session_maker() as session:
        await repo.end_delegation(session, owner_email=bon)
    await _send_group(m, conv_id, "@Bon??", [bon], "s6")
    assert await _toucan_messages(conv_id) == []
    # Every human message persisted regardless.
    assert len([x for x in await _messages(conv_id) if x.sender_email == micah]) == 6
    await m.disconnect()


async def test_group_guards_non_participants_toucan_senders_and_owner_self_mention(server):
    bon, micah, alex, outsider = _fresh("bon"), _fresh("micah"), _fresh("alex"), _fresh("out")
    conv_id = await _group(bon, [micah, alex])
    await _delegate_groups(bon)
    await _delegate_groups(outsider)
    # A mention list naming a delegated NON-participant earns nothing (the socket path could never
    # even store it — insert_message validates membership — so exercise the evaluation directly).
    assert await evaluate_and_reply(conv_id, micah, "g1", [outsider]) is None
    # Toucan as sender, and an owner mentioning themself, earn nothing.
    assert await evaluate_and_reply(conv_id, TOUCAN_CHAT_SENDER, "g2", [bon]) is None
    assert await evaluate_and_reply(conv_id, bon, "g3", [bon]) is None
    # A sender outside the group earns nothing.
    assert await evaluate_and_reply(conv_id, outsider, "g4", [bon]) is None
    assert await _toucan_messages(conv_id) == []


async def test_group_cooldown_and_cap(server, monkeypatch):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    await _delegate_groups(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 3600.0)
    for i in range(3):
        await m.emit("send_message", {"conversationId": conv_id, "text": f"@Bon {i}", "clientTempId": f"c{i}", "mentionedEmails": [bon]})
    await _settle(0.8)
    assert len(await _toucan_messages(conv_id)) == 1
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_MAX_REPLIES_PER_CONVERSATION", 2)
    for i in range(3):
        await _send_group(m, conv_id, f"@Bon again {i}", [bon], f"p{i}")
    assert [t.text for t in await _toucan_messages(conv_id)] == [first_reply_text(bon), follow_up_reply_text(bon)]
    await m.disconnect()


async def test_two_mentioned_delegated_owners_earn_exactly_one_combined_reply(server, monkeypatch):
    bon, micah, alex, jan = _fresh("bon"), _fresh("micah"), _fresh("alex"), _fresh("jan")
    conv_id = await _group(bon, [micah, alex, jan])
    await _delegate_groups(bon)
    await _delegate_groups(micah)
    await _delegate(jan)  # dm-only: mentioned, but NOT eligible in a group
    a = await _connect_as(server, alex)
    await asyncio.sleep(0.2)
    a_in = _collector(a, "incoming_message")

    # Mention order on the wire is arbitrary; the label is not.
    await _send_group(a, conv_id, "@Micah @Jan @Bon standup?", [micah, jan, bon])
    toucan = await _toucan_messages(conv_id)
    assert len(toucan) == 1
    assert toucan[0].text == combined_first_reply_text([bon, micah])
    assert toucan[0].text.startswith("Toucan — assisting ") and "and" in toucan[0].text
    assert "Jan" not in toucan[0].text
    assert [x["message"]["senderId"] for x in a_in] == [TOUCAN_CHAT_SENDER]
    async with app_db.async_session_maker() as session:
        for owner, expected in ((bon, 1), (micah, 1), (jan, 0)):
            active = await repo.get_active_delegation(session, owner_email=owner)
            assert active.reply_count == expected, owner

    # Follow-up, still one message; the gate counts one reply per owner, not per owner-pair.
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    await _send_group(a, conv_id, "@Bon @Micah anyone?", [bon, micah], "g2")
    toucan = await _toucan_messages(conv_id)
    assert [t.text for t in toucan] == [combined_first_reply_text([bon, micah]), combined_follow_up_reply_text([bon, micah])]

    # Cap reached for Bon only (cap=2): Micah alone is still eligible → the reply names Micah only.
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_MAX_REPLIES_PER_CONVERSATION", 3)
    await _send_group(a, conv_id, "@Bon @Micah please", [bon, micah], "g3")
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_MAX_REPLIES_PER_CONVERSATION", 4)
    async with app_db.async_session_maker() as session:
        await repo.end_delegation(session, owner_email=bon)
    await _send_group(a, conv_id, "@Bon @Micah last one", [bon, micah], "g4")
    toucan = await _toucan_messages(conv_id)
    assert len(toucan) == 4
    assert toucan[-1].text == follow_up_reply_text(micah)
    await a.disconnect()


async def test_at_toucan_plus_delegated_mention_uses_the_a14_path_only(server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    await _delegate_groups(bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    # The prompt "@Bon" reaches A1.4, whose provider is patched to fail → its deterministic
    # fallback. Exactly one Toucan message, and it is NOT a delegation acknowledgement.
    await _send_group(m, conv_id, "@Toucan @Bon", [bon])
    toucan = await _toucan_messages(conv_id)
    assert [t.text for t in toucan] == [FAILURE_REPLY]
    assert not any("assisting" in t.text for t in toucan)
    await m.disconnect()


# =====================================================================================================
# A2.3 — return detection over the real socket path. Conservative by design: only the owner's own
# message, an explicit check-in, or a reconnect that closed a PROVEN absence ends until_return.
# =====================================================================================================

from app.repositories import toucan_activity as activity_repo
from app.services.toucan.delegation import END_UNTIL_RETURN


async def _delegate_until_return(owner: str):
    async with app_db.async_session_maker() as session:
        row, _ = await repo.start_delegation(
            session, owner_email=owner, end_condition=END_UNTIL_RETURN, scope=SCOPE_DM_AND_GROUPS
        )
    return row


async def _status(owner: str) -> tuple[str, str | None]:
    async with app_db.async_session_maker() as session:
        rows = await repo.list_delegations(session, owner_email=owner)
    return rows[0].status, rows[0].ended_reason


async def _seen_recently(owner: str, seconds_ago: float) -> None:
    """Plant the presence cursor: the owner was last seen `seconds_ago` (a departure candidate)."""
    async with app_db.async_session_maker() as session:
        await activity_repo.record_departure(
            session, email=owner, now=datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)
        )
        await session.commit()


async def test_refresh_short_reconnect_second_tab_and_message_read_do_not_end_until_return(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    b1 = await _connect_as(server, bon)
    await asyncio.sleep(0.2)
    await _delegate_until_return(bon)
    ended = _collector(b1, "delegation_ended")

    # Second tab while the first is live.
    b2 = await _connect_as(server, bon)
    await asyncio.sleep(0.3)
    assert await _status(bon) == ("active", None)
    # Refresh / HMR / blip: the last socket drops and comes back well inside the 300 s gap.
    await b1.disconnect()
    await b2.disconnect()
    await asyncio.sleep(0.2)
    b3 = await _connect_as(server, bon)
    await asyncio.sleep(0.3)
    assert await _status(bon) == ("active", None)
    # A peer's message and the owner READING it are not return signals.
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    await _send_and_settle(m, conv_id, "you there?")
    await b3.emit("message_read", {"conversationId": conv_id})
    await asyncio.sleep(0.3)
    assert await _status(bon) == ("active", None)
    assert ended == []
    # And Toucan DID acknowledge on Bon's behalf meanwhile.
    assert len(await _toucan_messages(conv_id)) == 1
    for c in (b3, m):
        await c.disconnect()


async def test_owner_message_ends_until_return_with_owner_only_event(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    b = await _connect_as(server, bon)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    row = await _delegate_until_return(bon)
    b_ended = _collector(b, "delegation_ended")
    m_ended = _collector(m, "delegation_ended")
    m_in = _collector(m, "incoming_message")

    await _send_and_settle(b, conv_id, "back at my desk")
    assert await _status(bon) == ("ended", "returned")
    assert b_ended == [{"delegationId": row.id, "reason": "returned"}]
    assert m_ended == []  # never broadcast to conversation participants
    assert [x["message"]["senderId"] for x in m_in] == [bon]
    # No more acknowledgements now.
    await _send_and_settle(m, conv_id, "welcome back")
    assert await _toucan_messages(conv_id) == []
    for c in (b, m):
        await c.disconnect()


async def test_explicit_come_online_ends_until_return_but_timed_rows_survive(server):
    bon = _fresh("bon")
    b = await _connect_as(server, bon)
    await asyncio.sleep(0.2)
    await _delegate_until_return(bon)
    ended = _collector(b, "delegation_ended")
    await b.emit("come_online", {})
    await asyncio.sleep(0.3)
    assert await _status(bon) == ("ended", "returned")
    assert [e["reason"] for e in ended] == ["returned"]
    # A timed delegation is not presence tracking: check-in leaves it alone.
    await _delegate(bon)
    await b.emit("come_online", {})
    await asyncio.sleep(0.3)
    assert await _status(bon) == ("active", None)
    await b.disconnect()


async def test_reconnect_after_a_proven_absence_ends_until_return(server):
    bon = _fresh("bon")
    await _delegate_until_return(bon)
    # Last seen 10 minutes ago (≥ the 300 s threshold) with no live socket: this connect closes a
    # real absence and is the owner's only socket → returned.
    await _seen_recently(bon, seconds_ago=600)
    b = await _connect_as(server, bon)
    await asyncio.sleep(0.3)
    assert await _status(bon) == ("ended", "returned")
    await b.disconnect()

    # Below the threshold: a 2-minute gap is a blip, not a return.
    bon2 = _fresh("bon")
    await _delegate_until_return(bon2)
    await _seen_recently(bon2, seconds_ago=120)
    b2 = await _connect_as(server, bon2)
    await asyncio.sleep(0.3)
    assert await _status(bon2) == ("active", None)
    await b2.disconnect()


# =====================================================================================================
# A2.4 — grounded delegated answers over the real socket path. A fake provider stands in for OpenAI;
# every wall is exercised: when it is consulted, what it receives, and what it takes to be believed.
# =====================================================================================================

import json as _json

from app.services.toucan.delegation_grounding import grounded_reply_text

DRIVE = "The presentation is in the shared Drive folder."


class GroundedFake:
    """Records every provider request; answers with a canned verdict (or raises)."""

    def __init__(self, reply=None):
        self.reply = reply
        self.calls: list[dict] = []

    async def __call__(self, messages, *, model, max_output_tokens, timeout, tools=None):
        self.calls.append({"messages": messages, "tools": tools})
        if isinstance(self.reply, Exception):
            raise self.reply
        if callable(self.reply):
            return self.reply(self.window)
        return self.reply

    @property
    def window(self) -> list[dict]:
        return _json.loads(self.calls[-1]["messages"][0]["content"].split("oldest first) ===\n", 1)[1])

    @property
    def question(self) -> str:
        return self.calls[-1]["messages"][1]["content"]


def _cites_owner(window):
    ids = [t["id"] for t in window if t["fromOwner"]]
    return _json.dumps({"canAnswer": True, "answer": "Earlier in this conversation, Bon said the presentation is in the shared Drive folder.", "evidenceMessageIds": ids[:1]})


@pytest.fixture
def grounded(server, monkeypatch):
    fake = GroundedFake(_cites_owner)
    monkeypatch.setattr(provider, "_request_reply", fake)
    return fake


async def _seed_owner_fact(conv_id: str, owner: str) -> str:
    async with app_db.async_session_maker() as session:
        m = await chat_repo.insert_message(session, conv_id, owner, DRIVE)
        await session.commit()
        return m.id


async def _bon_and_micah_dm(server):
    bon, micah = _fresh("bon"), _fresh("micah")
    conv_id = await _dm(bon, micah)
    m = await _connect_as(server, micah)
    await asyncio.sleep(0.2)
    return bon, micah, conv_id, m


async def test_dm_factual_question_gets_a_grounded_answer_citing_only_owner_evidence(grounded, server):
    bon, _micah, conv_id, m = await _bon_and_micah_dm(server)
    fact_id = await _seed_owner_fact(conv_id, bon)
    await _delegate(bon)
    other_conv = await _dm(bon, _fresh("alex"))
    await _seed_owner_fact(other_conv, bon)  # a SECOND conversation with the same fact — must not appear
    m_in = _collector(m, "incoming_message")

    await _send_and_settle(m, conv_id, "@Bon where is the presentation?")
    toucan = await _toucan_messages(conv_id)
    assert [t.text for t in toucan] == [grounded_reply_text(bon, "Earlier in this conversation, Bon said the presentation is in the shared Drive folder.")]
    assert toucan[0].text.startswith("Toucan — assisting ") and " said " in toucan[0].text
    assert m_in[-1]["message"]["senderId"] == TOUCAN_CHAT_SENDER and m_in[-1]["message"]["text"] == toucan[0].text
    # What the provider saw: this conversation's window only, the owner fact flagged, the question
    # with the mention stripped, no tools, and nothing from the other conversation.
    assert len(grounded.calls) == 1 and grounded.calls[0]["tools"] is None
    assert grounded.question == "where is the presentation?"
    assert [t["id"] for t in grounded.window] == [fact_id]
    from app.services.toucan.delegation import display_name_from_email

    assert grounded.window[0] == {"id": fact_id, "author": display_name_from_email(bon), "fromOwner": True, "text": DRIVE}
    system = grounded.calls[0]["messages"][0]["content"]
    for absent in ("OFFICE CONTEXT", "MEMORIES", "unread", "roster"):
        assert absent not in system
    # Unread semantics unchanged: owner sees the peer's question and Toucan's answer as unread.
    async with app_db.async_session_maker() as session:
        assert await chat_repo.unread_count(session, conv_id, bon) == 2
        assert (await repo.get_active_delegation(session, owner_email=bon)).reply_count == 1
    await m.disconnect()


async def test_group_mention_factual_question_gets_a_grounded_answer(grounded, server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    await _seed_owner_fact(conv_id, bon)
    await _delegate_groups(bon)
    m = await _connect_as(server, micah)
    a = await _connect_as(server, alex)
    await asyncio.sleep(0.2)
    a_in = _collector(a, "incoming_message")
    await _send_group(m, conv_id, "@Bon which folder did you put the presentation in?", [bon])
    toucan = await _toucan_messages(conv_id)
    assert len(toucan) == 1 and toucan[0].text.startswith("Toucan — assisting ") and "Drive" in toucan[0].text
    assert a_in[-1]["message"]["text"] == toucan[0].text  # fans out to every member
    assert grounded.question == "which folder did you put the presentation in?"
    # Plain group chatter and an un-mentioned question never consult the provider.
    await _send_group(m, conv_id, "where is the presentation?", None, "g2")
    await _send_group(m, conv_id, "Bon where is the presentation?", [], "g3")
    assert len(grounded.calls) == 1 and len(await _toucan_messages(conv_id)) == 1
    for c in (m, a):
        await c.disconnect()


@pytest.mark.parametrize(
    "question",
    [
        "@Bon can we move the deadline to Friday?",
        "@Bon will you take this task?",
        "@Bon do you approve the new budget?",
        "@Bon what do you think about the design?",
        "@Bon how long will the migration take?",
    ],
)
async def test_unsafe_questions_fall_back_without_consulting_the_provider(grounded, server, question):
    bon, _micah, conv_id, m = await _bon_and_micah_dm(server)
    await _seed_owner_fact(conv_id, bon)
    await _delegate(bon)
    await _send_and_settle(m, conv_id, question)
    assert [t.text for t in await _toucan_messages(conv_id)] == [first_reply_text(bon)]
    assert grounded.calls == []
    await m.disconnect()


async def test_no_owner_evidence_means_no_provider_call_and_the_acknowledgement(grounded, server):
    bon, _micah, conv_id, m = await _bon_and_micah_dm(server)
    await _delegate(bon)
    # Only the asker has spoken (and speculates about Bon's words): nothing to retrieve.
    await _send_and_settle(m, conv_id, "I think Bon said it's in Drive", "s0")
    await _send_and_settle(m, conv_id, "@Bon where is the presentation?", "s1")
    assert [t.text for t in await _toucan_messages(conv_id)] == [first_reply_text(bon)]
    assert grounded.calls == []
    await m.disconnect()


def _verdict(**kw):
    def _reply(window):
        return _json.dumps(kw)
    return _reply


@pytest.mark.parametrize(
    ("reply", "label"),
    [
        (lambda w: _json.dumps({"canAnswer": True, "answer": "It's in Drive.", "evidenceMessageIds": [t["id"] for t in w if not t["fromOwner"]]}), "evidence only from another participant"),
        (lambda w: _json.dumps({"canAnswer": True, "answer": "It's in Drive.", "evidenceMessageIds": ["not-a-real-id"]}), "invalid evidence id"),
        (lambda w: _json.dumps({"canAnswer": True, "answer": "It's in Drive.", "evidenceMessageIds": []}), "no evidence"),
        (lambda w: _json.dumps({"canAnswer": True, "answer": "", "evidenceMessageIds": [t["id"] for t in w if t["fromOwner"]]}), "empty answer"),
        (lambda w: _json.dumps({"canAnswer": True, "answer": "I approved it, go ahead.", "evidenceMessageIds": [t["id"] for t in w if t["fromOwner"]]}), "unsafe wording"),
        (lambda w: _json.dumps({"canAnswer": False, "answer": "", "evidenceMessageIds": []}), "provider declines"),
        (lambda w: "Sure! It's in the Drive folder.", "malformed (prose, not JSON)"),
        (lambda w: None, "empty completion"),
        (RuntimeError("provider down"), "provider exception"),
    ],
)
async def test_every_bad_verdict_falls_back_to_the_deterministic_acknowledgement(grounded, server, reply, label):
    grounded.reply = reply
    bon, _micah, conv_id, m = await _bon_and_micah_dm(server)
    await _send_and_settle(m, conv_id, "I think it's in Drive", "s0")  # another participant's speculation
    await _seed_owner_fact(conv_id, bon)
    await _delegate(bon)
    await _send_and_settle(m, conv_id, "@Bon where is the presentation?", "s1")
    assert [t.text for t in await _toucan_messages(conv_id)] == [first_reply_text(bon)], label
    assert len(grounded.calls) == 1, label
    await m.disconnect()


async def test_evidence_from_another_conversation_is_rejected(grounded, server):
    bon, _micah, conv_id, m = await _bon_and_micah_dm(server)
    await _seed_owner_fact(conv_id, bon)
    other_conv = await _dm(bon, _fresh("alex"))
    other_id = await _seed_owner_fact(other_conv, bon)
    await _delegate(bon)
    grounded.reply = lambda w: _json.dumps({"canAnswer": True, "answer": "Bon said it is in Drive.", "evidenceMessageIds": [other_id]})
    await _send_and_settle(m, conv_id, "@Bon where is the presentation?")
    assert [t.text for t in await _toucan_messages(conv_id)] == [first_reply_text(bon)]
    assert other_id not in [t["id"] for t in grounded.window]
    await m.disconnect()


async def test_provider_unavailable_or_feature_off_keeps_delegation_working(grounded, server, monkeypatch):
    bon, _micah, conv_id, m = await _bon_and_micah_dm(server)
    await _seed_owner_fact(conv_id, bon)
    await _delegate(bon)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    await _send_and_settle(m, conv_id, "@Bon where is the presentation?", "s1")
    assert [t.text for t in await _toucan_messages(conv_id)] == [first_reply_text(bon)]
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "unit-test-key")
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_GROUNDED_ANSWERS", False)
    monkeypatch.setattr(settings, "TOUCAN_DELEGATION_COOLDOWN_SECONDS", 0.0)
    await _send_and_settle(m, conv_id, "@Bon where is the presentation?", "s2")
    assert [t.text for t in await _toucan_messages(conv_id)] == [first_reply_text(bon), follow_up_reply_text(bon)]
    assert grounded.calls == []
    await m.disconnect()


async def test_multi_owner_mention_stays_deterministic_and_never_consults_the_provider(grounded, server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _group(bon, [micah, alex])
    await _seed_owner_fact(conv_id, bon)
    await _seed_owner_fact(conv_id, micah)
    await _delegate_groups(bon)
    await _delegate_groups(micah)
    a = await _connect_as(server, alex)
    await asyncio.sleep(0.2)
    await _send_group(a, conv_id, "@Bon @Micah where is the presentation?", [bon, micah])
    assert [t.text for t in await _toucan_messages(conv_id)] == [combined_first_reply_text([bon, micah])]
    assert grounded.calls == []
    await a.disconnect()


async def test_at_toucan_still_wins_and_the_delegated_seam_is_not_used(grounded, server):
    bon, _micah, conv_id, m = await _bon_and_micah_dm(server)
    await _seed_owner_fact(conv_id, bon)
    await _delegate(bon)
    grounded.reply = "A1.4 answer from the conversation seam."
    await _send_and_settle(m, conv_id, "@Toucan where is the presentation?")
    toucan = await _toucan_messages(conv_id)
    assert [t.text for t in toucan] == ["A1.4 answer from the conversation seam."]
    assert not toucan[0].text.startswith("Toucan — assisting")
    # The one provider call was the A1.4 conversation seam, not the delegated one.
    assert len(grounded.calls) == 1 and "covering for" not in grounded.calls[0]["messages"][0]["content"]
    await m.disconnect()


async def test_non_member_cannot_trigger_a_grounded_answer(grounded, server):
    bon, micah, alex = _fresh("bon"), _fresh("micah"), _fresh("alex")
    conv_id = await _dm(bon, micah)
    await _seed_owner_fact(conv_id, bon)
    await _delegate(bon)
    assert await evaluate_and_reply(conv_id, alex, "x1", None, "@Bon where is the presentation?") is None
    assert grounded.calls == [] and await _toucan_messages(conv_id) == []
