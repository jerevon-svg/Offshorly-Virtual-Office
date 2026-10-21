"""S5 over the socket: a rider's real crash becomes ONE accident everybody receives — the scooter fallen, the car
held — a late joiner gets it, a duplicate is refused, and it ends on its own (or when the rider leaves)."""
from __future__ import annotations

import asyncio
import math
import time

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module
from app.services import traffic_model as tm

pytestmark = pytest.mark.asyncio

A, B = "crash-a@example.com", "crash-b@example.com"
EVENTS = ("scooters", "scooter_state", "scooter_accident", "scooter_accident_result", "scooter_accident_resolved", "scooter_accidents", "traffic_holds", "scooter_accident_lift_result", "scooter_claim_result")


@pytest.fixture
async def server(monkeypatch):
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    monkeypatch.setattr(socket_module, "ACCIDENT_WATCH_S", 0.1)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    for reg in (socket_module.scooters, socket_module.traffic_holds, socket_module.scooter_accidents):
        reg.reset()
    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    await task
    for reg in (socket_module.scooters, socket_module.traffic_holds, socket_module.scooter_accidents):
        reg.reset()
    settings.APP_ENV = original_env


class Peer:
    def __init__(self, email: str) -> None:
        self.email = email
        self.client = socketio.AsyncClient()
        self.events: list[tuple[str, dict]] = []
        for name in EVENTS:
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

    def scooter(self, sid: str) -> dict | None:
        for n, d in reversed(self.events):
            if n == "scooter_state" and d["scooter"]["id"] == sid:
                return d["scooter"]
        return None

    def car_hold(self) -> dict | None:
        snap = self.last("traffic_holds") or {"vehicles": []}
        v = next((v for v in snap["vehicles"] if v["loop"] == "A" and v["vehicle"] == 2), None)
        return v["hold"] if v else None

    async def connect(self, url: str) -> Peer:
        await asyncio.wait_for(self.client.connect(url, auth={"x-dev-email": self.email}, socketio_path="socket.io", transports=["websocket"]), timeout=5)
        return self


async def _wait(pred, timeout=3.0) -> bool:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


def _head_on(speed: float = 220.0) -> dict:
    t = time.time()
    cx, cz, ch, _ = tm.car_state("A", 2, socket_module.traffic_holds.car_state("A", 2), t)
    f = tm.VEHICLE_LENGTH["sport"] / 2 + 8
    return {"scooterId": "scooter-r1", "loop": "A", "vehicle": 2, "x": cx + math.cos(ch) * f, "z": cz + math.sin(ch) * f,
            "heading": math.atan2(-math.cos(ch), math.sin(ch)), "speed": speed, "t": t, "closing": 0.0, "requestId": "q1"}


async def _ride_into_car(a: Peer, b: Peer) -> dict:
    await a.client.emit("scooter_claim", {"scooterId": "scooter-r1", "requestId": "c"})
    assert await _wait(lambda: (b.scooter("scooter-r1") or {}).get("state") == "ridden")
    r = _head_on()
    await a.client.emit("scooter_pose", {"scooterId": "scooter-r1", "seq": 1, "t": 1, "x": r["x"], "z": r["z"], "y": 0, "heading": r["heading"], "speed": r["speed"], "lean": 0, "pitch": 0})
    await asyncio.sleep(0.1)
    r = {**_head_on(), "requestId": "q1"}
    await a.client.emit("scooter_accident", r)
    return r


