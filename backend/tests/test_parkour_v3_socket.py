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

# PARKOUR V3 — THE SERVER'S HALF: declared routes (a ladder, the zipline) validated against the server's own table and
# the sender's last known place, kept for late joiners and cleared by a halt; and the office boundary on walks — a walk
# that crosses into the working office from outside it is refused unless the sender is checked in.
#
# (the V1 header follows, for the shared fixture below)
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


from app.realtime import office_zone
from app.repositories import attendance as attendance_repo

LAB = "ai-lab"
FOOT = socket_module.TRAVERSAL_ROUTES["lab/trunk-ladder"]["a"]
ZIP = socket_module.TRAVERSAL_ROUTES["lab/zipline"]
ANCHOR = {"x": 700.0, "y": 500.0}  # the V1 point a place's walk is anchored to (any in-frame point)


async def _in_lab(client, at: dict, mid: str = "lab-1", feet: float | None = None):
    """the movement feed's in-place pair in the Lab: V1 anchor, the real point in the place's own frame, and the feet
    height when standing above the floor (on a deck)"""
    f = {"feet": feet} if feet is not None else {}
    await client.emit("walk_started", {"movementId": mid, "origin": ANCHOR, "path": [ANCHOR], "roomId": LAB, "durationMs": 100, "localOrigin": {"x": at["x"], "y": at["z"]}, "localPath": [{"x": at["x"], "y": at["z"]}], **f})
    await asyncio.sleep(0.05)
    await client.emit("walk_arrived", {"movementId": mid, "at": ANCHOR, "facing": "front", "state": "standing", "seatKey": None, "roomId": LAB, "localAt": {"x": at["x"], "y": at["z"]}, **f})
    await asyncio.sleep(0.1)


async def test_a_declared_route_from_where_the_sender_is_is_relayed_with_the_servers_own_figures(server):
    a = await _connect(server, "a@example.com")
    got: list = []
    b = await _connect(server, "b@example.com", {"peer_parkour": lambda d: got.append(d)})
    await asyncio.sleep(0.2)
    await _in_lab(a, FOOT)
    await a.emit("parkour", {"kind": "route", "route": "lab/trunk-ladder", "dir": "a", "p0": 0, "ms": 1, "seq": 4})
    assert await _wait(lambda: got)
    e = got[0]
    assert e["kind"] == "route" and e["route"] == "lab/trunk-ladder" and e["dir"] == "a" and e["p0"] == 0 and e["seq"] == 4
    assert e["ms"] == socket_module.TRAVERSAL_ROUTES["lab/trunk-ladder"]["ms"]  # never the client's figure
    await a.disconnect()
    await b.disconnect()


async def test_impossible_routes_are_dropped(server):
    a = await _connect(server, "a@example.com")
    got: list = []
    b = await _connect(server, "b@example.com", {"peer_parkour": lambda d: got.append(d)})
    await asyncio.sleep(0.2)
    # not in the Lab at all (a V1 office position)
    await a.emit("walk_started", {"movementId": "o1", "origin": ANCHOR, "path": [ANCHOR], "roomId": None, "durationMs": 100})
    await asyncio.sleep(0.1)
    await a.emit("parkour", {"kind": "route", "route": "lab/trunk-ladder", "dir": "a", "seq": 1})
    await asyncio.sleep(0.35)
    await _in_lab(a, FOOT)
    for bad in [
        {"route": "lab/secret-tunnel", "dir": "a"},          # not declared
        {"route": "lab/zipline", "dir": "b"},                # a one-way route, backwards
        {"route": "lab/trunk-ladder", "dir": "b"},           # from the far end, while standing at the foot
        {"route": "lab/trunk-ladder", "dir": "a", "p0": 2},  # not a fraction
        {"route": ["lab/trunk-ladder"], "dir": "a"},
    ]:
        await a.emit("parkour", {"kind": "route", **bad})
        await asyncio.sleep(0.32)
    # far from the zipline's start
    await a.emit("parkour", {"kind": "route", "route": "lab/zipline", "dir": "a"})
    await asyncio.sleep(0.4)
    # at the zipline's start in plan, but on the FLOOR under L2 (no feet height): an impossible elevation
    await _in_lab(a, {"x": ZIP["a"]["x"], "z": ZIP["a"]["z"]}, mid="lab-2")
    await a.emit("parkour", {"kind": "route", "route": "lab/zipline", "dir": "a"})
    await asyncio.sleep(0.4)
    assert got == []
    await a.disconnect()
    await b.disconnect()


