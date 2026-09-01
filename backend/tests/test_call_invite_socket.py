from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.models.talk_request import TalkRequest
from app.realtime import socket as socket_module

# Socket-layer coverage for the call ringing lifecycle. Mirrors test_call_socket.py's fixture.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(TalkRequest.__table__.delete())
    for reg in (socket_module.spatial_sessions, socket_module.call_registry, socket_module.call_invites):
        reg.reset()
    socket_module.dnd_registry._dnd_emails.clear()

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    await task
    for reg in (socket_module.spatial_sessions, socket_module.call_registry, socket_module.call_invites):
        reg.reset()
    socket_module.dnd_registry._dnd_emails.clear()
    settings.APP_ENV = original_env


async def _connect(url: str, email: str, bag: dict) -> socketio.AsyncClient:
    c = socketio.AsyncClient()
    for evt in (
        "call_invite_incoming",
        "call_invite_ringing",
        "call_invite_accepted",
        "call_invite_declined",
        "call_invite_cancelled",
        "call_invite_failed",
        "call_invites",
    ):
        def handler(data, _evt=evt):
            bag.setdefault(_evt, []).append(data)
        c.on(evt, handler)
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


async def test_invite_reaches_the_recipient_with_no_spatial_session_at_all(server):
    """THE POINT OF RINGING: the recipient is notified without any conversation, spatial session,
    or chat panel existing anywhere."""
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    assert socket_module.spatial_sessions.snapshot() == []

    await a.emit("call_invite", {"toEmail": "b@example.com"})

    assert await _wait(lambda: B.get("call_invite_incoming"))
    assert await _wait(lambda: A.get("call_invite_ringing"))
    assert B["call_invite_incoming"][-1]["fromEmail"] == "a@example.com"
    assert A["call_invite_ringing"][-1]["toEmail"] == "b@example.com"
    # No spatial session and no media were created by ringing.
    assert socket_module.spatial_sessions.snapshot() == []
    assert socket_module.call_registry.snapshot() == []
    await a.disconnect(); await b.disconnect()


async def test_accept_notifies_both_sides_and_still_creates_no_session_or_media(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    invite_id = B["call_invite_incoming"][-1]["inviteId"]

    await b.emit("call_invite_accept", {"inviteId": invite_id})

    assert await _wait(lambda: A.get("call_invite_accepted"))
    assert await _wait(lambda: B.get("call_invite_accepted"))
    # The clients drive the spatial/media steps next — the server does not.
    assert socket_module.spatial_sessions.snapshot() == []
    assert socket_module.call_registry.snapshot() == []
    await a.disconnect(); await b.disconnect()


async def test_decline_notifies_both_sides(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    await b.emit("call_invite_decline", {"inviteId": B["call_invite_incoming"][-1]["inviteId"]})

    assert await _wait(lambda: A.get("call_invite_declined"))
    assert await _wait(lambda: B.get("call_invite_declined"))
    await a.disconnect(); await b.disconnect()


async def test_cancel_by_caller_notifies_both_sides(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: A.get("call_invite_ringing"))
    await a.emit("call_invite_cancel", {"inviteId": A["call_invite_ringing"][-1]["inviteId"]})

    assert await _wait(lambda: A.get("call_invite_cancelled"))
    assert await _wait(lambda: B.get("call_invite_cancelled"))
    await a.disconnect(); await b.disconnect()


async def test_recipient_cannot_cancel_and_caller_cannot_accept(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    invite_id = B["call_invite_incoming"][-1]["inviteId"]

    await b.emit("call_invite_cancel", {"inviteId": invite_id})
    await a.emit("call_invite_accept", {"inviteId": invite_id})
    await asyncio.sleep(0.5)

    assert not A.get("call_invite_cancelled") and not A.get("call_invite_accepted")
    # Invite survives both illegitimate attempts and can still be answered properly.
    await b.emit("call_invite_accept", {"inviteId": invite_id})
    assert await _wait(lambda: A.get("call_invite_accepted"))
    await a.disconnect(); await b.disconnect()


async def test_double_accept_emits_exactly_one_terminal_state(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    invite_id = B["call_invite_incoming"][-1]["inviteId"]

    await b.emit("call_invite_accept", {"inviteId": invite_id})
    await b.emit("call_invite_accept", {"inviteId": invite_id})
    await asyncio.sleep(0.6)

    assert len(A["call_invite_accepted"]) == 1
    await a.disconnect(); await b.disconnect()


async def test_caller_disconnect_cancels_the_ring(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))

    await a.disconnect()

    assert await _wait(lambda: B.get("call_invite_cancelled"))
    assert B["call_invite_cancelled"][-1]["reason"] == "caller_left"
    await b.disconnect()


async def test_an_unrelated_socket_of_the_caller_disconnecting_does_not_cancel(server):
    A, B = {}, {}
    a_call = await _connect(server, "a@example.com", A)
    a_other = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a_call.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))

    await a_other.disconnect()
    await asyncio.sleep(0.5)

    assert not B.get("call_invite_cancelled")
    await a_call.disconnect(); await b.disconnect()


async def test_recipient_reconnect_restores_the_pending_ring(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    await b.disconnect()
    await asyncio.sleep(0.4)

    B2 = {}
    b2 = await _connect(server, "b@example.com", B2)
    assert await _wait(lambda: B2.get("call_invites"))
    invites = B2["call_invites"][-1]["invites"]
    assert [i["fromEmail"] for i in invites] == ["a@example.com"]
    await a.disconnect(); await b2.disconnect()


async def test_caller_reconnect_restores_its_own_outgoing_ring(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))

    A2 = {}
    a2 = await _connect(server, "a@example.com", A2)
    assert await _wait(lambda: A2.get("call_invites"))
    assert [i["toEmail"] for i in A2["call_invites"][-1]["invites"]] == ["b@example.com"]
    await a.disconnect(); await a2.disconnect(); await b.disconnect()


async def test_an_uninvolved_client_never_sees_the_invite(server):
    A, B, C = {}, {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    c = await _connect(server, "c@example.com", C)
    await asyncio.sleep(0.3)
    C.clear()
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    await asyncio.sleep(0.3)
    assert not C.get("call_invite_incoming") and not C.get("call_invite_ringing")
    await a.disconnect(); await b.disconnect(); await c.disconnect()


# --- rejections ---------------------------------------------------------------------------


async def test_offline_recipient_is_rejected(server):
    A = {}
    a = await _connect(server, "a@example.com", A)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "nobody@example.com"})
    assert await _wait(lambda: A.get("call_invite_failed"))
    assert A["call_invite_failed"][-1]["reason"] == "offline"
    await a.disconnect()


