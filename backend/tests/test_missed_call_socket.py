from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn
from sqlalchemy import select

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.models.activity_event import ActivityEvent
from datetime import datetime, timezone

from app.models.attendance import EmployeeAttendance
from app.models.message import KIND_CALL_MISSED, Message
from app.realtime import socket as socket_module
from app.repositories import chat as chat_repo

# PHASE 7D — BUSY, AND THE MISSED CALL IT LEAVES BEHIND.
#
# Two rules are under test and they are easy to conflate:
#   1. A busy recipient is NOT interrupted. No invite is minted, so nothing at all is emitted to them —
#      their meeting carries on. The caller alone is told.
#   2. A missed call is recorded only when the ring reached a VALID recipient. The `offline` branch used
#      to write a row for any email-shaped string, which minted missed calls against people who do not
#      exist — and now that a DM carries the record, would have created conversations for them too.
#
# DND IS DELIBERATELY ABSENT FROM BOTH. V1's refusal is unchanged and writes nothing; the test at the
# bottom pins that, because "preserve DND exactly" is only a claim until something fails when it moves.

pytestmark = pytest.mark.asyncio

CAVE = "cave-all-hands"


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    socket_module.spatial_sessions.reset()
    socket_module.call_registry.reset()
    socket_module.call_invites.reset()
    socket_module.meeting_hosts.reset()
    socket_module.dnd_registry.clear("b@example.com")

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]

    yield f"http://127.0.0.1:{port}"

    srv.should_exit = True
    await task
    socket_module.spatial_sessions.reset()
    socket_module.call_registry.reset()
    socket_module.call_invites.reset()
    socket_module.meeting_hosts.reset()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def _wait(pred, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


async def _missed_rows() -> list[Message]:
    async with async_session_maker() as session:
        result = await session.execute(select(Message).where(Message.kind == KIND_CALL_MISSED))
        return list(result.scalars().all())


async def _activity_rows() -> list[ActivityEvent]:
    async with async_session_maker() as session:
        result = await session.execute(select(ActivityEvent))
        return list(result.scalars().all())


async def test_busy_tells_the_caller_and_leaves_the_recipient_undisturbed(server):
    caller = await _connect_as(server, "a@example.com")
    busy = await _connect_as(server, "b@example.com")

    failed: list = []
    disturbed: list = []

    @caller.on("call_invite_failed")
    async def _on_fail(data):
        failed.append(data)

    # ANY of these reaching the busy person would be an interruption of their meeting.
    for event in ("call_invite_incoming", "call_invite_ringing", "call_invite_failed"):
        busy.on(event, lambda data, e=event: disturbed.append(e))

    await asyncio.sleep(0.2)
    await busy.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    await caller.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: failed)
    assert failed[-1]["reason"] == "busy"
    await asyncio.sleep(0.3)
    assert disturbed == []

    await caller.disconnect()
    await busy.disconnect()


async def test_busy_records_one_missed_call_in_the_dm_and_one_activity_event(server):
    caller = await _connect_as(server, "a@example.com")
    busy = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)
    await busy.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    await caller.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: asyncio.ensure_future(_missed_rows()) and True)
    await asyncio.sleep(0.6)

    rows = await _missed_rows()
    assert len(rows) == 1
    row = rows[0]
    # The CALLER is the sender, which is what makes every existing unread rule work untouched.
    assert row.sender_email == "a@example.com"
    assert row.text == ""
    assert row.meta == {"callType": "spatial", "reason": "busy"}

    # It landed in the DM between the two, and the recipient can read it back.
    async with async_session_maker() as session:
        conv_id = await chat_repo.get_dm_conversation_id(session, "b@example.com", "a@example.com")
        assert conv_id == row.conversation_id
        assert await chat_repo.unread_count(session, conv_id, "b@example.com") == 1
        # The caller has nothing unread — it is their own call.
        assert await chat_repo.unread_count(session, conv_id, "a@example.com") == 0

    # ONE EVENT ACROSS TWO SYSTEMS: the activity row still exists for Toucan's count, and the message
    # row is excluded from Toucan's MESSAGE count, so the call is never reported twice.
    assert len(await _activity_rows()) == 1

    await caller.disconnect()
    await busy.disconnect()


