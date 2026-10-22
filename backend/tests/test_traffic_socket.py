"""S4 — traffic holds over the socket: a rider in a car's lane stops it for everybody; a report the server cannot
confirm changes nothing; late joiners get the stopped car; clear and disconnect let it go."""
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

A, B = "driver-a@example.com", "driver-b@example.com"


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    socket_module.scooters.reset()
    socket_module.traffic_holds.reset()
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
    socket_module.traffic_holds.reset()
    settings.APP_ENV = original_env


class Peer:
    def __init__(self, email: str) -> None:
        self.email = email
        self.client = socketio.AsyncClient()
        self.events: list[tuple[str, dict]] = []
        for name in ("traffic_holds", "scooter_state", "scooters"):
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

    def held(self) -> dict | None:
        snap = self.last("traffic_holds") or {"vehicles": []}
        return next((v for v in snap["vehicles"] if v["loop"] == "A" and v["vehicle"] == 2), None)

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


def _lane_point(along: float) -> tuple[float, float]:
    path = tm.PATHS[0]
    half = tm.VEHICLE_LENGTH[path.loop["kinds"][2]] / 2
    x, z, _, _ = tm.point_at_arc(path, socket_module.traffic_holds.car_arc("A", 2, time.time()) + half + along)
    return x, z


async def test_a_rider_in_the_lane_stops_the_car_for_everybody_and_lets_it_go(server) -> None:
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    try:
        assert await _wait(lambda: b.last("traffic_holds") is not None)
        assert b.last("traffic_holds")["vehicles"] == []
        await a.client.emit("scooter_claim", {"scooterId": "scooter-r1", "requestId": "q"})
        assert await _wait(lambda: any(n == "scooter_state" for n, _ in b.events))
        x, z = _lane_point(320)
        await a.client.emit("scooter_pose", {"scooterId": "scooter-r1", "seq": 1, "t": 1, "x": x, "z": z, "y": 0, "heading": 0, "speed": 0, "lean": 0, "pitch": 0})
        await asyncio.sleep(0.1)

        # B, who is nowhere near, claims to be in front of the car: the server cannot confirm it
        await b.client.emit("traffic_obstacle", {"loop": "A", "vehicle": 2, "x": x, "z": z, "kind": "walk"})
        await asyncio.sleep(0.2)
        assert b.held() is None

        await a.client.emit("traffic_obstacle", {"loop": "A", "vehicle": 2, "x": x, "z": z, "kind": "ride"})
        assert await _wait(lambda: b.held() is not None and b.held()["hold"] is not None)
        hold = b.held()["hold"]
        assert hold["releaseAt"] is None and set(hold) == {"id", "stopP", "b", "releaseAt", "emergency", "accident"}

        # somebody arriving now draws the same stopped car
        c = Peer("late@example.com")
        await c.connect(server)
        assert await _wait(lambda: c.held() is not None)
        assert c.held()["hold"]["id"] == hold["id"]
        await c.client.disconnect()

        await a.client.emit("traffic_obstacle", {"loop": "A", "vehicle": 2, "x": x, "z": z, "kind": "ride", "clear": True})
        assert await _wait(lambda: (b.held() or {}).get("hold", {}).get("releaseAt") is not None)
    finally:
        for p in (a, b):
            if p.client.connected:
                await p.client.disconnect()


async def test_a_rider_who_disconnects_in_the_road_does_not_leave_the_car_stuck(server) -> None:
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    try:
        await a.client.emit("scooter_claim", {"scooterId": "scooter-r2", "requestId": "q"})
        assert await _wait(lambda: any(n == "scooter_state" for n, _ in b.events))
        x, z = _lane_point(300)
        await a.client.emit("scooter_pose", {"scooterId": "scooter-r2", "seq": 1, "t": 1, "x": x, "z": z, "y": 0, "heading": 0, "speed": 0, "lean": 0, "pitch": 0})
        await asyncio.sleep(0.1)
        await a.client.emit("traffic_obstacle", {"loop": "A", "vehicle": 2, "x": x, "z": z, "kind": "ride"})
        assert await _wait(lambda: b.held() is not None and b.held()["hold"] is not None)
        await a.client.disconnect()
        assert await _wait(lambda: (b.held() or {}).get("hold", {}).get("releaseAt") is not None)
        assert not math.isnan(b.held()["hold"]["releaseAt"])
    finally:
        for p in (a, b):
            if p.client.connected:
                await p.client.disconnect()


async def test_a_walker_is_believed_where_their_campus_walk_says_and_not_where_the_server_last_had_them(server) -> None:
    """THE PEDESTRIAN REGRESSION (2026-10-21): after a scooter ride the browser published nothing out on the campus,
    the server still had the walker at their desk, and every 'I am in this car's lane' was refused. A campus walk
    (the leg the feed now publishes on stepping off) is what makes the server believe them."""
    a, b = Peer(A), Peer(B)
    await a.connect(server)
    await b.connect(server)
    results: list[dict] = []
    a.client.on("traffic_obstacle_result", lambda d: results.append(d))
    try:
        assert await _wait(lambda: b.last("traffic_holds") is not None)
        x, z = _lane_point(320)
        # before any campus walk: the server cannot place them in the lane — refused, the car keeps going
        await a.client.emit("traffic_obstacle", {"loop": "A", "vehicle": 2, "x": x, "z": z, "kind": "walk"})
        assert await _wait(lambda: any(r.get("reason") == "body_unconfirmed" for r in results))
        assert b.held() is None
        # stepping off onto the campus, as the browser publishes it: anchored in V1's frame, standing at (x, z)
        await a.client.emit("walk_started", {"movementId": "m-campus", "origin": {"x": 1146, "y": 1190}, "path": [{"x": 1146, "y": 1190}],
                                             "roomId": "campus", "durationMs": 100, "localOrigin": {"x": x - 30, "y": z}, "localPath": [{"x": x, "y": z}]})
        await asyncio.sleep(0.2)
        results.clear()
        await a.client.emit("traffic_obstacle", {"loop": "A", "vehicle": 2, "x": x, "z": z, "kind": "walk"})
        assert await _wait(lambda: b.held() is not None and b.held()["hold"] is not None)
        assert not any(r.get("reason") == "body_unconfirmed" for r in results)
        # …and it goes again once they are out of the lane
        await a.client.emit("traffic_obstacle", {"loop": "A", "vehicle": 2, "x": x, "z": z, "kind": "walk", "clear": True})
        assert await _wait(lambda: (b.held() or {}).get("hold", {}).get("releaseAt") is not None)
    finally:
        for p in (a, b):
            if p.client.connected:
                await p.client.disconnect()
