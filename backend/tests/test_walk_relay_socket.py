from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
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


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def test_walk_started_rebroadcasts_to_others_not_sender(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    a_future: asyncio.Future = asyncio.get_event_loop().create_future()
    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @a.on("peer_walk_started")
    async def on_a(data):
        if not a_future.done():
            a_future.set_result(data)

    @b.on("peer_walk_started")
    async def on_b(data):
        if not b_future.done():
            b_future.set_result(data)

    payload = {"from": {"x": 0, "y": 0}, "path": [{"x": 10, "y": 0}, {"x": 20, "y": 0}]}
    await a.emit("walk_started", payload)

    b_payload = await asyncio.wait_for(b_future, timeout=2)
    assert b_payload["from"] == payload["from"]
    assert b_payload["path"] == payload["path"]

    await asyncio.sleep(0.2)
    assert not a_future.done()

    await a.disconnect()
    await b.disconnect()


async def test_walk_started_uses_server_identity_ignoring_client_email(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_started")
    async def on_b(data):
        if not b_future.done():
            b_future.set_result(data)

    payload = {
        "from": {"x": 0, "y": 0},
        "path": [{"x": 10, "y": 0}],
        "email": "evil@example.com",
    }
    await a.emit("walk_started", payload)

    b_payload = await asyncio.wait_for(b_future, timeout=2)
    assert b_payload["email"] == "a@example.com"

    await a.disconnect()
    await b.disconnect()


async def test_walk_arrived_rebroadcasts_to_others_not_sender(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    a_future: asyncio.Future = asyncio.get_event_loop().create_future()
    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @a.on("peer_walk_arrived")
    async def on_a(data):
        if not a_future.done():
            a_future.set_result(data)

    @b.on("peer_walk_arrived")
    async def on_b(data):
        if not b_future.done():
            b_future.set_result(data)

    payload = {"at": {"x": 5, "y": 5}}
    await a.emit("walk_arrived", payload)

    b_payload = await asyncio.wait_for(b_future, timeout=2)
    assert b_payload["at"] == payload["at"]

    await asyncio.sleep(0.2)
    assert not a_future.done()

    await a.disconnect()
    await b.disconnect()


async def test_walk_arrived_uses_server_identity_ignoring_client_email(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_arrived")
    async def on_b(data):
        if not b_future.done():
            b_future.set_result(data)

    payload = {"at": {"x": 5, "y": 5}, "email": "evil@example.com"}
    await a.emit("walk_arrived", payload)

    b_payload = await asyncio.wait_for(b_future, timeout=2)
    assert b_payload["email"] == "a@example.com"

    await a.disconnect()
    await b.disconnect()


async def test_invalid_walk_payloads_rejected_without_crash(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    malformed_payloads = [
        {},
        {"path": [{"x": 1, "y": 1}]},
        {"from": {"x": "0", "y": 0}, "path": [{"x": 1, "y": 1}]},
        {"from": {"x": 0, "y": 0}, "path": []},
        {"from": {"x": 0, "y": 0}, "path": "not-a-list"},
        {"from": {"x": 0, "y": 0}, "path": [{"x": 1}]},
    ]

    for bad_payload in malformed_payloads:
        b_future: asyncio.Future = asyncio.get_event_loop().create_future()

        @b.on("peer_walk_started")
        async def on_b(data, _fut=b_future):
            if not _fut.done():
                _fut.set_result(data)

        await a.emit("walk_started", bad_payload)
        await asyncio.sleep(0.2)
        assert not b_future.done()

    valid_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_started")
    async def on_valid(data):
        if not valid_future.done():
            valid_future.set_result(data)

    valid_payload = {"from": {"x": 0, "y": 0}, "path": [{"x": 1, "y": 1}]}
    await a.emit("walk_started", valid_payload)

    valid_result = await asyncio.wait_for(valid_future, timeout=2)
    assert valid_result["path"] == valid_payload["path"]

    await a.disconnect()
    await b.disconnect()


async def test_walk_path_length_cap_enforced(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    too_long_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_started")
    async def on_too_long(data):
        if not too_long_future.done():
            too_long_future.set_result(data)

    too_long_payload = {"from": {"x": 0, "y": 0}, "path": [{"x": i, "y": 0} for i in range(65)]}
    await a.emit("walk_started", too_long_payload)
    await asyncio.sleep(0.2)
    assert not too_long_future.done()

    ok_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_started")
    async def on_ok(data):
        if not ok_future.done():
            ok_future.set_result(data)

    ok_payload = {"from": {"x": 0, "y": 0}, "path": [{"x": i, "y": 0} for i in range(64)]}
    await a.emit("walk_started", ok_payload)

    ok_result = await asyncio.wait_for(ok_future, timeout=2)
    assert len(ok_result["path"]) == 64

    await a.disconnect()
    await b.disconnect()
