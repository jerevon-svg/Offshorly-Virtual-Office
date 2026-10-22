from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn
from sqlalchemy import select

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.models.position import EmployeePosition
from app.realtime import socket as socket_module

# PARKOUR V1 — THE SERVER'S HALF: two small additions to existing relays, nothing more.
#   1. `parkour` → `peer_parkour`: a double jump (with its flip) or a landing roll. An allow-list of kinds; the
#      identity and the time are the server's; the client adds only its own `seq` and, for a roll, a bounded `ms`.
#      No state, no persistence, a per-kind floor on frequency. `jump` itself is unchanged (plus an optional seq).
#   2. `feet` on walk_started / walk_arrived: how high a V2 body stands (a furniture top). Relayed and kept for the
#      snapshot a late joiner receives — in memory only, never written to employee_positions.

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
    yield f"http://127.0.0.1:{srv.servers[0].sockets[0].getsockname()[1]}"
    srv.should_exit = True
    await task
    socket_module.position_registry.reset()
    settings.APP_ENV = original_env


async def _connect(url: str, email: str, on: dict | None = None) -> socketio.AsyncClient:
    c = socketio.AsyncClient()
    for name, fn in (on or {}).items():
        c.on(name, fn)
    await asyncio.wait_for(c.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]), timeout=5)
    return c


