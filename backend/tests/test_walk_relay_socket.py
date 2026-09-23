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
        "at": {"x": 5, "y": 5},
        "facing": "front",
        "state": "standing",
        "seatKey": None,
        "roomId": None,
    }
    payload.update(overrides)
    return payload


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

    payload = _walk_started_payload()
    await a.emit("walk_started", payload)

    b_payload = await asyncio.wait_for(b_future, timeout=2)
    assert b_payload["origin"] == payload["origin"]
    assert b_payload["path"] == payload["path"]
    assert b_payload["movementId"] == payload["movementId"]

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

    payload = _walk_started_payload(email="evil@example.com")
    await a.emit("walk_started", payload)

    b_payload = await asyncio.wait_for(b_future, timeout=2)
    assert b_payload["email"] == "a@example.com"

    await a.disconnect()
    await b.disconnect()


async def test_walk_arrived_rebroadcasts_to_others_not_sender(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    started_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_started")
    async def on_started(data):
        if not started_future.done():
            started_future.set_result(data)

    await a.emit("walk_started", _walk_started_payload())
    await asyncio.wait_for(started_future, timeout=2)

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

    payload = _walk_arrived_payload()
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

    started_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_started")
    async def on_started(data):
        if not started_future.done():
            started_future.set_result(data)

    await a.emit("walk_started", _walk_started_payload())
    await asyncio.wait_for(started_future, timeout=2)

    b_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_arrived")
    async def on_b(data):
        if not b_future.done():
            b_future.set_result(data)

    payload = _walk_arrived_payload(email="evil@example.com")
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
        _walk_started_payload(origin={"x": "0", "y": 0}),
        _walk_started_payload(path=[]),
        _walk_started_payload(path="not-a-list"),
        _walk_started_payload(path=[{"x": 1}]),
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

    valid_payload = _walk_started_payload()
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

    too_long_payload = _walk_started_payload(path=[{"x": i, "y": 0} for i in range(65)])
    await a.emit("walk_started", too_long_payload)
    await asyncio.sleep(0.2)
    assert not too_long_future.done()

    ok_future: asyncio.Future = asyncio.get_event_loop().create_future()

    @b.on("peer_walk_started")
    async def on_ok(data):
        if not ok_future.done():
            ok_future.set_result(data)

    ok_payload = _walk_started_payload(path=[{"x": i, "y": 0} for i in range(64)])
    await a.emit("walk_started", ok_payload)

    ok_result = await asyncio.wait_for(ok_future, timeout=2)
    assert len(ok_result["path"]) == 64

    await a.disconnect()
    await b.disconnect()


async def test_sitting_on_an_occupied_seat_is_accepted_standing_and_rejected_to_the_sender(server):
    """Phase 6C. A's seated arrival holds seat "881,258". B's arrival claiming the same seat is
    persisted and broadcast as STANDING (seatKey None) and B alone hears `seat_rejected`."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    loop = asyncio.get_event_loop()
    a_sat: asyncio.Future = loop.create_future()

    @b.on("peer_walk_arrived")
    async def on_b_arrived(data):
        if data["email"] == "a@example.com" and not a_sat.done():
            a_sat.set_result(data)

    await a.emit("walk_started", _walk_started_payload(movementId="a1"))
    await asyncio.sleep(0.1)
    await a.emit("walk_arrived", _walk_arrived_payload(movementId="a1", state="sitting", seatKey="881,258", roomId="executive-team"))
    a_payload = await asyncio.wait_for(a_sat, timeout=2)
    assert a_payload["state"] == "sitting"
    assert a_payload["seatKey"] == "881,258"

    b_rejected: asyncio.Future = loop.create_future()
    a_sees_b: asyncio.Future = loop.create_future()
    a_rejected: asyncio.Future = loop.create_future()

    @b.on("seat_rejected")
    async def on_b_rejected(data):
        if not b_rejected.done():
            b_rejected.set_result(data)

    @a.on("seat_rejected")
    async def on_a_rejected(data):
        if not a_rejected.done():
            a_rejected.set_result(data)

    @a.on("peer_walk_arrived")
    async def on_a_arrived(data):
        if data["email"] == "b@example.com" and not a_sees_b.done():
            a_sees_b.set_result(data)

    await b.emit("walk_started", _walk_started_payload(movementId="b1"))
    await asyncio.sleep(0.1)
    await b.emit("walk_arrived", _walk_arrived_payload(movementId="b1", state="sitting", seatKey="881,258", roomId="executive-team"))

    rejection = await asyncio.wait_for(b_rejected, timeout=2)
    assert rejection == {"movementId": "b1", "seatKey": "881,258", "heldBy": "a@example.com"}
    relayed = await asyncio.wait_for(a_sees_b, timeout=2)
    assert relayed["state"] == "standing"
    assert relayed["seatKey"] is None
    assert relayed["at"] == {"x": 5, "y": 5}  # the position is true; the pose is not granted

    await asyncio.sleep(0.2)
    assert not a_rejected.done()
    # the registry still holds A as the sitter, and B as standing
    assert socket_module.position_registry.seat_holder("881,258") == "a@example.com"
    assert socket_module.position_registry.get("b@example.com").stable.state == "standing"

    await a.disconnect()
    await b.disconnect()


async def test_re_sitting_in_your_own_seat_is_not_a_conflict(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    await asyncio.sleep(0.2)

    loop = asyncio.get_event_loop()
    seen: list = []
    done: asyncio.Future = loop.create_future()

    @b.on("peer_walk_arrived")
    async def on_b_arrived(data):
        seen.append(data)
        if len(seen) == 2 and not done.done():
            done.set_result(True)

    rejected: asyncio.Future = loop.create_future()

    @a.on("seat_rejected")
    async def on_a_rejected(data):
        if not rejected.done():
            rejected.set_result(data)

    for mid in ("a1", "a2"):
        await a.emit("walk_started", _walk_started_payload(movementId=mid))
        await asyncio.sleep(0.1)
        await a.emit("walk_arrived", _walk_arrived_payload(movementId=mid, state="sitting", seatKey="100,200", roomId="dev-team"))
        await asyncio.sleep(0.1)

    await asyncio.wait_for(done, timeout=2)
    assert [d["state"] for d in seen] == ["sitting", "sitting"]
    await asyncio.sleep(0.2)
    assert not rejected.done()

    await a.disconnect()
    await b.disconnect()
