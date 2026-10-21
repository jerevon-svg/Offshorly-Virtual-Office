"""CAMPUS SCOOTERS over the socket: the snapshot on connect, one grant per scooter, the broadcast, the
disconnect grace and the reclaim after a refresh."""
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

A, B = "rider-a@example.com", "rider-b@example.com"


@pytest.fixture
async def server(monkeypatch):
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    monkeypatch.setattr(socket_module, "SCOOTER_RECONNECT_GRACE_SECONDS", 0.3)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    socket_module.scooters.reset()
    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    await task
    socket_module.scooters.reset()
    settings.APP_ENV = original_env


class Peer:
    def __init__(self, email: str) -> None:
        self.email = email
        self.client = socketio.AsyncClient()
        self.events: list[tuple[str, dict]] = []
        for name in ("scooters", "scooter_state", "scooter_claim_result", "scooter_release_result", "scooter_pose"):
            self.client.on(name, self._rec(name))

    def _rec(self, name: str):
        async def rec(data):
            self.events.append((name, data))
        return rec

    def last(self, name: str) -> dict | None:
        for n, d in reversed(self.events):
            if n == name:
                return d
        return None

    def states(self, scooter_id: str) -> list[str]:
        return [d["scooter"]["state"] for n, d in self.events if n == "scooter_state" and d["scooter"]["id"] == scooter_id]

    async def connect(self, url: str) -> Peer:
        await asyncio.wait_for(
            self.client.connect(url, auth={"x-dev-email": self.email}, socketio_path="socket.io", transports=["websocket"]),
            timeout=5,
        )
        return self


async def _wait(pred, timeout=3.0) -> bool:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


async def test_snapshot_grant_refusal_broadcast_and_release(server) -> None:
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    try:
        assert await _wait(lambda: a.last("scooters") is not None and b.last("scooters") is not None)
        snap = a.last("scooters")
        assert len(snap["scooters"]) == 6 and all(s["state"] == "docked" for s in snap["scooters"])
        assert isinstance(snap["serverTime"], int)

        await a.client.emit("scooter_claim", {"scooterId": "scooter-r1", "requestId": "q1"})
        assert await _wait(lambda: a.last("scooter_claim_result") is not None)
        res = a.last("scooter_claim_result")
        assert res["ok"] is True and res["requestId"] == "q1" and res["scooter"]["rider"] == A
        # EVERYBODY learns it is gone from the rack
        assert await _wait(lambda: b.states("scooter-r1") == ["ridden"])

        # the same scooter, asked for second: refused, with the truth attached
        await b.client.emit("scooter_claim", {"scooterId": "scooter-r1", "requestId": "q2"})
        assert await _wait(lambda: b.last("scooter_claim_result") is not None)
        refused = b.last("scooter_claim_result")
        assert refused["ok"] is False and refused["reason"] == "taken" and refused["scooter"]["rider"] == A

        # only the rider gets off it
        await b.client.emit("scooter_release", {"scooterId": "scooter-r1"})
        assert await _wait(lambda: b.last("scooter_release_result") is not None)
        assert b.last("scooter_release_result")["reason"] == "not_rider"
        await a.client.emit("scooter_release", {"scooterId": "scooter-r1"})
        assert await _wait(lambda: b.states("scooter-r1") == ["ridden", "docked"])

        # junk is ignored, never granted
        await a.client.emit("scooter_claim", {"scooterId": 7})
        await a.client.emit("scooter_release", {"scooterId": "scooter-r2", "at": {"x": "bad"}})
        await asyncio.sleep(0.2)
        assert socket_module.scooters.get("scooter-r2")["state"] == "docked"
    finally:
        await a.client.disconnect()
        await b.client.disconnect()