async def _wait(pred, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


P = {"x": 700.0, "y": 500.0}


async def test_parkour_relays_kind_seq_and_a_rolls_duration_from_the_session(server):
    a = await _connect(server, "a@example.com")
    got: list = []
    b = await _connect(server, "b@example.com", {"peer_parkour": lambda d: got.append(d)})
    await asyncio.sleep(0.2)
    await a.emit("parkour", {"kind": "double", "seq": 2, "email": "victim@example.com", "y": 999, "ms": 900})
    await asyncio.sleep(0.35)
    await a.emit("parkour", {"kind": "roll", "seq": 3, "ms": 880})
    assert await _wait(lambda: len(got) == 2)
    assert got[0]["email"] == "a@example.com" and got[0]["kind"] == "double" and got[0]["seq"] == 2
    assert set(got[0]) == {"email", "at", "kind", "seq"}  # a double carries no duration; nothing else is read
    assert got[1]["kind"] == "roll" and got[1]["ms"] == 880 and isinstance(got[1]["at"], int)
    await a.disconnect()
    await b.disconnect()


async def test_parkour_refuses_unknown_kinds_bad_values_and_floods(server):
    a = await _connect(server, "a@example.com")
    got: list = []
    b = await _connect(server, "b@example.com", {"peer_parkour": lambda d: got.append(d)})
    await asyncio.sleep(0.2)
    for bad in [None, {}, {"kind": "triple"}, {"kind": "jump"}, {"kind": ["roll"]}]:
        await a.emit("parkour", bad)
    await a.emit("parkour", {"kind": "roll", "seq": -1, "ms": 99999})
    await a.emit("parkour", {"kind": "roll", "seq": 5, "ms": 700})  # inside the per-kind floor: dropped
    assert await _wait(lambda: len(got) >= 1)
    await asyncio.sleep(0.3)
    assert len(got) == 1
    assert set(got[0]) == {"email", "at", "kind"}  # a bad seq and an out-of-range duration are simply absent
    await a.disconnect()
    await b.disconnect()


async def test_a_double_jump_right_after_its_jump_is_not_swallowed_by_the_jump_floor(server):
    a = await _connect(server, "a@example.com")
    jumps: list = []
    doubles: list = []
    b = await _connect(server, "b@example.com", {"peer_jump": lambda d: jumps.append(d), "peer_parkour": lambda d: doubles.append(d)})
    await asyncio.sleep(0.2)
    await a.emit("jump", {"seq": 1})
    await asyncio.sleep(0.1)
    await a.emit("parkour", {"kind": "double", "seq": 2})
    assert await _wait(lambda: jumps and doubles)
    assert jumps[0]["seq"] == 1 and doubles[0]["seq"] == 2
    assert doubles[0]["at"] >= jumps[0]["at"]
    await a.disconnect()
    await b.disconnect()


async def test_vault_and_mantle_relay_duration_and_bounded_heights_only(server):
    # PARKOUR V2 — two more kinds on the same event: a duration and the heights relative to the start, bounded; no
    # position ever travels here (the traversal's line is the walk published with it)
    a = await _connect(server, "a@example.com")
    got: list = []
    b = await _connect(server, "b@example.com", {"peer_parkour": lambda d: got.append(d)})
    await asyncio.sleep(0.2)
    await a.emit("parkour", {"kind": "vault", "seq": 7, "ms": 640, "rise": 0, "apex": 25, "x": 1, "to": {"x": 9}})
    await a.emit("parkour", {"kind": "mantle", "seq": 8, "ms": 900, "rise": 24.5, "apex": 24.5})
    assert await _wait(lambda: len(got) == 2)
    assert got[0] == {"email": "a@example.com", "at": got[0]["at"], "kind": "vault", "seq": 7, "ms": 640, "rise": 0.0, "apex": 25.0}
    assert got[1]["kind"] == "mantle" and got[1]["rise"] == 24.5 and got[1]["ms"] == 900
    await asyncio.sleep(0.35)
    # out of range, wrong types: simply absent; a double never carries heights
    await a.emit("parkour", {"kind": "mantle", "seq": 9, "ms": 900, "rise": 400, "apex": True})
    await a.emit("parkour", {"kind": "double", "seq": 10, "rise": 5, "apex": 5})
    assert await _wait(lambda: len(got) == 4)
    assert set(got[2]) == {"email", "at", "kind", "seq", "ms"}
    assert set(got[3]) == {"email", "at", "kind", "seq"}
    await a.disconnect()
    await b.disconnect()


async def test_feet_is_relayed_and_reaches_a_late_joiner_but_is_never_persisted(server):
    a = await _connect(server, "a@example.com")
    started: list = []
    arrived: list = []
    b = await _connect(server, "b@example.com", {"peer_walk_started": lambda d: started.append(d), "peer_walk_arrived": lambda d: arrived.append(d)})
    await asyncio.sleep(0.2)
    await a.emit("walk_started", {"movementId": "m1", "origin": P, "path": [P], "roomId": None, "durationMs": 100, "feet": 15.6})
    await asyncio.sleep(0.15)
    await a.emit("walk_arrived", {"movementId": "m1", "at": P, "facing": "front", "state": "standing", "seatKey": None, "roomId": None, "feet": 15.6})
    assert await _wait(lambda: started and arrived)
    assert started[-1]["feet"] == 15.6 and arrived[-1]["feet"] == 15.6

    snaps: list = []
    c = await _connect(server, "c@example.com", {"positions_snapshot": lambda d: snaps.append(d)})
    assert await _wait(lambda: snaps)
    mine = [e for e in snaps[-1]["entries"] if e["email"] == "a@example.com"]
    assert mine and mine[0]["feet"] == 15.6

    async with async_session_maker() as session:
        rows = list((await session.execute(select(EmployeePosition))).scalars().all())
    assert all(not hasattr(r, "feet") for r in rows)
    for client in (a, b, c):
        await client.disconnect()


async def test_a_walk_with_a_malformed_feet_is_refused_whole_and_one_without_is_unchanged(server):
    a = await _connect(server, "a@example.com")
    started: list = []
    b = await _connect(server, "b@example.com", {"peer_walk_started": lambda d: started.append(d)})
    await asyncio.sleep(0.2)
    for bad in ["15", -1, 9999, True]:
        await a.emit("walk_started", {"movementId": f"x{bad}", "origin": P, "path": [P], "roomId": None, "durationMs": 100, "feet": bad})
    await a.emit("walk_started", {"movementId": "ok", "origin": P, "path": [P], "roomId": None, "durationMs": 100})
    assert await _wait(lambda: started)
    await asyncio.sleep(0.2)
    assert [s["movementId"] for s in started] == ["ok"]
    assert "feet" not in started[0]
    await a.disconnect()
    await b.disconnect()
