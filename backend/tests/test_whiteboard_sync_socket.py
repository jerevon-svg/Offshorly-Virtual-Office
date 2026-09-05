from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.realtime.state import whiteboard_rooms
from app.repositories import chat as chat_repo
from app.repositories import whiteboards as wb_repo

# Whiteboard W3 over a real server + real socket.io clients: participant-only join, snapshot on
# join, element relay to the room minus sender, ack, losing elements handed back, late-joiner
# snapshot with tombstones, presence, and the debounced + final DB writes.

pytestmark = pytest.mark.asyncio

A, B, C = "a@example.com", "b@example.com", "c@example.com"


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    whiteboard_rooms.reset()
    whiteboard_rooms.flush_delay_seconds = 0.05

    async with engine.begin() as conn:
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
    whiteboard_rooms.reset()
    whiteboard_rooms.flush_delay_seconds = 1.0
    settings.APP_ENV = original_env


async def _board() -> str:
    async with async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, A, B)
        board = await wb_repo.create(session, conversation_id=conv["id"], title="W3", creator_email=A)
        return board["id"]


async def _stored(board_id: str) -> dict:
    async with async_session_maker() as session:
        return await wb_repo.get_by_id(session, board_id)


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


def _waiter(client: socketio.AsyncClient, event: str, predicate=None) -> asyncio.Future:
    """Future for the next `event` payload (optionally the next one satisfying `predicate`)."""
    fut: asyncio.Future = asyncio.get_event_loop().create_future()

    @client.on(event)
    async def _on(data):
        if not fut.done() and (predicate is None or predicate(data)):
            fut.set_result(data)

    return fut


def el(id_: str, version: int, nonce: int, **extra):
    return {"id": id_, "type": "rectangle", "version": version, "versionNonce": nonce, **extra}


async def test_non_participant_cannot_join(server):
    board_id = await _board()
    c = await _connect_as(server, C)
    err = _waiter(c, "whiteboard_error")
    await c.emit("whiteboard_join", {"boardId": board_id})
    data = await asyncio.wait_for(err, timeout=2)
    assert data["code"] == "forbidden"
    assert whiteboard_rooms.get(board_id) is None
    await c.disconnect()


async def test_join_snapshot_relay_ack_and_presence(server):
    board_id = await _board()
    a = await _connect_as(server, A)
    b = await _connect_as(server, B)

    snap_a = _waiter(a, "whiteboard_snapshot")
    await a.emit("whiteboard_join", {"boardId": board_id})
    snapshot = await asyncio.wait_for(snap_a, timeout=2)
    assert snapshot["boardId"] == board_id and snapshot["elements"] == [] and snapshot["version"] == 1
    assert [c["email"] for c in snapshot["collaborators"]] == [A]

    presence_b = _waiter(b, "whiteboard_presence")
    snap_b = _waiter(b, "whiteboard_snapshot")
    await b.emit("whiteboard_join", {"boardId": board_id})
    await asyncio.wait_for(snap_b, timeout=2)
    presence = await asyncio.wait_for(presence_b, timeout=2)
    assert sorted(c["email"] for c in presence["collaborators"]) == [A, B]
    assert all("color" in c and "sid" in c for c in presence["collaborators"])

    relayed_b = _waiter(b, "whiteboard_elements")
    ack_a = _waiter(a, "whiteboard_ack")
    a_got_own = False

    @a.on("whiteboard_elements")
    async def _own(_data):
        nonlocal a_got_own
        a_got_own = True

    await a.emit("whiteboard_elements", {"boardId": board_id, "elements": [el("r1", 1, 5)], "clientSeq": 7})
    relayed = await asyncio.wait_for(relayed_b, timeout=2)
    ack = await asyncio.wait_for(ack_a, timeout=2)
    assert [e["id"] for e in relayed["elements"]] == ["r1"] and relayed["seq"] == 1
    assert ack["clientSeq"] == 7 and ack["seq"] == 1
    assert a_got_own is False

    # B's stale copy loses; B gets the room's winner back and nothing is broadcast to A.
    back_to_b = _waiter(b, "whiteboard_elements")
    await b.emit("whiteboard_elements", {"boardId": board_id, "elements": [el("r1", 0, 1)], "clientSeq": 1})
    back = await asyncio.wait_for(back_to_b, timeout=2)
    assert back["elements"][0]["version"] == 1 and back["elements"][0]["versionNonce"] == 5
    await asyncio.sleep(0.1)
    assert a_got_own is False

    await a.disconnect()
    await b.disconnect()