async def test_an_unknown_recipient_gets_no_missed_call_and_no_conversation(server):
    """The bug this closes: `offline` used to write a row for any email-shaped string."""
    caller = await _connect_as(server, "a@example.com")
    failed: list = []

    @caller.on("call_invite_failed")
    async def _on_fail(data):
        failed.append(data)

    await asyncio.sleep(0.2)
    await caller.emit("call_invite", {"toEmail": "nobody@nowhere.test"})
    assert await _wait(lambda: failed)
    assert failed[-1]["reason"] == "offline"
    await asyncio.sleep(0.5)

    assert await _missed_rows() == []
    assert await _activity_rows() == []
    async with async_session_maker() as session:
        assert await chat_repo.get_dm_conversation_id(session, "nobody@nowhere.test", "a@example.com") is None

    await caller.disconnect()


async def test_an_offline_employee_who_has_checked_in_before_does_get_one(server):
    """Offline is exactly the case a missed call exists for — as long as they are a real employee."""
    async with async_session_maker() as session:
        now = datetime.now(timezone.utc)
        session.add(EmployeeAttendance(email="gone@example.com", updated_at=now))
        await session.commit()

    caller = await _connect_as(server, "a@example.com")
    failed: list = []

    @caller.on("call_invite_failed")
    async def _on_fail(data):
        failed.append(data)

    await asyncio.sleep(0.2)
    await caller.emit("call_invite", {"toEmail": "gone@example.com"})
    assert await _wait(lambda: failed)
    await asyncio.sleep(0.6)

    rows = await _missed_rows()
    assert len(rows) == 1
    assert rows[0].sender_email == "a@example.com"

    await caller.disconnect()


async def test_dnd_is_unchanged_and_still_records_nothing(server):
    """V1 semantics, preserved verbatim: the caller is refused and routed to Request Permission to
    Talk, the recipient is not rung, and NOTHING durable is written."""
    caller = await _connect_as(server, "a@example.com")
    dnd = await _connect_as(server, "b@example.com")
    failed: list = []

    @caller.on("call_invite_failed")
    async def _on_fail(data):
        failed.append(data)

    await asyncio.sleep(0.2)
    await dnd.emit("dnd_set", {"isDnd": True})
    await asyncio.sleep(0.3)

    await caller.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: failed)
    assert failed[-1]["reason"] == "dnd"
    await asyncio.sleep(0.5)

    assert await _missed_rows() == []
    assert await _activity_rows() == []

    await dnd.emit("dnd_set", {"isDnd": False})
    await caller.disconnect()
    await dnd.disconnect()


async def test_the_missed_call_survives_a_reload_through_the_rest_endpoint(server):
    """PERSISTENCE, end to end and through the wire shape the chat panel actually fetches.

    This test exists because the first live run passed at the database and failed at the browser:
    routers/chat.py builds ChatMessageOut field by field, so `kind` was dropped on the way out and a
    missed call came back looking like an ordinary message with no text. The socket payload was fine;
    only the REST one was not — which is precisely the path a reload takes.
    """
    from httpx import ASGITransport, AsyncClient

    from app.main import app as fastapi_app

    caller = await _connect_as(server, "a@example.com")
    busy = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)
    await busy.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)
    await caller.emit("call_invite", {"toEmail": "b@example.com"})
    await asyncio.sleep(0.8)

    rows = await _missed_rows()
    assert len(rows) == 1
    conv_id = rows[0].conversation_id

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(
            f"/conversations/{conv_id}/messages", headers={"x-dev-email": "b@example.com"}
        )
    assert res.status_code == 200
    payload = [m for m in res.json() if m["kind"] != "text"]
    assert len(payload) == 1
    assert payload[0]["kind"] == KIND_CALL_MISSED
    assert payload[0]["senderId"] == "a@example.com"
    assert payload[0]["text"] == ""
    assert payload[0]["meta"] == {"callType": "spatial", "reason": "busy"}
    # The caller and the timestamp — the two things the record has to preserve — are both here.
    assert payload[0]["sentAt"]

    await caller.disconnect()
    await busy.disconnect()
