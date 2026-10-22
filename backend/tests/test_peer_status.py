from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module
from app.services.peer_status_registry import PeerStatusRegistry

# Peer status relay (peer_status_registry.py): each connected person's own effective office status, carried
# to every other client as the `peer_status` snapshot — set by status_set, sent to a newcomer on connect,
# removed by disconnect. Real server over a socket, like tests/test_dnd_room_lock_socket.py.


def test_registry_changes_only_on_real_transitions_and_refuses_unknown_values():
    r = PeerStatusRegistry()
    assert r.set_status("Bon@Example.com", "AVAILABLE") is True
    assert r.set_status("bon@example.com ", "AVAILABLE") is False   # same person, same status: no broadcast
    assert r.set_status("bon@example.com", "BUSY") is True
    assert r.set_status("bon@example.com", "NOT_A_STATUS") is False  # never stored
    assert r.snapshot() == {"bon@example.com": "BUSY"}
    assert r.clear("BON@example.com") is True and r.clear("bon@example.com") is False
    assert r.snapshot() == {}


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    socket_module.peer_status._status.clear()
    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    await task
    socket_module.peer_status._status.clear()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str, seen: list) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    client.on("peer_status", lambda payload: seen.append(payload["statuses"]))
    await asyncio.wait_for(client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]), timeout=5)
    return client


async def _until(predicate, timeout=3.0):
    for _ in range(int(timeout / 0.02)):
        if predicate():
            return True
        await asyncio.sleep(0.02)
    return False


@pytest.mark.asyncio
async def test_status_set_reaches_peers_newcomers_see_it_and_disconnect_clears_it(server):
    bon_seen, lui_seen = [], []
    bon = await _connect_as(server, "jerevon@offshorly.com", bon_seen)
    lui = await _connect_as(server, "louiejie@offshorly.com", lui_seen)

    await bon.emit("status_set", {"status": "BUSY"})
    assert await _until(lambda: lui_seen and lui_seen[-1].get("jerevon@offshorly.com") == "BUSY")

    await lui.emit("status_set", {"status": "BREAK"})
    assert await _until(lambda: bon_seen and bon_seen[-1].get("louiejie@offshorly.com") == "BREAK")

    await lui.emit("status_set", {"status": "nonsense"})        # refused: the last good value stands
    await asyncio.sleep(0.2)
    assert socket_module.peer_status.status_of("louiejie@offshorly.com") == "BREAK"

    late_seen = []                                               # a newcomer gets the current snapshot on connect
    late = await _connect_as(server, "clarisse@offshorly.com", late_seen)
    assert await _until(lambda: late_seen and late_seen[0] == {"jerevon@offshorly.com": "BUSY", "louiejie@offshorly.com": "BREAK"})

    await lui.disconnect()                                       # disconnect removes Lui — no stale entry
    assert await _until(lambda: bon_seen and "louiejie@offshorly.com" not in bon_seen[-1])

    lui2_seen = []                                               # reconnect + re-assert restores exactly one entry
    lui2 = await _connect_as(server, "louiejie@offshorly.com", lui2_seen)
    await lui2.emit("status_set", {"status": "DND"})
    assert await _until(lambda: bon_seen and bon_seen[-1].get("louiejie@offshorly.com") == "DND")
    assert list(socket_module.peer_status.snapshot()).count("louiejie@offshorly.com") == 1

    for c in (bon, late, lui2):
        await c.disconnect()
