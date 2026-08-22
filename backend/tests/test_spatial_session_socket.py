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
    socket_module.spatial_sessions._session_by_email.clear()
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
