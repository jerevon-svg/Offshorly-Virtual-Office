from __future__ import annotations

import asyncio

import httpx
import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module

# Socket-layer coverage for the DND-room-lock feature's realtime plumbing: dnd_status/
# room_presence broadcasts, and the auto-cancel-on-unlock path that ties the ephemeral
# registries to the DB-backed room_entry_requests lifecycle. Mirrors
# tests/test_spatial_session_socket.py's real-server-over-a-socket approach.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    socket_module.dnd_registry._dnd_emails.clear()
    socket_module.room_presence._room_by_email.clear()

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]

    yield f"http://127.0.0.1:{port}"

    srv.should_exit = True
    await task
    socket_module.dnd_registry._dnd_emails.clear()
    socket_module.room_presence._room_by_email.clear()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def test_dnd_set_broadcasts_to_all_connected_clients(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("dnd_status")
    async def on_b(data):
        if not b_future.done() and data["emails"]:
            b_future.set_result(data)

    await a.emit("dnd_set", {"isDnd": True})

    payload = await asyncio.wait_for(b_future, timeout=2)
    assert payload["emails"] == ["a@example.com"]

    await a.disconnect()
    await b.disconnect()


async def test_room_presence_enter_broadcasts_to_all_connected_clients(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("room_presence")
    async def on_b(data):
        if not b_future.done() and data["rooms"]:
            b_future.set_result(data)

    await a.emit("room_presence_enter", {"roomId": "design-team"})

    payload = await asyncio.wait_for(b_future, timeout=2)
    assert payload["rooms"] == [{"roomId": "design-team", "members": ["a@example.com"]}]

    await a.disconnect()
    await b.disconnect()


async def test_last_dnd_occupant_clearing_dnd_cancels_pending_room_request(server):
    occupant = await _connect_as(server, "occupant@example.com")
    requester = await _connect_as(server, "outsider@example.com")
    await asyncio.sleep(0.2)

    await occupant.emit("room_presence_enter", {"roomId": "design-team"})
    await occupant.emit("dnd_set", {"isDnd": True})
    await asyncio.sleep(0.2)

    async with httpx.AsyncClient(base_url=server) as http:
        create_res = await http.post(
            "/room-requests",
            json={"roomId": "design-team"},
            headers={"x-dev-email": "outsider@example.com"},
        )
    assert create_res.status_code == 201
    request_id = create_res.json()["id"]

    cancelled_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @requester.on("room_request_cancelled")
    async def on_cancelled(data):
        if not cancelled_future.done():
            cancelled_future.set_result(data)

    # The room's only DND occupant turns DND off — the room unlocks, and the still-pending
    # Knock against it must be auto-cancelled and pushed live to the requester.
    await occupant.emit("dnd_set", {"isDnd": False})

    payload = await asyncio.wait_for(cancelled_future, timeout=2)
    assert payload["id"] == request_id
    assert payload["state"] == "cancelled"

    await occupant.disconnect()
    await requester.disconnect()