async def test_a_late_joiner_sees_the_route_in_progress_and_a_halt_clears_it(server):
    a = await _connect(server, "a@example.com")
    halts: list = []
    b = await _connect(server, "b@example.com", {"peer_parkour": lambda d: halts.append(d) if d.get("kind") == "halt" else None})
    await asyncio.sleep(0.2)
    await _in_lab(a, {"x": ZIP["a"]["x"], "z": ZIP["a"]["z"]}, feet=ZIP["a"]["y"])
    await a.emit("parkour", {"kind": "route", "route": "lab/zipline", "dir": "a", "seq": 2})
    await asyncio.sleep(0.2)
    snaps: list = []
    c = await _connect(server, "c@example.com", {"positions_snapshot": lambda d: snaps.append(d)})
    assert await _wait(lambda: snaps)
    mine = [e for e in snaps[-1]["entries"] if e["email"] == "a@example.com"][0]
    assert mine["traversal"]["route"] == "lab/zipline" and mine["traversal"]["dir"] == "a" and isinstance(mine["traversal"]["at"], int)
    # the rider's own snapshot never carries it (no ghost of themselves)
    own: list = []
    a2 = await _connect(server, "a@example.com", {"positions_snapshot": lambda d: own.append(d)})
    assert await _wait(lambda: own)
    assert "traversal" not in [e for e in own[-1]["entries"] if e["email"] == "a@example.com"][0]
    await a.emit("parkour", {"kind": "halt", "end": "exit", "seq": 3})
    assert await _wait(lambda: halts)
    assert halts[0]["route"] == "lab/zipline" and halts[0]["end"] == "exit"
    assert socket_module.position_registry.traversal("a@example.com", socket_module._now_ms()) is None
    for client in (a, a2, b, c):
        await client.disconnect()


@pytest.mark.filterwarnings("ignore::pytest.PytestWarning")
def test_a_traversal_expires_with_its_route():
    reg = socket_module.position_registry
    reg.set_traversal("x@example.com", {"route": "lab/zipline"}, ends_at=1000)
    assert reg.traversal("x@example.com", 999) == {"route": "lab/zipline"}
    assert reg.traversal("x@example.com", 1000) is None
    reg.reset()


STREET = {"x": 700.0, "y": 1150.0}      # south of the façade
RECEPTION_PUBLIC = {"x": 500.0, "y": 960.0}
OFFICE = {"x": 500.0, "y": 700.0}       # north of the gate line, well past it


@pytest.mark.filterwarnings("ignore::pytest.PytestWarning")
def test_the_office_zone_is_conservative():
    assert office_zone.certainly_outside(STREET) and office_zone.certainly_outside(RECEPTION_PUBLIC)
    assert office_zone.certainly_office(OFFICE)
    assert not office_zone.certainly_office(RECEPTION_PUBLIC)
    # right at the gate line: neither — let through either way
    near = {"x": 500.0, "y": 860.0}
    assert not office_zone.certainly_office(near) and not office_zone.certainly_outside(near)
    assert office_zone.enters_office(RECEPTION_PUBLIC, [RECEPTION_PUBLIC, OFFICE])
    assert not office_zone.enters_office(OFFICE, [STREET])  # leaving (a checkout's ejection) is never refused


async def test_a_walk_into_the_office_needs_a_check_in(server):
    a = await _connect(server, "intruder@example.com")
    rejected: list = []
    a.on("movement_rejected", lambda d: rejected.append(d))
    started: list = []
    b = await _connect(server, "b@example.com", {"peer_walk_started": lambda d: started.append(d)})
    await asyncio.sleep(0.2)
    await a.emit("walk_started", {"movementId": "w1", "origin": RECEPTION_PUBLIC, "path": [RECEPTION_PUBLIC, OFFICE], "roomId": None, "durationMs": 400})
    await asyncio.sleep(0.4)
    assert [s["movementId"] for s in started] == []
    assert rejected and rejected[0] == {"movementId": "w1", "reason": "office-access"}
    # walking about Reception is untouched
    await a.emit("walk_started", {"movementId": "w2", "origin": RECEPTION_PUBLIC, "path": [{"x": 600.0, "y": 980.0}], "roomId": None, "durationMs": 100})
    assert await _wait(lambda: [s["movementId"] for s in started] == ["w2"])
    # an ARRIVAL in the office for a movement that began in Reception is refused too
    await a.emit("walk_arrived", {"movementId": "w2", "at": OFFICE, "facing": "front", "state": "standing", "seatKey": None, "roomId": None})
    assert await _wait(lambda: len(rejected) == 2)
    # checked in: the same walk is relayed
    async with async_session_maker() as session:
        await attendance_repo.check_in(session, "intruder@example.com")
    await a.emit("walk_started", {"movementId": "w3", "origin": RECEPTION_PUBLIC, "path": [RECEPTION_PUBLIC, OFFICE], "roomId": None, "durationMs": 400})
    assert await _wait(lambda: "w3" in [s["movementId"] for s in started])
    await a.disconnect()
    await b.disconnect()
