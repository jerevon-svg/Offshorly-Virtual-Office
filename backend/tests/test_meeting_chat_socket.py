from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn
from sqlalchemy import func, select

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.models.activity_event import ActivityEvent
from app.models.conversation import Conversation
from app.models.message import Message
from app.realtime import socket as socket_module

# PHASE 7D — MEETING CHAT: said in the meeting, ends with the meeting.
#
# The promises under test are as much about what does NOT happen as what does: a meeting aside must
# not become a conversation in somebody's inbox, an unread badge to clear, or a quest credit.

pytestmark = pytest.mark.asyncio

CAVE = "cave-all-hands"


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    socket_module.call_registry.reset()
    socket_module.meeting_hosts.reset()
    socket_module.meeting_chat.reset()

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    yield f"http://127.0.0.1:{srv.servers[0].sockets[0].getsockname()[1]}"
    srv.should_exit = True
    await task
    socket_module.call_registry.reset()
    socket_module.meeting_hosts.reset()
    socket_module.meeting_chat.reset()
    settings.APP_ENV = original_env


async def _connect(url: str, email: str) -> socketio.AsyncClient:
    c = socketio.AsyncClient()
    await asyncio.wait_for(
        c.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return c


async def _wait(pred, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


async def _count(model) -> int:
    async with async_session_maker() as session:
        return (await session.execute(select(func.count()).select_from(model))).scalar_one()


async def test_a_message_reaches_every_participant_exactly_once(server):
    a = await _connect(server, "a@example.com")
    b = await _connect(server, "b@example.com")
    got_a, got_b = [], []
    a.on("meeting_chat", lambda d: got_a.append(d))
    b.on("meeting_chat", lambda d: got_b.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await b.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    await a.emit("meeting_chat_send", {"text": "can everyone see the screen?"})

    assert await _wait(lambda: got_a and got_b)
    await asyncio.sleep(0.3)
    # ONCE on each, sender included — one source of truth, not a local draw plus an echo.
    assert len(got_a) == 1 and len(got_b) == 1
    assert got_a[0]["text"] == "can everyone see the screen?"
    assert got_a[0]["email"] == "a@example.com"
    assert got_a[0]["id"] == got_b[0]["id"]

    await a.disconnect()
    await b.disconnect()


async def test_somebody_not_in_the_meeting_can_neither_speak_nor_hear(server):
    a = await _connect(server, "a@example.com")
    outsider = await _connect(server, "c@example.com")
    heard, mine = [], []
    outsider.on("meeting_chat", lambda d: heard.append(d))
    a.on("meeting_chat", lambda d: mine.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    await a.emit("meeting_chat_send", {"text": "members only"})
    assert await _wait(lambda: mine)
    # And the outsider's own attempt is refused outright.
    await outsider.emit("meeting_chat_send", {"text": "let me in"})
    await asyncio.sleep(0.4)

    assert heard == []
    assert len(mine) == 1

    await a.disconnect()
    await outsider.disconnect()


async def test_a_late_joiner_is_given_the_history_and_nobody_else_is(server):
    a = await _connect(server, "a@example.com")
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)
    for line in ("one", "two", "three"):
        await a.emit("meeting_chat_send", {"text": line})
        await asyncio.sleep(0.4)

    late = await _connect(server, "b@example.com")
    history = []
    late.on("meeting_chat_history", lambda d: history.append(d))
    await asyncio.sleep(0.2)
    await late.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)
    await late.emit("meeting_chat_history", {})

    assert await _wait(lambda: history)
    assert [m["text"] for m in history[-1]["messages"]] == ["one", "two", "three"]

    await a.disconnect()
    await late.disconnect()


async def test_the_meeting_ending_forgets_what_was_said(server):
    a = await _connect(server, "a@example.com")
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)
    await a.emit("meeting_chat_send", {"text": "before"})
    await asyncio.sleep(0.4)
    assert socket_module.meeting_chat.history("meeting:" + CAVE)

    await a.emit("call_left", {})
    await asyncio.sleep(0.4)

    # Last one out ends the meeting, and the conversation ends with it.
    assert socket_module.meeting_chat.history("meeting:" + CAVE) == []

    # A new meeting under the same id starts genuinely empty.
    history = []
    a.on("meeting_chat_history", lambda d: history.append(d))
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)
    await a.emit("meeting_chat_history", {})
    assert await _wait(lambda: history)
    assert history[-1]["messages"] == []

    await a.disconnect()


async def test_it_creates_no_conversation_no_message_row_and_no_activity(server):
    a = await _connect(server, "a@example.com")
    b = await _connect(server, "b@example.com")
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await b.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    for line in ("hello", "anyone there?", "great demo"):
        await a.emit("meeting_chat_send", {"text": line})
        await asyncio.sleep(0.4)

    # THE POINT OF NOT REUSING THE DM SYSTEM: no inbox, no unread, no feed, no quest credit.
    assert await _count(Conversation) == 0
    assert await _count(Message) == 0
    assert await _count(ActivityEvent) == 0

    await a.disconnect()
    await b.disconnect()