async def test_dnd_recipient_is_rejected(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await b.emit("dnd_set", {"isDnd": True})
    await asyncio.sleep(0.4)

    await a.emit("call_invite", {"toEmail": "b@example.com"})

    assert await _wait(lambda: A.get("call_invite_failed"))
    assert A["call_invite_failed"][-1]["reason"] == "dnd"
    assert not B.get("call_invite_incoming")
    await a.disconnect(); await b.disconnect()


async def test_recipient_already_in_a_call_is_rejected_as_busy(server):
    A, B, C = {}, {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    c = await _connect(server, "c@example.com", C)
    await asyncio.sleep(0.3)
    # B and C are in a call together.
    await b.emit("spatial_session_start", {"sessionId": "conv-bc"})
    await c.emit("spatial_session_start", {"sessionId": "conv-bc"})
    await asyncio.sleep(0.4)
    await b.emit("call_joined", {"sessionId": "conv-bc"})
    await asyncio.sleep(0.5)

    await a.emit("call_invite", {"toEmail": "b@example.com"})

    assert await _wait(lambda: A.get("call_invite_failed"))
    assert A["call_invite_failed"][-1]["reason"] == "busy"
    await a.disconnect(); await b.disconnect(); await c.disconnect()


async def test_duplicate_invite_is_rejected(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: A.get("call_invite_failed"))
    assert A["call_invite_failed"][-1]["reason"] == "already_ringing"
    await a.disconnect(); await b.disconnect()


async def test_glare_reverse_direction_is_rejected(server):
    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))

    await b.emit("call_invite", {"toEmail": "a@example.com"})

    assert await _wait(lambda: B.get("call_invite_failed"))
    assert B["call_invite_failed"][-1]["reason"] == "already_ringing"
    await a.disconnect(); await b.disconnect()


async def test_calling_yourself_is_ignored(server):
    A = {}
    a = await _connect(server, "a@example.com", A)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "a@example.com"})
    await asyncio.sleep(0.4)
    assert not A.get("call_invite_incoming") and not A.get("call_invite_ringing")
    await a.disconnect()


async def test_ringing_creates_no_talk_request_row_and_no_cooldown(server):
    """The whole reason ringing is not built on talk_requests: a declined CALL must never write a
    row that throttles legitimate Chat requests for 15 minutes."""
    from sqlalchemy import func, select

    from app.database import async_session_maker
    from app.repositories import talk_requests as talk_repo

    A, B = {}, {}
    a = await _connect(server, "a@example.com", A)
    b = await _connect(server, "b@example.com", B)
    await asyncio.sleep(0.3)
    await a.emit("call_invite", {"toEmail": "b@example.com"})
    assert await _wait(lambda: B.get("call_invite_incoming"))
    await b.emit("call_invite_decline", {"inviteId": B["call_invite_incoming"][-1]["inviteId"]})
    assert await _wait(lambda: A.get("call_invite_declined"))

    async with async_session_maker() as session:
        count = (await session.execute(select(func.count()).select_from(TalkRequest))).scalar()
        cooldown = await talk_repo.get_cooldown_until(
            session, target_email="b@example.com", requester_email="a@example.com"
        )
    assert count == 0
    assert cooldown is None
    await a.disconnect(); await b.disconnect()