async def test_a_real_crash_is_one_accident_for_everybody_and_ends_on_its_own(server) -> None:
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    try:
        assert await _wait(lambda: b.last("scooter_accidents") is not None)
        assert b.last("scooter_accidents")["accidents"] == []
        await _ride_into_car(a, b)
        assert await _wait(lambda: (a.last("scooter_accident_result") or {}).get("ok") is True)
        assert await _wait(lambda: b.last("scooter_accident") is not None)
        acc = b.last("scooter_accident")["accident"]
        assert acc["rider"] == A and acc["loop"] == "A" and acc["vehicle"] == 2 and acc["closing"] > 110
        # everybody: the scooter has fallen where it happened, the car is held FOR the accident
        assert await _wait(lambda: (b.scooter("scooter-r1") or {}).get("state") == "fallen")
        assert b.scooter("scooter-r1")["accident"] == acc["id"] and b.scooter("scooter-r1")["rider"] == A
        assert await _wait(lambda: (b.car_hold() or {}).get("accident") == acc["id"])
        # S6 — the rider's world shortens the slide: everybody gets the accident again, the scooter resting nearer
        await a.client.emit("scooter_accident_reach", {"id": acc["id"], "reach": {"rider": {"k": 1.0, "turn": 0.0}, "scooter": {"k": 0.5, "turn": 0.0}}})
        assert await _wait(lambda: (b.last("scooter_accident") or {}).get("accident", {}).get("reach") is not None)
        short = b.last("scooter_accident")["accident"]
        assert math.isclose(short["restX"] - short["x"], (acc["restX"] - acc["x"]) * 0.5, abs_tol=1e-6)
        assert await _wait(lambda: math.isclose((b.scooter("scooter-r1") or {}).get("at", {}).get("x", 0), short["restX"], abs_tol=1e-6))
        # …once: a second reach is ignored
        await a.client.emit("scooter_accident_reach", {"id": acc["id"], "reach": {"rider": {"k": 1.0, "turn": 0.0}, "scooter": {"k": 0.1, "turn": 0.0}}})
        # a second report of the same crash: refused
        await a.client.emit("scooter_accident", {**_head_on(), "requestId": "q2"})
        assert await _wait(lambda: (a.last("scooter_accident_result") or {}).get("requestId") == "q2")
        assert a.last("scooter_accident_result")["ok"] is False
        # somebody arriving now is told about it
        c = Peer("late@example.com")
        await c.connect(server)
        assert await _wait(lambda: c.last("scooter_accidents") is not None)
        assert [x["id"] for x in c.last("scooter_accidents")["accidents"]] == [acc["id"]]
        assert next(s for s in c.last("scooters")["scooters"] if s["id"] == "scooter-r1")["state"] == "fallen"
        await c.client.disconnect()
        # S7: nobody moves on it for the (here shortened) abandon time: it ends on its own — the scooter goes home,
        # the car is no longer held for it
        socket_module.scooter_accidents.get(acc["id"])["endsAt"] = time.time() + 0.3
        assert await _wait(lambda: (b.last("scooter_accident_resolved") or {}).get("id") == acc["id"], timeout=3)
        assert b.last("scooter_accident_resolved")["reason"] == "abandoned"
        assert await _wait(lambda: (b.scooter("scooter-r1") or {}).get("state") == "docked")
        assert await _wait(lambda: (b.car_hold() or {}).get("accident") is None)
    finally:
        for p in (a, b):
            if p.client.connected:
                await p.client.disconnect()


async def test_a_pedestrian_cannot_report_one_and_a_rider_who_leaves_ends_theirs(server) -> None:
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    try:
        # B is on foot: no scooter, no accident
        await b.client.emit("scooter_accident", {**_head_on(), "scooterId": "scooter-r3", "requestId": "walk"})
        assert await _wait(lambda: (b.last("scooter_accident_result") or {}).get("requestId") == "walk")
        assert b.last("scooter_accident_result") == {"requestId": "walk", "ok": False, "reason": "not_rider"}
        await _ride_into_car(a, b)
        assert await _wait(lambda: b.last("scooter_accident") is not None)
        acc = b.last("scooter_accident")["accident"]
        await a.client.disconnect()
        assert await _wait(lambda: (b.last("scooter_accident_resolved") or {}).get("id") == acc["id"])
        assert b.last("scooter_accident_resolved")["reason"] == "rider_left"
        assert await _wait(lambda: (b.scooter("scooter-r1") or {}).get("state") == "docked")
    finally:
        for p in (a, b):
            if p.client.connected:
                await p.client.disconnect()


async def _walk_to(p: Peer, x: float, z: float) -> None:
    """stand on the campus at (x, z), as the browser publishes it (app/selfMovement: anchored in V1's frame)"""
    await p.client.emit("walk_started", {"movementId": f"m-{x:.0f}-{z:.0f}", "origin": {"x": 1146, "y": 1190}, "path": [{"x": 1146, "y": 1190}],
                                         "roomId": "campus", "durationMs": 100, "localOrigin": {"x": x, "y": z}, "localPath": [{"x": x, "y": z}]})
    await asyncio.sleep(0.15)