async def test_tombstones_survive_for_late_joiner_and_final_write_strips_them(server):
    board_id = await _board()
    a = await _connect_as(server, A)
    snap_a = _waiter(a, "whiteboard_snapshot")
    await a.emit("whiteboard_join", {"boardId": board_id})
    await asyncio.wait_for(snap_a, timeout=2)

    ack = _waiter(a, "whiteboard_ack")
    await a.emit(
        "whiteboard_elements",
        {"boardId": board_id, "elements": [el("keep", 1, 1), el("gone", 2, 2, isDeleted=True)], "clientSeq": 1},
    )
    await asyncio.wait_for(ack, timeout=2)

    # Debounced write lands with the tombstone still present and the version bumped.
    await asyncio.sleep(0.3)
    stored = await _stored(board_id)
    assert stored["version"] == 2
    assert sorted(e["id"] for e in stored["document"]["elements"]) == ["gone", "keep"]
    assert stored["updated_by_email"] == A

    # A late joiner's snapshot carries the tombstone so its stale copy cannot resurrect it.
    b = await _connect_as(server, B)
    snap_b = _waiter(b, "whiteboard_snapshot")
    await b.emit("whiteboard_join", {"boardId": board_id})
    snapshot = await asyncio.wait_for(snap_b, timeout=2)
    assert {e["id"]: e.get("isDeleted", False) for e in snapshot["elements"]} == {"keep": False, "gone": True}
    assert snapshot["version"] == 2 and snapshot["seq"] == 1

    # Last member leaving closes the room: final write strips tombstones, room is dropped.
    await a.disconnect()
    await b.emit("whiteboard_leave", {"boardId": board_id})
    await asyncio.sleep(0.2)
    stored = await _stored(board_id)
    assert stored["version"] == 3
    assert [e["id"] for e in stored["document"]["elements"]] == ["keep"]
    assert whiteboard_rooms.get(board_id) is None

    # REST save from a client that loaded version 1 is now correctly stale.
    async with async_session_maker() as session:
        assert await wb_repo.save_document(
            session, board_id=board_id, document={"type": "excalidraw"}, expected_version=1, editor_email=A
        ) is None
    await b.disconnect()


async def test_elements_before_join_are_rejected_and_disconnect_clears_presence(server):
    board_id = await _board()
    a = await _connect_as(server, A)
    err = _waiter(a, "whiteboard_error")
    await a.emit("whiteboard_elements", {"boardId": board_id, "elements": [el("x", 1, 1)], "clientSeq": 1})
    assert (await asyncio.wait_for(err, timeout=2))["code"] == "not_joined"

    b = await _connect_as(server, B)
    snap_a = _waiter(a, "whiteboard_snapshot")
    await a.emit("whiteboard_join", {"boardId": board_id})
    await asyncio.wait_for(snap_a, timeout=2)
    snap_b = _waiter(b, "whiteboard_snapshot")
    await b.emit("whiteboard_join", {"boardId": board_id})
    await asyncio.wait_for(snap_b, timeout=2)

    # B's own join-presence ([A, B]) may still be in flight; wait for the one A's disconnect causes.
    presence_b = _waiter(b, "whiteboard_presence", lambda d: len(d["collaborators"]) == 1)
    await a.disconnect()
    presence = await asyncio.wait_for(presence_b, timeout=2)
    assert [c["email"] for c in presence["collaborators"]] == [B]
    await b.disconnect()
