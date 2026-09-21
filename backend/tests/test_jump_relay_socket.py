"""The `jump` -> `peer_jump` relay.

A jump is COSMETIC and TRANSIENT: it says "this employee just left the floor, now", and the receiving
client draws an arc from its own physics. So the contract these tests pin is deliberately narrow, and
the narrowness IS the safety argument:

  * the identity is the server's, never the payload's;
  * nothing a client sends is read at all, so no vertical position, room or duration can reach
    collision, pathfinding, seating or room access;
  * no revision is issued, no registry entry is written and no row is persisted — so there is nothing
    to migrate and no way for a jump to come back out of a snapshot or survive a reconnect;
  * the sender is excluded, exactly as every other broadcast here excludes it.
"""

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
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    socket_module.position_registry.reset()

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]

    yield f"http://127.0.0.1:{port}"

    srv.should_exit = True
    await task
    socket_module.position_registry.reset()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


def _collect(client: socketio.AsyncClient, event: str) -> list:
    received: list = []

    @client.on(event)
    async def _on(data):  # noqa: ANN001
        received.append(data)

    return received


async def test_jump_broadcasts_email_and_server_time_and_excludes_sender(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    on_a = _collect(a, "peer_jump")
    on_b = _collect(b, "peer_jump")

    await a.emit("jump")
    await asyncio.sleep(0.3)

    assert len(on_b) == 1
    assert on_b[0]["email"] == "a@example.com"
    assert isinstance(on_b[0]["at"], int)
    # the payload is exactly those two facts and nothing else
    assert set(on_b[0]) == {"email", "at"}
    assert on_a == []  # sender excluded via skip_sid

    await a.disconnect()
    await b.disconnect()


async def test_jump_ignores_whatever_the_client_sends(server):
    """Nothing in the payload is read, so nothing in it can be asserted — including a position."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    on_b = _collect(b, "peer_jump")

    await a.emit("jump", {"email": "victim@example.com", "y": 9999, "roomId": "executive", "at": 1})
    await asyncio.sleep(0.3)

    assert len(on_b) == 1
    assert on_b[0]["email"] == "a@example.com"  # the SESSION's email, not the payload's
    assert set(on_b[0]) == {"email", "at"}

    await a.disconnect()
    await b.disconnect()


async def test_jump_accepts_a_malformed_payload_without_erroring(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    errors = _collect(a, "chat_error")
    on_b = _collect(b, "peer_jump")

    await a.emit("jump", "not-a-dict")
    await asyncio.sleep(0.3)

    assert errors == []
    assert len(on_b) == 1  # the payload is irrelevant; the event still means what it means

    await a.disconnect()
    await b.disconnect()


async def test_repeated_jumps_are_throttled_per_connection(server):
    """A client cannot legitimately out-pace its own arc; this is the floor under one that tries."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    on_b = _collect(b, "peer_jump")

    for _ in range(10):
        await a.emit("jump")
    await asyncio.sleep(0.4)

    assert len(on_b) == 1

    await a.disconnect()
    await b.disconnect()


async def test_jump_issues_no_revision_and_writes_no_position(server):
    """The relay is outside the movement pipeline entirely — nothing ordered, nothing persisted."""
    a = await _connect_as(server, "a@example.com")
    await asyncio.sleep(0.2)

    before = socket_module.position_registry.snapshot()
    await a.emit("jump")
    await asyncio.sleep(0.3)
    after = socket_module.position_registry.snapshot()

    assert after == before

    await a.disconnect()


async def test_a_client_that_never_jumps_is_unaffected(server):
    """Backward compatibility, stated as a test: an older client emits nothing and receives nothing,
    and its ordinary movement traffic is untouched by the new handler existing."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    on_b = _collect(b, "peer_jump")
    started = _collect(b, "peer_walk_started")

    await a.emit(
        "walk_started",
        {
            "movementId": "m1",
            "origin": {"x": 0, "y": 0},
            "path": [{"x": 10, "y": 0}],
            "roomId": None,
            "durationMs": 500,
        },
    )
    await asyncio.sleep(0.3)

    assert on_b == []
    assert len(started) == 1
    assert started[0]["revision"] == 1

    await a.disconnect()
    await b.disconnect()