async def test_s7_the_rider_lifts_it_and_rides_it_away_everybody_sees_it_and_the_car_waits_for_them(server) -> None:
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    try:
        await _ride_into_car(a, b)
        assert await _wait(lambda: b.last("scooter_accident") is not None)
        acc = b.last("scooter_accident")["accident"]
        assert acc["phase"] == "crashing" and acc["liftAt"] is None
        sx, sz = acc["restX"], acc["restZ"]
        await _walk_to(a, sx + 12, sz)
        # still crashing: refused
        await a.client.emit("scooter_accident_lift", {"id": acc["id"], "x": sx + 12, "z": sz, "requestId": "l0"})
        assert await _wait(lambda: (a.last("scooter_accident_lift_result") or {}).get("requestId") == "l0")
        assert a.last("scooter_accident_lift_result")["reason"] == "too_soon"
        # (the crash's playing time, shortened here)
        socket_module.scooter_accidents.get(acc["id"])["crashEnd"] = 0.0
        # somebody else cannot lift it
        await _walk_to(b, sx + 12, sz)
        await b.client.emit("scooter_accident_lift", {"id": acc["id"], "x": sx + 12, "z": sz, "requestId": "steal"})
        assert await _wait(lambda: (b.last("scooter_accident_lift_result") or {}).get("requestId") == "steal")
        assert b.last("scooter_accident_lift_result")["reason"] == "not_rider"
        # the rider: lifted, for everybody, with its time; E again is refused as the same lift
        await a.client.emit("scooter_accident_lift", {"id": acc["id"], "x": sx + 12, "z": sz, "requestId": "l1"})
        await a.client.emit("scooter_accident_lift", {"id": acc["id"], "x": sx + 12, "z": sz, "requestId": "l2"})
        assert await _wait(lambda: (b.last("scooter_accident") or {}).get("accident", {}).get("liftAt") is not None)
        lifted = b.last("scooter_accident")["accident"]
        assert lifted["liftFrom"] == {"x": sx + 12, "z": sz} and lifted["phase"] == "lifting"
        assert await _wait(lambda: (a.last("scooter_accident_lift_result") or {}).get("requestId") == "l2")
        assert a.last("scooter_accident_lift_result")["reason"] == "duplicate"
        # a late joiner gets it being lifted, with the same time
        c = Peer("late@example.com")
        await c.connect(server)
        assert await _wait(lambda: c.last("scooter_accidents") is not None)
        assert c.last("scooter_accidents")["accidents"][0]["liftAt"] == lifted["liftAt"]
        await c.client.disconnect()
        # riding it before it is up: refused; once up, from beside it: theirs, and the accident is over
        await a.client.emit("scooter_claim", {"scooterId": "scooter-r1", "requestId": "early", "x": sx + 12, "z": sz})
        assert await _wait(lambda: (a.last("scooter_claim_result") or {}).get("requestId") == "early")
        assert a.last("scooter_claim_result")["ok"] is False
        assert await _wait(lambda: (b.last("scooter_accident") or {}).get("accident", {}).get("phase") == "upright", timeout=4)
        await a.client.emit("scooter_claim", {"scooterId": "scooter-r1", "requestId": "ride", "x": sx + 12, "z": sz})
        assert await _wait(lambda: (a.last("scooter_claim_result") or {}).get("requestId") == "ride")
        assert a.last("scooter_claim_result")["ok"] is True
        assert await _wait(lambda: (b.last("scooter_accident_resolved") or {}).get("reason") == "recovered")
        assert await _wait(lambda: (b.scooter("scooter-r1") or {}).get("state") == "ridden")
        # the car is no longer held FOR the accident: back to the ordinary rule (it goes once nobody is in its way)
        assert await _wait(lambda: (b.car_hold() or {}).get("accident") is None)
    finally:
        for p in (a, b):
            if p.client.connected:
                await p.client.disconnect()
