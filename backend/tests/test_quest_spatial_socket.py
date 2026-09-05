from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn
from sqlalchemy import select

from app import database as app_db
from app.config import settings
from app.database import Base
from app.main import app as combined_app
from app.models.quest import QuestEvent, QuestProgress
from app.realtime import socket as socket_module
from app.services.quests import utc_day_key

# Quest Foundation over the real socket path: spatial_session_start records exactly one event per
# (person, session identity), so the reconnect re-assert, a duplicate emit, and leave/rejoin of
# the same session cannot farm progress. Same uvicorn rig as test_spatial_session_socket.py,
# pointed at the isolated throwaway DB.

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def server(isolated_app_db):
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    socket_module.spatial_sessions.reset()
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    await task
    socket_module.spatial_sessions.reset()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def _events() -> list[QuestEvent]:
    async with app_db.async_session_maker() as session:
        return list((await session.execute(select(QuestEvent))).scalars().all())


# The isolated rig shares ONE SQLite connection (StaticPool) between the server's handler session
# and this test's read session, so a read issued while the handler is mid-savepoint would end its
# transaction from underneath it — a rig artifact (production sessions each own a connection).
# Every read below therefore happens only after the handler has had time to settle.
SETTLE = 0.4


async def test_spatial_session_start_records_one_event_per_session_identity(server):
    a = await _connect_as(server, "a@example.com")
    await a.emit("spatial_session_start", {"sessionId": "s1"})
    await asyncio.sleep(SETTLE)
    await a.emit("spatial_session_start", {"sessionId": "s1"})  # duplicate emit
    await asyncio.sleep(SETTLE)
    events = await _events()
    assert [(e.actor_email, e.event_type, e.dedupe_key) for e in events] == [
        ("a@example.com", "spatial_session_joined", "a@example.com:s1")
    ]

    # Leave, drop the socket, reconnect and re-assert the SAME session — still one event.
    await a.emit("spatial_session_leave")
    await a.disconnect()
    a2 = await _connect_as(server, "a@example.com")
    await a2.emit("spatial_session_start", {"sessionId": "s1"})
    await asyncio.sleep(SETTLE)
    assert len(await _events()) == 1

    async with app_db.async_session_maker() as session:
        row = (
            await session.execute(
                select(QuestProgress).where(
                    QuestProgress.actor_email == "a@example.com",
                    QuestProgress.quest_id == "join_spatial_conversation",
                )
            )
        ).scalar_one()
    assert row.count == 1 and row.completed_at is not None
    await a2.disconnect()


async def test_approach_arrived_records_once_and_ignores_self_or_bogus_targets(server):
    a = await _connect_as(server, "a@example.com")
    # Self, non-email (mock avatar id) and malformed payloads must never record anything.
    await a.emit("approach_arrived", {"targetEmail": "A@example.com"})
    await a.emit("approach_arrived", {"targetEmail": "alex"})
    await a.emit("approach_arrived", {"targetEmail": 42})
    await a.emit("approach_arrived", None)
    await asyncio.sleep(SETTLE)
    assert await _events() == []

    await a.emit("approach_arrived", {"targetEmail": " B@example.com "})
    await asyncio.sleep(SETTLE)
    await a.emit("approach_arrived", {"targetEmail": "b@example.com"})  # same coworker again: collapses
    await asyncio.sleep(SETTLE)
    await a.emit("approach_arrived", {"targetEmail": "c@example.com"})  # a second coworker: new event
    await asyncio.sleep(SETTLE)
    events = await _events()
    # Keyed per actor+target+UTC day (Daily/Weekly Missions count distinct coworkers per period).
    day = utc_day_key()
    assert sorted((e.actor_email, e.event_type, e.dedupe_key, e.target_email) for e in events) == [
        ("a@example.com", "coworker_approached", f"a@example.com:b@example.com:{day}", "b@example.com"),
        ("a@example.com", "coworker_approached", f"a@example.com:c@example.com:{day}", "c@example.com"),
    ]

    async with app_db.async_session_maker() as session:
        row = (
            await session.execute(
                select(QuestProgress).where(
                    QuestProgress.actor_email == "a@example.com",
                    QuestProgress.quest_id == "approach_coworker",
                )
            )
        ).scalar_one()
    assert row.count == 1 and row.completed_at is not None
    await a.disconnect()
