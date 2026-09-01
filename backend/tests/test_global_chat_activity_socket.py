from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module

# Socket-layer coverage for the Global Chat activity presence fact (drives peers' seated
# `sitting-answering` animation). Mirrors tests/test_dnd_room_lock_socket.py's
# real-server-over-a-socket approach.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    socket_module.global_chat_activity._sids_by_email.clear()
    socket_module.spatial_sessions._session_by_email.clear()

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]

    yield f"http://127.0.0.1:{port}"

    srv.should_exit = True
    await task
    socket_module.global_chat_activity._sids_by_email.clear()
    socket_module.spatial_sessions._session_by_email.clear()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


def _collector(client: socketio.AsyncClient) -> list[dict]:
    received: list[dict] = []

    @client.on("global_chat_activity")
    async def on_activity(data):
        received.append(data)

    return received


async def _wait_for(received: list[dict], predicate, timeout: float = 2.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        for payload in received:
            if predicate(payload):
                return payload
        await asyncio.sleep(0.02)
    raise AssertionError(f"no matching global_chat_activity payload; got {received}")


async def test_active_window_broadcasts_true_to_peers_and_carries_only_emails(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    b_received = _collector(b)
    await asyncio.sleep(0.2)

    await a.emit("global_chat_active", {"isActive": True})
    payload = await _wait_for(b_received, lambda p: p["emails"])
    assert payload == {"emails": ["a@example.com"]}

    # Test 17: no spatial session / In Conversation side effects.
    assert socket_module.spatial_sessions.snapshot() == []

    await a.disconnect()
    await b.disconnect()


async def test_final_socket_closing_broadcasts_false(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    b_received = _collector(b)
    await asyncio.sleep(0.2)

    await a.emit("global_chat_active", {"isActive": True})
    await _wait_for(b_received, lambda p: p["emails"] == ["a@example.com"])

    await a.disconnect()
    await _wait_for(b_received, lambda p: p["emails"] == [])
    await b.disconnect()


async def test_second_socket_disconnecting_does_not_clear_the_other_sockets_state(server):
    a1 = await _connect_as(server, "a@example.com")
    a2 = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    b_received = _collector(b)
    await asyncio.sleep(0.2)

    await a1.emit("global_chat_active", {"isActive": True})
    await a2.emit("global_chat_active", {"isActive": True})
    await _wait_for(b_received, lambda p: p["emails"] == ["a@example.com"])
    count_before = len(b_received)

    await a2.disconnect()
    await asyncio.sleep(0.3)
    # No new broadcast, and a stays active.
    assert len(b_received) == count_before
    assert socket_module.global_chat_activity.is_active("a@example.com") is True

    # Test 14/15: the remaining socket reporting inactive is the real "false" transition.
    await a1.emit("global_chat_active", {"isActive": False})
    await _wait_for(b_received, lambda p: p["emails"] == [])

    await a1.disconnect()
    await b.disconnect()


async def test_late_joiner_receives_authoritative_snapshot_on_connect(server):
    a = await _connect_as(server, "a@example.com")
    await asyncio.sleep(0.2)
    await a.emit("global_chat_active", {"isActive": True})
    await asyncio.sleep(0.2)

    c = socketio.AsyncClient()
    c_received = _collector(c)
    await asyncio.wait_for(
        c.connect(server, auth={"x-dev-email": "c@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    payload = await _wait_for(c_received, lambda p: p["emails"] == ["a@example.com"])
    assert payload == {"emails": ["a@example.com"]}

    await a.disconnect()
    await c.disconnect()


async def test_repeated_true_does_not_rebroadcast(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    b_received = _collector(b)
    await asyncio.sleep(0.2)

    await a.emit("global_chat_active", {"isActive": True})
    await _wait_for(b_received, lambda p: p["emails"] == ["a@example.com"])
    count_before = len(b_received)
    await a.emit("global_chat_active", {"isActive": True})
    await asyncio.sleep(0.3)
    assert len(b_received) == count_before

    await a.disconnect()
    await b.disconnect()


async def test_registry_reset_then_reconnect_reemit_makes_peers_see_active_again(server):
    # Test 3: simulate a backend restart (in-memory registry wiped) while the user's remote
    # window stays open; the client re-emits its desired state on reconnect (frontend contract,
    # see globalChatActivityClient.ts) and peers see the person active again.
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    b_received = _collector(b)
    await asyncio.sleep(0.2)

    await a.emit("global_chat_active", {"isActive": True})
    await _wait_for(b_received, lambda p: p["emails"] == ["a@example.com"])

    socket_module.global_chat_activity._sids_by_email.clear()  # "restart"
    assert socket_module.global_chat_activity.snapshot() == []

    await a.disconnect()
    await asyncio.sleep(0.2)
    a2 = await _connect_as(server, "a@example.com")
    b_received.clear()
    await a2.emit("global_chat_active", {"isActive": True})  # client re-emit on (re)connect
    payload = await _wait_for(b_received, lambda p: p["emails"] == ["a@example.com"])
    assert payload == {"emails": ["a@example.com"]}

    await a2.disconnect()
    await b.disconnect()


async def test_two_tabs_reconnect_independently_and_aggregate_stays_true_while_either_reports_true(server):
    # Test 4: each tab re-reports its own desired state after its own reconnect. Every phase
    # clears b's inbox first so waits can never match a stale payload (b's own connect snapshot
    # is itself an {"emails": []} message).
    a1 = await _connect_as(server, "a@example.com")
    a2 = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    b_received = _collector(b)
    await asyncio.sleep(0.2)
    b_received.clear()

    await a1.emit("global_chat_active", {"isActive": True})   # tab 1: window open
    await a2.emit("global_chat_active", {"isActive": False})  # tab 2: nothing open
    await _wait_for(b_received, lambda p: p["emails"] == ["a@example.com"])

    # Tab 1 drops (it was the only active socket) -> aggregate false ...
    b_received.clear()
    await a1.disconnect()
    await _wait_for(b_received, lambda p: p["emails"] == [])
    # ... and comes back re-reporting true -> aggregate true again.
    b_received.clear()
    a1b = await _connect_as(server, "a@example.com")
    await a1b.emit("global_chat_active", {"isActive": True})
    await _wait_for(b_received, lambda p: p["emails"] == ["a@example.com"])

    # Tab 2 (never active) drops and comes back re-reporting false: aggregate unchanged, so b
    # receives no broadcast at all.
    await asyncio.sleep(0.2)
    b_received.clear()
    await a2.disconnect()
    await asyncio.sleep(0.2)
    a2b = await _connect_as(server, "a@example.com")
    await a2b.emit("global_chat_active", {"isActive": False})
    await asyncio.sleep(0.3)
    assert b_received == []
    assert socket_module.global_chat_activity.is_active("a@example.com") is True

    await a1b.disconnect()
    await a2b.disconnect()
    await b.disconnect()
