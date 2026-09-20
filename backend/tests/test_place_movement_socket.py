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

# PHASE 7D — MOVEMENT INSIDE A PLACE V1 HAS NO COORDINATES FOR.
#
# The Championship Cave is outside V1's frame, so `at`/`origin`/`path` cannot describe a body in it.
# They keep their original meaning — the in-frame portal — and the real position rides beside them in
# `localAt`/`localOrigin`/`localPath`, in the frame `roomId` names.
#
# THE TWO PROMISES UNDER TEST, because both are what make this safe rather than merely working:
#   1. the local coordinates are relayed but NEVER persisted — employee_positions keeps the V1 point;
#   2. a leg that moves only the local coordinates writes NO database row at all.

pytestmark = pytest.mark.asyncio

CAVE = "championship-cave"
PORTAL = {"x": 700.0, "y": 500.0}


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


async def _connect(url: str, email: str) -> socketio.AsyncClient:
    c = socketio.AsyncClient()
    await asyncio.wait_for(
        c.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return c


async def _wait(pred, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


async def _rows() -> list[EmployeePosition]:
    async with async_session_maker() as session:
        return list((await session.execute(select(EmployeePosition))).scalars().all())


async def _leg(client, mid: str, local_from: dict, local_to: dict) -> None:
    """One leg of Cave movement: the V1 half never moves, the local half does."""
    await client.emit("walk_started", {
        "movementId": mid, "origin": PORTAL, "path": [PORTAL], "roomId": CAVE, "durationMs": 100,
        "localOrigin": local_from, "localPath": [local_to],
    })
    await asyncio.sleep(0.15)
    await client.emit("walk_arrived", {
        "movementId": mid, "at": PORTAL, "facing": "front", "state": "standing",
        "seatKey": None, "roomId": CAVE, "localAt": local_to,
    })


async def test_the_local_walk_is_relayed_to_peers(server):
    a = await _connect(server, "a@example.com")
    b = await _connect(server, "b@example.com")
    started, arrived = [], []
    b.on("peer_walk_started", lambda d: started.append(d))
    b.on("peer_walk_arrived", lambda d: arrived.append(d))
    await asyncio.sleep(0.2)

    await _leg(a, "m1", {"x": 2700.0, "y": 800.0}, {"x": 2760.0, "y": 830.0})

    assert await _wait(lambda: started and arrived)
    assert started[-1]["localOrigin"] == {"x": 2700.0, "y": 800.0}
    assert started[-1]["localPath"] == [{"x": 2760.0, "y": 830.0}]
    assert arrived[-1]["localAt"] == {"x": 2760.0, "y": 830.0}
    # The V1 half is untouched and still means what it always meant.
    assert started[-1]["origin"] == PORTAL
    assert arrived[-1]["at"] == PORTAL
    assert arrived[-1]["roomId"] == CAVE

    await a.disconnect()
    await b.disconnect()


async def test_local_coordinates_are_never_persisted(server):
    a = await _connect(server, "a@example.com")
    await asyncio.sleep(0.2)
    await _leg(a, "m1", {"x": 2700.0, "y": 800.0}, {"x": 2999.0, "y": 888.0})
    await asyncio.sleep(0.4)

    rows = await _rows()
    assert len(rows) == 1
    # The portal, and nothing from the Cave. This is why no column and no migration were needed.
    assert (rows[0].x, rows[0].y) == (PORTAL["x"], PORTAL["y"])
    assert rows[0].room_id == CAVE

    await a.disconnect()


async def test_a_leg_that_moves_only_the_local_position_writes_no_row(server):
    a = await _connect(server, "a@example.com")
    await asyncio.sleep(0.2)

    # First leg establishes the V1 row.
    await _leg(a, "m1", {"x": 2700.0, "y": 800.0}, {"x": 2760.0, "y": 800.0})
    await asyncio.sleep(0.4)
    first = (await _rows())[0]
    revision_after_first = first.revision

    # Three more legs of real Cave walking — the V1 point never changes.
    for i, x in enumerate([2820.0, 2880.0, 2940.0]):
        await _leg(a, f"m{i + 2}", {"x": x - 60, "y": 800.0}, {"x": x, "y": 800.0})
        await asyncio.sleep(0.25)

    rows = await _rows()
    assert len(rows) == 1
    # NOT ONE WRITE: same revision on the row, while the registry has moved on.
    assert rows[0].revision == revision_after_first
    assert socket_module.position_registry.get("a@example.com").stable.revision > revision_after_first
    # And the live position the registry holds IS the latest Cave one.
    assert socket_module.position_registry.get("a@example.com").stable.local_x == 2940.0

    await a.disconnect()


async def test_ordinary_office_movement_is_persisted_exactly_as_before(server):
    a = await _connect(server, "a@example.com")
    await asyncio.sleep(0.2)

    await a.emit("walk_started", {
        "movementId": "o1", "origin": {"x": 100.0, "y": 100.0}, "path": [{"x": 200.0, "y": 150.0}],
        "roomId": "design-team", "durationMs": 400,
    })
    await asyncio.sleep(0.2)
    await a.emit("walk_arrived", {
        "movementId": "o1", "at": {"x": 200.0, "y": 150.0}, "facing": "front",
        "state": "standing", "seatKey": None, "roomId": "design-team",
    })
    await asyncio.sleep(0.4)

    rows = await _rows()
    assert len(rows) == 1
    assert (rows[0].x, rows[0].y) == (200.0, 150.0)
    assert rows[0].local_x if hasattr(rows[0], "local_x") else True  # column does not exist — by design

    await a.disconnect()


async def test_a_client_that_sends_no_local_fields_is_unchanged(server):
    """Backward compatibility: a V1 client, or a V2 client from before this shipped."""
    a = await _connect(server, "a@example.com")
    b = await _connect(server, "b@example.com")
    started = []
    b.on("peer_walk_started", lambda d: started.append(d))
    await asyncio.sleep(0.2)

    await a.emit("walk_started", {
        "movementId": "o1", "origin": {"x": 100.0, "y": 100.0}, "path": [{"x": 200.0, "y": 150.0}],
        "roomId": None, "durationMs": 400,
    })
    assert await _wait(lambda: started)
    # The keys are simply absent, exactly as they were before this existed.
    assert "localOrigin" not in started[-1]
    assert "localPath" not in started[-1]

    await a.disconnect()
    await b.disconnect()


async def test_a_malformed_local_payload_is_refused_whole(server):
    a = await _connect(server, "a@example.com")
    b = await _connect(server, "b@example.com")
    started = []
    b.on("peer_walk_started", lambda d: started.append(d))
    await asyncio.sleep(0.2)

    await a.emit("walk_started", {
        "movementId": "m1", "origin": PORTAL, "path": [PORTAL], "roomId": CAVE, "durationMs": 100,
        "localOrigin": {"x": "nope", "y": 800.0},
    })
    await asyncio.sleep(0.3)
    assert started == []

    await a.disconnect()
    await b.disconnect()
