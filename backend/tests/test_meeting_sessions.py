from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timedelta, timezone

import pytest
import socketio
import uvicorn
from sqlalchemy import delete, select

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.models.meeting_session import (
    MeetingSession,
    MeetingSessionAttendance,
    MeetingSessionGrant,
)
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.realtime import socket as socket_module
from app.repositories import meeting_sessions as repo
from app.schemas.scheduled_meetings import CreateScheduledMeetingIn
from app.services import meeting_access, meeting_sessions
from app.services import scheduled_meetings as scheduled_service

# PHASE 6A — Meeting Session + Access Foundation, end to end over the real socket handlers (the same
# live-uvicorn fixture as tests/test_scheduled_meeting_socket.py). What is proven here:
#   * every live occurrence gets its own durable id, even in the same room;
#   * scheduled (on time and started early) and instant meetings produce the same model;
#   * attendance is real join/leave intervals per person, never per tab;
#   * meeting_access authorizes organizer / invitees / invited / attendees and NOBODY because of a room;
#   * a private meeting's participants and host never reach somebody it does not authorize.

pytestmark = pytest.mark.asyncio

ORG = "org@example.com"
ALEX = "alex@example.com"
BON = "bon@example.com"
MICAH = "micah@example.com"
EVE = "eve@example.com"
FOXTROT = "mf-foxtrot"
FOXTROT_KEY = "meeting:mf-foxtrot"
CAVE = "cave-all-hands"


def _reset() -> None:
    socket_module.spatial_sessions.reset()
    socket_module.call_registry.reset()
    socket_module.meeting_hosts.reset()
    scheduled_service.reset_live()
    meeting_sessions.reset()


@pytest.fixture
async def server(monkeypatch):
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    monkeypatch.setattr(meeting_sessions, "RECONNECT_GRACE_S", 0.3)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for model in (MeetingSessionGrant, MeetingSessionAttendance, MeetingSession, ScheduledMeetingInvitee, ScheduledMeeting):
            await conn.execute(delete(model))
    _reset()

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]

    yield f"http://127.0.0.1:{port}"

    srv.should_exit = True
    await task
    _reset()
    settings.APP_ENV = original_env


