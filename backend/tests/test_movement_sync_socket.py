from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module
from app.repositories import position as position_repo

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # Shared module-level singleton — clear it before/after each test so state from one test
    # never leaks into the next (same pattern as test_spatial_session_socket.py).
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


def _walk_started_payload(**overrides):
    payload = {
        "movementId": "m1",
        "origin": {"x": 0, "y": 0},
        "path": [{"x": 10, "y": 0}, {"x": 20, "y": 0}],
        "roomId": None,
        "durationMs": 500,
    }
    payload.update(overrides)
    return payload


def _walk_arrived_payload(**overrides):
    payload = {
        "movementId": "m1",
        "at": {"x": 20, "y": 0},
        "facing": "right",
        "state": "standing",
        "seatKey": None,
        "roomId": None,
    }
    payload.update(overrides)
    return payload


async def _wait_for_event(client: socketio.AsyncClient, event: str, timeout: float = 2, predicate=None):
    fut: asyncio.Future = asyncio.get_event_loop().create_future()

    @client.on(event)
    async def _handler(data, _fut=fut, _pred=predicate):
        if _fut.done():
            return
        if _pred is not None and not _pred(data):
            return
        _fut.set_result(data)

    return await asyncio.wait_for(fut, timeout=timeout)


async def test_walk_started_broadcast_carries_email_revision_started_at_and_excludes_sender(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    a_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @a.on("peer_walk_started")
    async def on_a(data):
        if not a_future.done():
            a_future.set_result(data)

    b_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload())

    b_payload = await b_task
    assert b_payload["email"] == "a@example.com"
    assert b_payload["movementId"] == "m1"
    assert b_payload["revision"] == 1
    assert isinstance(b_payload["startedAt"], int)
    assert b_payload["origin"] == {"x": 0, "y": 0}
    assert b_payload["path"] == [{"x": 10, "y": 0}, {"x": 20, "y": 0}]
    assert b_payload["durationMs"] == 500

    await asyncio.sleep(0.2)
    assert not a_future.done()  # sender excluded via skip_sid

    await a.disconnect()
    await b.disconnect()


async def test_arrival_accepted_and_broadcast_with_revision_greater_than_start(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload())
    started_payload = await started_task
    start_revision = started_payload["revision"]

    arrived_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_arrived"))
    await a.emit("walk_arrived", _walk_arrived_payload())
    arrived_payload = await arrived_task

    assert arrived_payload["email"] == "a@example.com"
    assert arrived_payload["movementId"] == "m1"
    assert arrived_payload["revision"] > start_revision
    assert arrived_payload["at"] == {"x": 20, "y": 0}
    assert arrived_payload["facing"] == "right"
    assert arrived_payload["state"] == "standing"
    assert arrived_payload["seatKey"] is None

    await a.disconnect()
    await b.disconnect()


