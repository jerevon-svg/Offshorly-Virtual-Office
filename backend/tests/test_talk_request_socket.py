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

# Socket-layer coverage for the talk-request auto-cancel-on-DND-off path — mirrors
# tests/test_dnd_room_lock_socket.py's real-server-over-a-socket approach.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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
    socket_module.dnd_registry._dnd_emails.clear()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def test_dnd_turning_off_cancels_pending_talk_request(server):
    target = await _connect_as(server, "a@example.com")
    requester = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    await target.emit("dnd_set", {"isDnd": True})
    await asyncio.sleep(0.2)

    async with httpx.AsyncClient(base_url=server) as http:
        create_res = await http.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers={"x-dev-email": "b@example.com"}
        )
    assert create_res.status_code == 201
    request_id = create_res.json()["id"]

    cancelled_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @requester.on("talk_request_cancelled")
    async def on_cancelled(data):
        if not cancelled_future.done():
            cancelled_future.set_result(data)

    await target.emit("dnd_set", {"isDnd": False})

    payload = await asyncio.wait_for(cancelled_future, timeout=2)
    assert payload["id"] == request_id
    assert payload["state"] == "cancelled"

    await target.disconnect()
    await requester.disconnect()


async def test_target_disconnecting_cancels_pending_talk_request(server):
    target = await _connect_as(server, "a@example.com")
    requester = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    await target.emit("dnd_set", {"isDnd": True})
    await asyncio.sleep(0.2)

    async with httpx.AsyncClient(base_url=server) as http:
        create_res = await http.post(
            "/talk-requests", json={"targetEmail": "a@example.com"}, headers={"x-dev-email": "b@example.com"}
        )
    assert create_res.status_code == 201
    request_id = create_res.json()["id"]

    cancelled_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @requester.on("talk_request_cancelled")
    async def on_cancelled(data):
        if not cancelled_future.done():
            cancelled_future.set_result(data)

    await target.disconnect()

    payload = await asyncio.wait_for(cancelled_future, timeout=2)
    assert payload["id"] == request_id

    await requester.disconnect()