async def _connect_as(url: str, email: str) -> socketio.AsyncClient:
    client = socketio.AsyncClient()
    await asyncio.wait_for(
        client.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return client


async def _wait(pred, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        result = pred()
        if inspect.isawaitable(result):
            result = await result
        if result:
            return True
        await asyncio.sleep(0.02)
    return False


def _watch(client) -> list:
    seen: list = []

    @client.on("meeting_presence")
    async def _on(data):
        seen.append(data["meetings"])

    return seen


async def _sessions(meeting_key: str = FOXTROT) -> list[MeetingSession]:
    async with async_session_maker() as db:
        rows = await db.execute(
            select(MeetingSession).where(MeetingSession.meeting_key == meeting_key).order_by(MeetingSession.started_at)
        )
        return list(rows.scalars())


async def _attendance(session_id: str, email: str) -> list[MeetingSessionAttendance]:
    async with async_session_maker() as db:
        return [a for a in await repo.attendance(db, session_id) if a.email == email]


async def _can_read(session_id: str, email: str) -> bool:
    async with async_session_maker() as db:
        return await meeting_access.can_read(db, session_id, email)


async def _book(*, room="floor-2/foxtrot", starts_in=timedelta(minutes=2), private=False, invitees=(ALEX, BON, MICAH)) -> str:
    start = datetime.now(timezone.utc) + starts_in
    async with async_session_maker() as db:
        out = await scheduled_service.create(
            db,
            CreateScheduledMeetingIn(
                title="Product Sync", room_id=room, starts_at=start, ends_at=start + timedelta(hours=1),
                is_private=private, invitee_emails=list(invitees),
            ),
            ORG,
        )
    return out.id


async def _one_session(meeting_key: str = FOXTROT) -> MeetingSession:
    assert await _wait(lambda: _count_is(meeting_key, 1))
    return (await _sessions(meeting_key))[0]


async def _count_is(meeting_key: str, n: int) -> bool:
    return len(await _sessions(meeting_key)) == n


# ---- A + C: same room, different meetings; instant meetings --------------------------------------------


async def test_same_room_different_meetings_get_distinct_sessions(server):
    alex = await _connect_as(server, ALEX)

    await alex.emit("call_joined", {"meetingId": FOXTROT})
    a = await _one_session()
    assert a.kind == "instant" and a.scheduled_meeting_id is None
    assert a.room_id == "floor-2/foxtrot" and a.meeting_key == FOXTROT
    assert a.started_by_email == ALEX and a.ended_at is None

    await alex.emit("meeting_end", {"meetingId": FOXTROT})
    await alex.emit("call_left", {})

    async def a_closed():
        return (await _sessions())[0].ended_at is not None

    assert await _wait(a_closed)
    assert (await _sessions())[0].end_reason == "ended"

    await alex.emit("call_joined", {"meetingId": FOXTROT})
    assert await _wait(lambda: _count_is(FOXTROT, 2))
    first, second = await _sessions()
    assert first.id == a.id and second.id != a.id
    assert first.ended_at is not None and second.ended_at is None
    await alex.disconnect()


# ---- B: scheduled activation, on time and early ---------------------------------------------------------


async def test_a_scheduled_meeting_activation_links_its_booking(server):
    booking_id = await _book()
    org = await _connect_as(server, ORG)
    await org.emit("call_joined", {"meetingId": FOXTROT})
    s = await _one_session()
    assert s.kind == "scheduled" and s.scheduled_meeting_id == booking_id and s.is_private is False
    await org.disconnect()


async def test_starting_early_binds_the_session_to_the_booking(server):
    # Outside the 5-minute access lead, inside the 15-minute early-start window.
    booking_id = await _book(starts_in=timedelta(minutes=10))
    org = await _connect_as(server, ORG)
    await org.emit("call_joined", {"meetingId": FOXTROT})
    s = await _one_session()
    assert s.scheduled_meeting_id == booking_id and s.kind == "scheduled"
    await org.disconnect()


# ---- D: attendance intervals, duplicate tabs -------------------------------------------------------------


async def test_attendance_records_join_leave_rejoin_as_intervals_and_ignores_extra_tabs(server):
    alex = await _connect_as(server, ALEX)
    bon = await _connect_as(server, BON)
    bon_tab2 = await _connect_as(server, BON)

    await alex.emit("call_joined", {"meetingId": FOXTROT})
    s = await _one_session()
    await bon.emit("call_joined", {"meetingId": FOXTROT})
    await bon_tab2.emit("call_joined", {"meetingId": FOXTROT})  # a second tab is not a second person
    assert await _wait(lambda: socket_module.call_registry.participants(FOXTROT_KEY) == [ALEX, BON])
    await asyncio.sleep(0.1)
    assert len(await _attendance(s.id, BON)) == 1

    await bon_tab2.emit("call_left", {})  # one tab leaving is not Bon leaving
    await asyncio.sleep(0.15)
    assert (await _attendance(s.id, BON))[0].left_at is None

    await bon.emit("call_left", {})

    async def bon_left():
        rows = await _attendance(s.id, BON)
        return len(rows) == 1 and rows[0].left_at is not None

    assert await _wait(bon_left)

    await bon.emit("call_joined", {"meetingId": FOXTROT})

    async def two_intervals():
        return len(await _attendance(s.id, BON)) == 2

    assert await _wait(two_intervals)
    first, second = await _attendance(s.id, BON)
    assert first.left_at is not None and second.left_at is None and second.joined_at >= first.left_at
    assert len(await _sessions()) == 1  # the meeting never emptied: still one occurrence
    for c in (alex, bon, bon_tab2):
        await c.disconnect()


# ---- E + F: invited-but-absent is authorized; the room grants nothing -----------------------------------


async def test_invited_but_absent_is_authorized_and_the_room_grants_nothing(server):
    await _book()
    org = await _connect_as(server, ORG)
    bon = await _connect_as(server, BON)
    await org.emit("call_joined", {"meetingId": FOXTROT})
    s = await _one_session()
    await bon.emit("call_joined", {"meetingId": FOXTROT})
    assert await _wait(lambda: socket_module.call_registry.participants(FOXTROT_KEY) == [BON, ORG])

    # Micah was invited and never joined: no attendance, still authorized.
    assert await _attendance(s.id, MICAH) == []
    assert await _can_read(s.id, MICAH)
    assert await _can_read(s.id, ORG) and await _can_read(s.id, BON) and await _can_read(s.id, ALEX)

    # Eve is nobody to this meeting. Standing in Foxtrot changes nothing — the gate never reads a room.
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")
    assert not await _can_read(s.id, EVE)
    socket_module.room_presence.leave(EVE)

    # Fail closed on nonsense.
    assert not await _can_read("", ORG) and not await _can_read(s.id, "") and not await _can_read("nope", ORG)
    await org.disconnect()
    await bon.disconnect()


async def test_having_held_a_meeting_in_the_same_room_grants_no_access_to_the_next(server):
    eve = await _connect_as(server, EVE)
    await eve.emit("call_joined", {"meetingId": FOXTROT})
    eve_session = await _one_session()
    await eve.emit("meeting_end", {"meetingId": FOXTROT})
    await eve.emit("call_left", {})
    await asyncio.sleep(0.2)

    await _book()
    org = await _connect_as(server, ORG)
    await org.emit("call_joined", {"meetingId": FOXTROT})
    assert await _wait(lambda: _count_is(FOXTROT, 2))
    later = (await _sessions())[1]
    assert later.id != eve_session.id
    assert await _can_read(eve_session.id, EVE)
    assert not await _can_read(later.id, EVE)
    assert not await _can_read(eve_session.id, ORG)
    await eve.disconnect()
    await org.disconnect()


async def test_an_explicit_instant_invitation_authorizes_only_when_sent_by_a_participant(server):
    alex = await _connect_as(server, ALEX)
    bon = await _connect_as(server, BON)
    eve = await _connect_as(server, EVE)
    micah = await _connect_as(server, MICAH)
    await alex.emit("call_joined", {"meetingId": CAVE})
    s = await _one_session(CAVE)
    assert s.kind == "instant" and s.room_id is None

    await alex.emit("meeting_invite", {"toEmail": BON, "meetingId": CAVE})
    # Eve is not in the meeting; her invitation authorizes nobody.
    await eve.emit("meeting_invite", {"toEmail": MICAH, "meetingId": CAVE})

    async def bon_granted():
        return await _can_read(s.id, BON)

    assert await _wait(bon_granted)
    await asyncio.sleep(0.1)
    assert not await _can_read(s.id, MICAH) and not await _can_read(s.id, EVE)
    for c in (alex, bon, eve, micah):
        await c.disconnect()


# ---- G: the private presence leak ------------------------------------------------------------------------


async def test_private_meeting_presence_reaches_only_authorized_viewers(server):
    await _book(private=True, invitees=(BON,))
    org = await _connect_as(server, ORG)
    bon = await _connect_as(server, BON)
    eve = await _connect_as(server, EVE)
    seen_org, seen_bon, seen_eve = _watch(org), _watch(bon), _watch(eve)
    ended_eve: list = []
    ended_org: list = []
    eve.on("meeting_ended", lambda d: ended_eve.append(d))
    org.on("meeting_ended", lambda d: ended_org.append(d))

    await org.emit("call_joined", {"meetingId": FOXTROT})
    s = await _one_session()
    assert s.is_private is True

    def latest(seen):
        return next((m for m in (seen[-1] if seen else []) if m["meetingId"] == FOXTROT), None)

    assert await _wait(lambda: latest(seen_eve) is not None and latest(seen_bon) is not None and latest(seen_org) is not None)
    # Eve: the room's meeting is live, and nothing else.
    assert latest(seen_eve)["live"] is True
    assert latest(seen_eve)["participants"] == [] and latest(seen_eve)["host"] == ""
    assert "sessionId" not in latest(seen_eve)
    # Bon (an invitee not yet in it) may see who is there; only participants get the session id.
    assert latest(seen_bon)["participants"] == [ORG] and latest(seen_bon)["host"] == ORG
    assert "sessionId" not in latest(seen_bon)
    assert latest(seen_org)["sessionId"] == s.id

    # A late-connecting outsider's first snapshot is redacted too.
    late = socketio.AsyncClient()
    seen_late = _watch(late)
    await late.connect(server, auth={"x-dev-email": "late@example.com"}, socketio_path="socket.io", transports=["websocket"])
    assert await _wait(lambda: latest(seen_late) is not None)
    assert latest(seen_late)["participants"] == [] and latest(seen_late)["host"] == ""

    # Who ended a private meeting is not broadcast to outsiders.
    await org.emit("meeting_end", {"meetingId": FOXTROT})
    assert await _wait(lambda: len(ended_org) == 1)
    await asyncio.sleep(0.15)
    assert ended_eve == []
    for c in (org, bon, eve, late):
        await c.disconnect()


async def test_a_normal_meeting_presence_is_unchanged_but_the_session_id_stays_with_participants(server):
    alex = await _connect_as(server, ALEX)
    eve = await _connect_as(server, EVE)
    seen_eve = _watch(eve)
    await alex.emit("call_joined", {"meetingId": FOXTROT})
    await _one_session()
    assert await _wait(lambda: bool(seen_eve and seen_eve[-1]))
    entry = seen_eve[-1][0]
    assert entry["participants"] == [ALEX] and entry["host"] == ALEX and entry["live"] is True
    assert "sessionId" not in entry
    await alex.disconnect()
    await eve.disconnect()


# ---- lifecycle: reconnect grace, emptied close, restart orphans ----------------------------------------


async def test_a_reconnect_inside_the_grace_keeps_the_session_and_after_it_a_new_one_starts(server):
    alex = await _connect_as(server, ALEX)
    await alex.emit("call_joined", {"meetingId": FOXTROT})
    s = await _one_session()

    await alex.emit("call_left", {})
    await asyncio.sleep(0.05)
    await alex.emit("call_joined", {"meetingId": FOXTROT})  # a blip: back inside the 0.3 s grace
    await asyncio.sleep(0.5)
    assert [x.id for x in await _sessions()] == [s.id]
    assert (await _sessions())[0].ended_at is None
    assert len(await _attendance(s.id, ALEX)) == 2

    await alex.emit("call_left", {})

    async def closed():
        return (await _sessions())[0].ended_at is not None

    assert await _wait(closed)
    assert (await _sessions())[0].end_reason == "emptied"

    await alex.emit("call_joined", {"meetingId": FOXTROT})
    assert await _wait(lambda: _count_is(FOXTROT, 2))
    await alex.disconnect()


async def test_orphaned_open_sessions_are_closed_at_startup(server):
    started = datetime.now(timezone.utc) - timedelta(hours=1)
    async with async_session_maker() as db:
        await repo.create(
            db, session_id="orphan-1", meeting_key=FOXTROT, room_id="floor-2/foxtrot", scheduled_meeting_id=None,
            kind="instant", is_private=False, started_by_email=ALEX, started_at=started,
        )
        await repo.open_attendance(db, "orphan-1", ALEX, at=started)
        await db.commit()

    assert await meeting_sessions.close_orphans(now=datetime.now(timezone.utc)) == 1
    async with async_session_maker() as db:
        row = await repo.get(db, "orphan-1")
        att = await repo.attendance(db, "orphan-1")
    assert row.ended_at is not None and row.end_reason == "server_restart"
    assert att[0].left_at is not None
