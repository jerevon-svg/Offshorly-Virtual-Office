from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Shared module-level singleton — clear it before/after each test so membership from one
    # test never leaks into the next (same shared-state caveat as offline_lineup's tests).
    socket_module.spatial_sessions.reset()

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
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def test_spatial_session_start_broadcasts_to_all_connected_clients(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    a_future: asyncio.Future = asyncio.get_event_loop().create_future()
    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @a.on("spatial_sessions")
    async def on_a(data):
        if not a_future.done() and data["sessions"]:
            a_future.set_result(data)

    @b.on("spatial_sessions")
    async def on_b(data):
        if not b_future.done() and data["sessions"]:
            b_future.set_result(data)

    await a.emit("spatial_session_start", {"sessionId": "s1"})

    a_payload = await asyncio.wait_for(a_future, timeout=2)
    b_payload = await asyncio.wait_for(b_future, timeout=2)

    assert a_payload["sessions"] == [{"sessionId": "s1", "members": ["a@example.com"]}]
    assert b_payload["sessions"] == [{"sessionId": "s1", "members": ["a@example.com"]}]

    await a.disconnect()
    await b.disconnect()


async def test_new_client_receives_existing_session_snapshot_on_connect(server):
    a = await _connect_as(server, "a@example.com")
    await asyncio.sleep(0.2)

    started_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @a.on("spatial_sessions")
    async def on_a(data):
        if not started_future.done() and data["sessions"]:
            started_future.set_result(data)

    await a.emit("spatial_session_start", {"sessionId": "s1"})
    await asyncio.wait_for(started_future, timeout=2)

    b = socketio.AsyncClient()
    snapshot_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("spatial_sessions")
    async def on_b(data):
        if not snapshot_future.done():
            snapshot_future.set_result(data)

    await asyncio.wait_for(
        b.connect(server, auth={"x-dev-email": "b@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )

    payload = await asyncio.wait_for(snapshot_future, timeout=2)
    assert payload["sessions"] == [{"sessionId": "s1", "members": ["a@example.com"]}]

    await a.disconnect()
    await b.disconnect()


async def test_spatial_session_leave_broadcasts_updated_snapshot_to_others(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("spatial_sessions")
    async def on_start(data):
        if not started_future.done() and data["sessions"]:
            started_future.set_result(data)

    await a.emit("spatial_session_start", {"sessionId": "s1"})
    await asyncio.wait_for(started_future, timeout=2)

    left_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("spatial_sessions")
    async def on_leave(data):
        if not left_future.done():
            left_future.set_result(data)

    await a.emit("spatial_session_leave")

    payload = await asyncio.wait_for(left_future, timeout=2)
    assert payload["sessions"] == []

    await a.disconnect()
    await b.disconnect()


async def test_disconnect_cleans_up_spatial_session_and_broadcasts(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("spatial_sessions")
    async def on_start(data):
        if not started_future.done() and data["sessions"]:
            started_future.set_result(data)

    await a.emit("spatial_session_start", {"sessionId": "s1"})
    await asyncio.wait_for(started_future, timeout=2)

    disconnect_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("spatial_sessions")
    async def on_disconnect_broadcast(data):
        if not disconnect_future.done():
            disconnect_future.set_result(data)

    await a.disconnect()

    payload = await asyncio.wait_for(disconnect_future, timeout=2)
    assert payload["sessions"] == []

    await b.disconnect()


async def test_moving_between_sessions_reflected_in_final_broadcast(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    first_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("spatial_sessions")
    async def on_first(data):
        if not first_future.done() and data["sessions"]:
            first_future.set_result(data)

    await a.emit("spatial_session_start", {"sessionId": "s1"})
    await asyncio.wait_for(first_future, timeout=2)

    second_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("spatial_sessions")
    async def on_second(data):
        if not second_future.done():
            second_future.set_result(data)

    await a.emit("spatial_session_start", {"sessionId": "s2"})

    payload = await asyncio.wait_for(second_future, timeout=2)
    assert payload["sessions"] == [{"sessionId": "s2", "members": ["a@example.com"]}]

    await a.disconnect()
    await b.disconnect()


async def test_unrelated_second_socket_disconnecting_does_not_eject_from_the_session(server):
    """STAGE 0 REGRESSION GUARD. The frontend opens ~10 independent Socket.IO connections per
    user (RealChatService, movementSync, dndClient, ...), all authenticating as the same email;
    only spatialSessionStore's connection emits spatial_session_start. Disconnect cleanup used
    to remove membership BY EMAIL, so any one of those unrelated sockets dropping ejected the
    user from their spatial conversation. It must now be a no-op."""
    a_spatial = await _connect_as(server, "a@example.com")
    a_unrelated = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_received: list[dict] = []

    @b.on("spatial_sessions")
    async def on_b(data):
        b_received.append(data)

    await a_spatial.emit("spatial_session_start", {"sessionId": "s1"})
    for _ in range(100):
        if b_received and b_received[-1]["sessions"]:
            break
        await asyncio.sleep(0.02)
    assert b_received[-1]["sessions"] == [{"sessionId": "s1", "members": ["a@example.com"]}]

    b_received.clear()
    await a_unrelated.disconnect()
    await asyncio.sleep(0.4)

    # No removal broadcast at all, and the server still holds the membership.
    assert b_received == []
    assert socket_module.spatial_sessions.session_of("a@example.com") == "s1"

    await a_spatial.disconnect()
    await b.disconnect()


async def test_disconnecting_the_owning_socket_still_removes_membership(server):
    """The other half of the ownership rule: precise ownership must not become permanent
    membership. When the socket that actually started the session goes, membership ends."""
    a_spatial = await _connect_as(server, "a@example.com")
    a_unrelated = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_received: list[dict] = []

    @b.on("spatial_sessions")
    async def on_b(data):
        b_received.append(data)

    await a_spatial.emit("spatial_session_start", {"sessionId": "s1"})
    for _ in range(100):
        if b_received and b_received[-1]["sessions"]:
            break
        await asyncio.sleep(0.02)

    b_received.clear()
    await a_spatial.disconnect()
    for _ in range(100):
        if b_received:
            break
        await asyncio.sleep(0.02)

    assert b_received[-1]["sessions"] == []
    assert socket_module.spatial_sessions.session_of("a@example.com") is None

    await a_unrelated.disconnect()
    await b.disconnect()


async def test_two_owning_sockets_survive_one_of_them_dropping(server):
    """Multi-tab: both tabs opened the same spatial conversation, so both own it. Closing one
    tab must not eject the user; closing the last one must."""
    tab1 = await _connect_as(server, "a@example.com")
    tab2 = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    await tab1.emit("spatial_session_start", {"sessionId": "s1"})
    await tab2.emit("spatial_session_start", {"sessionId": "s1"})
    await asyncio.sleep(0.3)

    b_received: list[dict] = []

    @b.on("spatial_sessions")
    async def on_b(data):
        b_received.append(data)

    await tab1.disconnect()
    await asyncio.sleep(0.4)
    assert b_received == []
    assert socket_module.spatial_sessions.session_of("a@example.com") == "s1"
    # Exactly one member, not one per socket.
    assert socket_module.spatial_sessions.snapshot() == [
        {"sessionId": "s1", "members": ["a@example.com"]}
    ]

    await tab2.disconnect()
    for _ in range(100):
        if b_received:
            break
        await asyncio.sleep(0.02)
    assert b_received[-1]["sessions"] == []

    await b.disconnect()


async def test_reconnect_reassert_restores_membership_and_rebroadcasts(server):
    """Simulates spatialSessionStore.ts's "connect" re-assert: the owning socket drops (its
    disconnect clears the membership) and the reconnected socket re-emits the same session id
    over a brand-new sid."""
    a_first = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_received: list[dict] = []

    @b.on("spatial_sessions")
    async def on_b(data):
        b_received.append(data)

    await a_first.emit("spatial_session_start", {"sessionId": "s1"})
    for _ in range(100):
        if b_received and b_received[-1]["sessions"]:
            break
        await asyncio.sleep(0.02)

    await a_first.disconnect()
    for _ in range(100):
        if b_received and b_received[-1]["sessions"] == []:
            break
        await asyncio.sleep(0.02)
    assert b_received[-1]["sessions"] == []

    a_again = await _connect_as(server, "a@example.com")
    b_received.clear()
    await a_again.emit("spatial_session_start", {"sessionId": "s1"})
    for _ in range(100):
        if b_received and b_received[-1]["sessions"]:
            break
        await asyncio.sleep(0.02)

    assert b_received[-1]["sessions"] == [{"sessionId": "s1", "members": ["a@example.com"]}]

    await a_again.disconnect()
    await b.disconnect()


async def test_explicit_leave_then_unrelated_disconnect_emits_no_second_removal(server):
    """Explicit leave (panel closed) drops every owning sid, so the owning socket's later
    disconnect must not re-broadcast a stale removal."""
    a_spatial = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_received: list[dict] = []

    @b.on("spatial_sessions")
    async def on_b(data):
        b_received.append(data)

    await a_spatial.emit("spatial_session_start", {"sessionId": "s1"})
    for _ in range(100):
        if b_received and b_received[-1]["sessions"]:
            break
        await asyncio.sleep(0.02)

    await a_spatial.emit("spatial_session_leave")
    for _ in range(100):
        if b_received and b_received[-1]["sessions"] == []:
            break
        await asyncio.sleep(0.02)

    b_received.clear()
    await a_spatial.disconnect()
    await asyncio.sleep(0.4)

    assert b_received == []
    assert socket_module.spatial_sessions.session_of("a@example.com") is None

    await b.disconnect()


async def test_session_upgrade_over_the_same_socket_keeps_a_single_membership(server):
    """Ask-to-Join upgrade: accept_join_request mints a NEW conversation id, and the client
    leaves the old session then starts the new one over the SAME socket. Membership must follow
    the new id with no duplicate/stale entry."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    await a.emit("spatial_session_start", {"sessionId": "old-conv"})
    await b.emit("spatial_session_start", {"sessionId": "old-conv"})
    await asyncio.sleep(0.3)
    assert socket_module.spatial_sessions.snapshot() == [
        {"sessionId": "old-conv", "members": ["a@example.com", "b@example.com"]}
    ]

    # Mirrors OfficeMap's conversation_upgraded handler: leave the old id, start the new one.
    await a.emit("spatial_session_leave")
    await a.emit("spatial_session_start", {"sessionId": "new-conv"})
    await b.emit("spatial_session_leave")
    await b.emit("spatial_session_start", {"sessionId": "new-conv"})
    await asyncio.sleep(0.3)

    assert socket_module.spatial_sessions.snapshot() == [
        {"sessionId": "new-conv", "members": ["a@example.com", "b@example.com"]}
    ]

    await a.disconnect()
    await b.disconnect()
    await asyncio.sleep(0.3)
    assert socket_module.spatial_sessions.snapshot() == []