async def test_reactions_reach_participants_and_are_never_stored(server):
    a = await _connect(server, "a@example.com")
    b = await _connect(server, "b@example.com")
    got = []
    b.on("meeting_reaction", lambda d: got.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await b.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    await a.emit("meeting_reaction", {"token": "🔥"})
    assert await _wait(lambda: got)
    assert got[-1]["token"] == "🔥"
    assert got[-1]["email"] == "a@example.com"
    # A moment, not a record: nothing is kept for a late joiner to receive.
    assert socket_module.meeting_chat.history("meeting:" + CAVE) == []

    await a.disconnect()
    await b.disconnect()


async def test_bursts_are_dropped_and_oversized_input_is_refused(server):
    a = await _connect(server, "a@example.com")
    got = []
    a.on("meeting_chat", lambda d: got.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)

    for i in range(6):
        await a.emit("meeting_chat_send", {"text": f"spam {i}"})
    await asyncio.sleep(0.6)
    assert len(got) < 6  # the per-socket guard dropped the burst

    got.clear()
    await asyncio.sleep(0.5)
    await a.emit("meeting_chat_send", {"text": "x" * 5000})
    assert await _wait(lambda: got)
    assert len(got[-1]["text"]) == 400  # truncated, never refused whole

    # An empty message says nothing and is not relayed.
    got.clear()
    await asyncio.sleep(0.5)
    await a.emit("meeting_chat_send", {"text": "   "})
    await asyncio.sleep(0.4)
    assert got == []

    await a.disconnect()


async def test_history_is_bounded_so_a_long_meeting_costs_a_fixed_amount(server):
    from app.services.meeting_chat import HISTORY_LIMIT, MeetingChatRegistry

    reg = MeetingChatRegistry()
    for i in range(HISTORY_LIMIT + 20):
        reg.post("meeting:x", email="a@example.com", text=f"line {i}", now_ms=i)
    history = reg.history("meeting:x")
    assert len(history) == HISTORY_LIMIT
    # The OLDEST went, so what a late joiner receives is the most recent conversation.
    assert history[-1]["text"] == f"line {HISTORY_LIMIT + 19}"


async def test_chat_arrives_on_a_DIFFERENT_socket_from_the_media_claim(server):
    """THE TOPOLOGY THIS APP ACTUALLY HAS, and the bug the other tests could not see.

    A browser opens about ten sockets per user by design. The LiveKit claim (`call_joined`) rides the
    call store's connection; meeting chat has its own, like every other presence client. Gating chat
    on whether THIS socket holds a media claim therefore answered "no" for everybody and dropped every
    message — while a test that used one socket for both passed happily.
    """
    a_media = await _connect(server, "a@example.com")
    a_chat = await _connect(server, "a@example.com")
    b_media = await _connect(server, "b@example.com")
    b_chat = await _connect(server, "b@example.com")
    heard = []
    b_chat.on("meeting_chat", lambda d: heard.append(d))
    await asyncio.sleep(0.2)

    # The MEDIA sockets join the meeting; the CHAT sockets never do and never will.
    await a_media.emit("call_joined", {"meetingId": CAVE})
    await b_media.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    await a_chat.emit("meeting_chat_send", {"text": "sent from the chat socket"})

    assert await _wait(lambda: heard)
    assert heard[-1]["text"] == "sent from the chat socket"
    assert heard[-1]["email"] == "a@example.com"

    # And the same for a reaction and for the history.
    reacted, history = [], []
    b_chat.on("meeting_reaction", lambda d: reacted.append(d))
    a_chat.on("meeting_chat_history", lambda d: history.append(d))
    await a_chat.emit("meeting_reaction", {"token": "🔥"})
    await a_chat.emit("meeting_chat_history", {})
    assert await _wait(lambda: reacted and history)
    assert [m["text"] for m in history[-1]["messages"]] == ["sent from the chat socket"]

    for c in (a_media, a_chat, b_media, b_chat):
        await c.disconnect()


async def test_a_chat_socket_whose_owner_is_not_in_the_meeting_is_still_refused(server):
    """The gate moved from socket to person — it did not disappear."""
    a_media = await _connect(server, "a@example.com")
    outsider_chat = await _connect(server, "c@example.com")
    heard = []
    a_media.on("meeting_chat", lambda d: heard.append(d))
    await asyncio.sleep(0.2)
    await a_media.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    await outsider_chat.emit("meeting_chat_send", {"text": "let me in"})
    await asyncio.sleep(0.4)
    assert heard == []

    await a_media.disconnect()
    await outsider_chat.disconnect()