async def test_stale_arrival_with_wrong_movement_id_is_not_broadcast(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    stale_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_arrived")
    async def on_stale(data):
        if not stale_future.done():
            stale_future.set_result(data)

    await a.emit("walk_arrived", _walk_arrived_payload(movementId="wrong-id"))
    await asyncio.sleep(0.2)
    assert not stale_future.done()

    await a.disconnect()
    await b.disconnect()


async def test_overlapping_starts_second_supersedes_and_first_arrival_rejected(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    first_started = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m1"))
    await first_started

    second_started = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m2", origin={"x": 5, "y": 5}))
    second_payload = await second_started
    assert second_payload["movementId"] == "m2"

    rejected_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_arrived")
    async def on_rejected(data):
        if not rejected_future.done():
            rejected_future.set_result(data)

    await a.emit("walk_arrived", _walk_arrived_payload(movementId="m1"))
    await asyncio.sleep(0.2)
    assert not rejected_future.done()

    accepted_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_arrived"))
    await a.emit("walk_arrived", _walk_arrived_payload(movementId="m2"))
    accepted = await accepted_task
    assert accepted["movementId"] == "m2"

    await a.disconnect()
    await b.disconnect()


async def test_late_join_sees_in_flight_active_movement_in_snapshot(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    c = socketio.AsyncClient()
    snapshot_task = asyncio.ensure_future(
        _wait_for_event(c, "positions_snapshot", predicate=lambda d: any(e["email"] == "a@example.com" for e in d["entries"]))
    )
    await asyncio.wait_for(
        c.connect(server, auth={"x-dev-email": "c@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    snapshot = await snapshot_task

    entry = next(e for e in snapshot["entries"] if e["email"] == "a@example.com")
    assert entry["active"] is not None
    assert entry["active"]["movementId"] == "m1"

    await a.disconnect()
    await b.disconnect()
    await c.disconnect()


async def test_late_join_after_arrival_sees_stable_pos_and_null_active(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    arrived_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_arrived"))
    await a.emit("walk_arrived", _walk_arrived_payload(movementId="m1"))
    await arrived_task

    c = socketio.AsyncClient()
    snapshot_task = asyncio.ensure_future(
        _wait_for_event(c, "positions_snapshot", predicate=lambda d: any(e["email"] == "a@example.com" for e in d["entries"]))
    )
    await asyncio.wait_for(
        c.connect(server, auth={"x-dev-email": "c@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    snapshot = await snapshot_task

    entry = next(e for e in snapshot["entries"] if e["email"] == "a@example.com")
    assert entry["active"] is None
    assert entry["pos"] == {"x": 20, "y": 0}

    await a.disconnect()
    await b.disconnect()
    await c.disconnect()


async def test_reconnect_mid_walk_receives_snapshot_with_active(server):
    # The mover's OWN reconnect snapshot must show its own entry with active=null (self never
    # fast-forwards/replays its own in-flight movement — see PositionRegistry.snapshot's
    # own_email param), while a THIRD observer connecting around the same time still sees the
    # mover's in-flight movement intact via peer visibility.
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(a, "peer_walk_started"))
    await b.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    await b.disconnect()
    await asyncio.sleep(0.2)

    b2 = socketio.AsyncClient()
    b2_snapshot_task = asyncio.ensure_future(
        _wait_for_event(b2, "positions_snapshot", predicate=lambda d: any(e["email"] == "b@example.com" for e in d["entries"]))
    )
    await asyncio.wait_for(
        b2.connect(server, auth={"x-dev-email": "b@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    b2_snapshot = await b2_snapshot_task
    own_entry = next(e for e in b2_snapshot["entries"] if e["email"] == "b@example.com")
    assert own_entry["active"] is None

    c = socketio.AsyncClient()
    snapshot_task = asyncio.ensure_future(
        _wait_for_event(c, "positions_snapshot", predicate=lambda d: any(e["email"] == "b@example.com" for e in d["entries"]))
    )
    await asyncio.wait_for(
        c.connect(server, auth={"x-dev-email": "c@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    snapshot = await snapshot_task

    entry = next(e for e in snapshot["entries"] if e["email"] == "b@example.com")
    assert entry["active"] is not None
    assert entry["active"]["movementId"] == "m1"

    await a.disconnect()
    await b2.disconnect()
    await c.disconnect()


async def test_sitting_arrival_reflected_in_snapshot(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    arrived_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_arrived"))
    await a.emit(
        "walk_arrived",
        _walk_arrived_payload(movementId="m1", state="sitting", seatKey="desk-1", roomId="design-team"),
    )
    arrived_payload = await arrived_task
    assert arrived_payload["state"] == "sitting"
    assert arrived_payload["seatKey"] == "desk-1"

    c = socketio.AsyncClient()
    snapshot_task = asyncio.ensure_future(
        _wait_for_event(c, "positions_snapshot", predicate=lambda d: any(e["email"] == "a@example.com" for e in d["entries"]))
    )
    await asyncio.wait_for(
        c.connect(server, auth={"x-dev-email": "c@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    snapshot = await snapshot_task
    entry = next(e for e in snapshot["entries"] if e["email"] == "a@example.com")
    assert entry["state"] == "sitting"
    assert entry["seatKey"] == "desk-1"
    assert entry["roomId"] == "design-team"

    await a.disconnect()
    await b.disconnect()
    await c.disconnect()


async def test_durable_reload_persists_stable_across_a_fresh_registry(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    arrived_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_arrived"))
    await a.emit("walk_arrived", _walk_arrived_payload(movementId="m1", state="standing"))
    await arrived_task

    # let the async DB write settle
    await asyncio.sleep(0.2)

    original_stable = socket_module.position_registry.get("a@example.com").stable

    from app.database import async_session_maker

    async with async_session_maker() as session:
        rows = await position_repo.list_all(session)

    from app.services.position_registry import PositionRegistry

    fresh_registry = PositionRegistry()
    fresh_registry.load_stable(rows)

    reloaded = fresh_registry.get("a@example.com")
    assert reloaded is not None
    assert reloaded.stable.x == original_stable.x
    assert reloaded.stable.y == original_stable.y
    assert reloaded.stable.state == original_stable.state
    assert reloaded.stable.revision == original_stable.revision

    await a.disconnect()
    await b.disconnect()


async def test_malformed_walk_started_payloads_are_dropped(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    malformed_payloads = [
        {},
        _walk_started_payload(movementId=""),
        _walk_started_payload(movementId=123),
        _walk_started_payload(origin={"x": "0", "y": 0}),
        _walk_started_payload(path=[]),
        _walk_started_payload(path=[{"x": i, "y": 0} for i in range(65)]),
        _walk_started_payload(durationMs=50),
        _walk_started_payload(durationMs=20001),
        _walk_started_payload(roomId=123),
    ]

    for bad_payload in malformed_payloads:
        got_future: asyncio.Future = asyncio.get_event_loop().create_future()

        @b.on("peer_walk_started")
        async def on_bad(data, _fut=got_future):
            if not _fut.done():
                _fut.set_result(data)

        await a.emit("walk_started", bad_payload)
        await asyncio.sleep(0.15)
        assert not got_future.done(), f"expected drop for {bad_payload!r}"

    await a.disconnect()
    await b.disconnect()


async def test_connect_snapshot_includes_peers_active_but_nulls_own_active(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(a, "peer_walk_started"))
    await b.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    # An observer (c) sees b's in-flight movement intact — peer visibility unaffected.
    c = socketio.AsyncClient()
    snapshot_task = asyncio.ensure_future(
        _wait_for_event(c, "positions_snapshot", predicate=lambda d: any(e["email"] == "b@example.com" for e in d["entries"]))
    )
    await asyncio.wait_for(
        c.connect(server, auth={"x-dev-email": "c@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    snapshot = await snapshot_task
    peer_entry = next(e for e in snapshot["entries"] if e["email"] == "b@example.com")
    assert peer_entry["active"] is not None
    assert peer_entry["active"]["movementId"] == "m1"

    # b reconnecting sees its OWN entry (stable restored) but with active forced to null.
    await b.disconnect()
    b2 = socketio.AsyncClient()
    b2_snapshot_task = asyncio.ensure_future(
        _wait_for_event(b2, "positions_snapshot", predicate=lambda d: any(e["email"] == "b@example.com" for e in d["entries"]))
    )
    await asyncio.wait_for(
        b2.connect(server, auth={"x-dev-email": "b@example.com"}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    b2_snapshot = await b2_snapshot_task
    own_entry = next(e for e in b2_snapshot["entries"] if e["email"] == "b@example.com")
    assert own_entry["active"] is None
    assert own_entry["pos"] == {"x": 0, "y": 0}  # stable (origin) still restored

    await a.disconnect()
    await b2.disconnect()
    await c.disconnect()


async def test_snapshot_active_is_null_after_arrive_no_replay():
    from app.services.position_registry import PositionRegistry

    registry = PositionRegistry()
    registry.start(
        "a@example.com",
        movement_id="m1",
        origin={"x": 0.0, "y": 0.0},
        path=[{"x": 10.0, "y": 0.0}],
        room_id=None,
        duration_ms=500,
        started_at=1000,
    )
    registry.arrive(
        "a@example.com",
        movement_id="m1",
        at={"x": 10.0, "y": 0.0},
        facing="right",
        state="standing",
        seat_key=None,
        room_id=None,
        now_ms=1500,
    )

    snapshot = registry.snapshot()
    entry = next(e for e in snapshot if e["email"] == "a@example.com")
    assert entry["active"] is None


async def test_dev_connect_rejects_malformed_dev_email(server):
    bad_emails = [
        "x@y.com?devicetier=t2",
        "x@y.com&foo=bar",
        "x@y.com with space",
    ]
    for bad_email in bad_emails:
        client = socketio.AsyncClient()
        with pytest.raises(socketio.exceptions.ConnectionError):
            await asyncio.wait_for(
                client.connect(
                    server, auth={"x-dev-email": bad_email}, socketio_path="socket.io", transports=["websocket"]
                ),
                timeout=5,
            )
        assert not client.connected

    good = await _connect_as(server, "clean@example.com")
    assert good.connected
    await good.disconnect()


async def test_malformed_walk_arrived_payloads_are_dropped(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_task = asyncio.ensure_future(_wait_for_event(b, "peer_walk_started"))
    await a.emit("walk_started", _walk_started_payload(movementId="m1"))
    await started_task

    malformed_payloads = [
        {},
        _walk_arrived_payload(movementId=""),
        _walk_arrived_payload(at={"x": "0", "y": 0}),
        _walk_arrived_payload(facing="sideways"),
        _walk_arrived_payload(state="flying"),
        _walk_arrived_payload(seatKey=123),
        _walk_arrived_payload(roomId=123),
    ]

    for bad_payload in malformed_payloads:
        got_future: asyncio.Future = asyncio.get_event_loop().create_future()

        @b.on("peer_walk_arrived")
        async def on_bad(data, _fut=got_future):
            if not _fut.done():
                _fut.set_result(data)

        await a.emit("walk_arrived", bad_payload)
        await asyncio.sleep(0.15)
        assert not got_future.done(), f"expected drop for {bad_payload!r}"

    await a.disconnect()
    await b.disconnect()
