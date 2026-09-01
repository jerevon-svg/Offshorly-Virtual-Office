from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module

# Socket-layer coverage for the Stage A call state (call_joined / call_left / disconnect).
# Mirrors tests/test_spatial_session_socket.py's live-uvicorn fixture exactly.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    socket_module.spatial_sessions.reset()
    socket_module.call_registry.reset()

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


async def test_call_joined_broadcasts_participants_to_everyone(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    calls: list = []

    @b.on("spatial_calls")
    async def on_b(data):
        calls.append(data["calls"])

    await a.emit("spatial_session_start", {"sessionId": "conv-1"})
    await b.emit("spatial_session_start", {"sessionId": "conv-1"})
    await asyncio.sleep(0.3)

    await a.emit("call_joined", {"sessionId": "conv-1"})
    assert await _wait(lambda: calls and calls[-1])
    assert calls[-1][0]["sessionId"] == "conv-1"
    assert calls[-1][0]["participants"] == ["a@example.com"]
    # No media detail mirrored into the socket layer.
    assert set(calls[-1][0]) == {"sessionId", "room", "participants"}

    await a.disconnect()
    await b.disconnect()


async def test_call_joined_is_ignored_for_a_non_member_of_the_session(server):
    a = await _connect_as(server, "a@example.com")
    intruder = await _connect_as(server, "intruder@example.com")
    await asyncio.sleep(0.2)

    await a.emit("spatial_session_start", {"sessionId": "conv-1"})
    await asyncio.sleep(0.3)

    await intruder.emit("call_joined", {"sessionId": "conv-1"})
    await asyncio.sleep(0.4)

    assert socket_module.call_registry.participants("conv-1") == []

    await a.disconnect()
    await intruder.disconnect()


async def test_call_left_removes_media_but_keeps_the_spatial_session(server):
    """THE CORE STAGE A GUARANTEE: leaving a call is not leaving the conversation."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    await a.emit("spatial_session_start", {"sessionId": "conv-1"})
    await b.emit("spatial_session_start", {"sessionId": "conv-1"})
    await asyncio.sleep(0.3)
    await a.emit("call_joined", {"sessionId": "conv-1"})
    await b.emit("call_joined", {"sessionId": "conv-1"})
    assert await _wait(lambda: len(socket_module.call_registry.participants("conv-1")) == 2)

    await a.emit("call_left")
    assert await _wait(lambda: socket_module.call_registry.participants("conv-1") == ["b@example.com"])

    # Spatial membership completely untouched for BOTH people.
    assert socket_module.spatial_sessions.snapshot() == [
        {"sessionId": "conv-1", "members": ["a@example.com", "b@example.com"]}
    ]

    await a.disconnect()
    await b.disconnect()


async def test_socket_disconnect_removes_media_participation(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    await a.emit("spatial_session_start", {"sessionId": "conv-1"})
    await b.emit("spatial_session_start", {"sessionId": "conv-1"})
    await asyncio.sleep(0.3)
    await a.emit("call_joined", {"sessionId": "conv-1"})
    await b.emit("call_joined", {"sessionId": "conv-1"})
    assert await _wait(lambda: len(socket_module.call_registry.participants("conv-1")) == 2)

    await a.disconnect()
    assert await _wait(lambda: socket_module.call_registry.participants("conv-1") == ["b@example.com"])

    await b.disconnect()


async def test_an_unrelated_socket_disconnecting_does_not_drop_the_call(server):
    """Same blast-radius rule as Stage 0: only the socket that joined media owns it."""
    a_call = await _connect_as(server, "a@example.com")
    a_unrelated = await _connect_as(server, "a@example.com")
    await asyncio.sleep(0.2)

    await a_call.emit("spatial_session_start", {"sessionId": "conv-1"})
    b = await _connect_as(server, "b@example.com")
    await b.emit("spatial_session_start", {"sessionId": "conv-1"})
    await asyncio.sleep(0.3)
    await a_call.emit("call_joined", {"sessionId": "conv-1"})
    assert await _wait(lambda: socket_module.call_registry.participants("conv-1") == ["a@example.com"])

    await a_unrelated.disconnect()
    await asyncio.sleep(0.5)
    assert socket_module.call_registry.participants("conv-1") == ["a@example.com"]

    await a_call.disconnect()
    await b.disconnect()


async def test_late_joiner_receives_the_active_call_snapshot_on_connect(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)
    await a.emit("spatial_session_start", {"sessionId": "conv-1"})
    await b.emit("spatial_session_start", {"sessionId": "conv-1"})
    await asyncio.sleep(0.3)
    await a.emit("call_joined", {"sessionId": "conv-1"})
    assert await _wait(lambda: socket_module.call_registry.participants("conv-1") == ["a@example.com"])

    late = socketio.AsyncClient()
    got: list = []

    @late.on("spatial_calls")
    async def on_late(data):
        got.append(data["calls"])

    await late.connect(server, auth={"x-dev-email": "c@example.com"}, socketio_path="socket.io", transports=["websocket"])
    assert await _wait(lambda: got and got[-1])
    assert got[-1][0]["participants"] == ["a@example.com"]

    await late.disconnect()
    await a.disconnect()
    await b.disconnect()


async def test_leaving_the_spatial_session_does_not_by_itself_end_the_call_for_others(server):
    """Closing the chat panel emits spatial_session_leave only; the OTHER participant's media is
    unaffected (their own leave/disconnect is what ends it for them)."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)
    await a.emit("spatial_session_start", {"sessionId": "conv-1"})
    await b.emit("spatial_session_start", {"sessionId": "conv-1"})
    await asyncio.sleep(0.3)
    await a.emit("call_joined", {"sessionId": "conv-1"})
    await b.emit("call_joined", {"sessionId": "conv-1"})
    assert await _wait(lambda: len(socket_module.call_registry.participants("conv-1")) == 2)

    await a.emit("spatial_session_leave")
    await asyncio.sleep(0.4)

    assert socket_module.spatial_sessions.session_of("a@example.com") is None
    assert "b@example.com" in socket_module.call_registry.participants("conv-1")

    await a.disconnect()
    await b.disconnect()