async def test_disconnect_grace_then_home_and_reclaim_after_refresh(server) -> None:
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    try:
        await a.client.emit("scooter_claim", {"scooterId": "scooter-l1", "requestId": "q1"})
        assert await _wait(lambda: b.states("scooter-l1") == ["ridden"])
        await a.client.disconnect()
        # within the grace it is still A's — B cannot take it
        await b.client.emit("scooter_claim", {"scooterId": "scooter-l1", "requestId": "q2"})
        assert await _wait(lambda: b.last("scooter_claim_result") is not None)
        assert b.last("scooter_claim_result")["reason"] == "taken"
        # after the grace it goes home, and everybody sees it back in the rack
        assert await _wait(lambda: b.states("scooter-l1") == ["ridden", "docked"], timeout=3)

        # a refresh WITHIN the grace keeps the ride: the same rider, a new socket
        await b.client.emit("scooter_claim", {"scooterId": "scooter-l2", "requestId": "q3"})
        assert await _wait(lambda: b.states("scooter-l2") == ["ridden"])
        await b.client.disconnect()
        b2 = Peer(B)
        await b2.connect(server)
        assert await _wait(lambda: b2.last("scooters") is not None)
        assert next(s for s in b2.last("scooters")["scooters"] if s["id"] == "scooter-l2")["rider"] == B
        await b2.client.emit("scooter_claim", {"scooterId": "scooter-l2", "requestId": "q4"})
        assert await _wait(lambda: (b2.last("scooter_claim_result") or {}).get("ok") is True)
        await asyncio.sleep(0.5)  # past the old socket's grace: the reclaim must hold
        assert socket_module.scooters.get("scooter-l2")["rider"] == B
        await b2.client.disconnect()
    finally:
        if a.client.connected:
            await a.client.disconnect()
        if b.client.connected:
            await b.client.disconnect()


def _pose(seq: int, x: float = 1200.0, scooter: str = "scooter-r1") -> dict:
    return {"scooterId": scooter, "seq": seq, "t": 1_800_000_000_000 + seq * 100, "x": x, "z": 1330.0, "y": 0.0,
            "heading": 1.0, "speed": 140.0, "lean": 0.05, "pitch": 0.0}


async def test_pose_stream_is_relayed_from_the_rider_only_in_order_and_seen_by_late_joiners(server) -> None:
    a, b, c = Peer(A), Peer(B), Peer("rider-c@example.com")
    for p in (a, b, c):
        await p.connect(server)
    try:
        await a.client.emit("scooter_claim", {"scooterId": "scooter-r1", "requestId": "q1"})
        assert await _wait(lambda: b.states("scooter-r1") == ["ridden"])
        await a.client.emit("scooter_pose", _pose(1, x=1201))
        assert await _wait(lambda: b.last("scooter_pose") is not None and c.last("scooter_pose") is not None)
        got = b.last("scooter_pose")
        assert got["rider"] == A and got["seq"] == 1 and got["x"] == 1201 and isinstance(got["serverTime"], int)
        assert a.last("scooter_pose") is None  # never echoed to the rider

        # a spoof (B streaming A's scooter, even naming A as rider) and a stale sample go nowhere
        await b.client.emit("scooter_pose", {**_pose(9, x=-5), "rider": A})
        await asyncio.sleep(0.1)
        await a.client.emit("scooter_pose", _pose(1, x=999))
        await asyncio.sleep(0.15)
        await a.client.emit("scooter_pose", _pose(2, x=1210))
        assert await _wait(lambda: (c.last("scooter_pose") or {}).get("seq") == 2)
        assert [d["x"] for n, d in c.events if n == "scooter_pose"] == [1201, 1210]

        # somebody arriving mid-ride gets the rider's last pose with the snapshot
        d = Peer("late@example.com")
        await d.connect(server)
        assert await _wait(lambda: d.last("scooters") is not None)
        r1 = next(s for s in d.last("scooters")["scooters"] if s["id"] == "scooter-r1")
        assert r1["state"] == "ridden" and r1["rider"] == A and r1["pose"]["x"] == 1210
        assert r1["pose"]["seq"] == 2 and r1["pose"]["t"] == _pose(2)["t"]  # timed like a live sample
        await d.client.disconnect()

        # off the scooter: no pose any more, and streaming it is refused
        await a.client.emit("scooter_release", {"scooterId": "scooter-r1"})
        assert await _wait(lambda: b.states("scooter-r1") == ["ridden", "docked"])
        assert next(s for n, dd in b.events if n == "scooter_state" for s in [dd["scooter"]] if s["state"] == "docked")["pose"] is None
        await asyncio.sleep(0.1)
        await a.client.emit("scooter_pose", _pose(3))
        await asyncio.sleep(0.2)
        assert (b.last("scooter_pose") or {}).get("seq") == 2
    finally:
        for p in (a, b, c):
            if p.client.connected:
                await p.client.disconnect()
