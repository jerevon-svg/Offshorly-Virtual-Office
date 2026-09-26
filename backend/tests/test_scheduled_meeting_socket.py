from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import socketio
import uvicorn
from sqlalchemy import delete

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.realtime import socket as socket_module
from app.schemas.scheduled_meetings import CreateScheduledMeetingIn
from app.services import scheduled_meetings as service

# Scheduled Meetings V1 — the socket half of the private-room gate. A non-invitee must not reach a
# private Meeting Floor meeting through the meeting-invite ring, nor register themselves into it via
# call_joined. Same live-uvicorn fixture as tests/test_meeting_socket.py.

pytestmark = pytest.mark.asyncio

ORG = "org@example.com"
BOB = "bob@example.com"
EVE = "eve@example.com"
ALPHA = "mf-alpha"


def _reset() -> None:
    socket_module.spatial_sessions.reset()
    socket_module.call_registry.reset()
    socket_module.meeting_hosts.reset()
    service.reset_live()


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(delete(ScheduledMeetingInvitee))
        await conn.execute(delete(ScheduledMeeting))
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
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


async def _book_private_now() -> None:
    start = datetime.now(timezone.utc) + timedelta(minutes=2)
    async with async_session_maker() as db:
        await service.create(
            db,
            CreateScheduledMeetingIn(
                title="Private", room_id="floor-2/alpha", starts_at=start, ends_at=start + timedelta(hours=1),
                is_private=True, invitee_emails=[BOB],
            ),
            ORG,
        )


async def test_the_meeting_invite_ring_cannot_bring_a_non_invitee_into_a_private_meeting(server):
    await _book_private_now()
    org = await _connect_as(server, ORG)
    bob = await _connect_as(server, BOB)
    eve = await _connect_as(server, EVE)
    failed: list = []
    incoming_eve: list = []
    incoming_bob: list = []
    org.on("meeting_invite_failed", lambda d: failed.append(d))
    eve.on("meeting_invite_failed", lambda d: failed.append(d))
    eve.on("meeting_invite_incoming", lambda d: incoming_eve.append(d))
    bob.on("meeting_invite_incoming", lambda d: incoming_bob.append(d))

    # An invitee may not ring a non-invitee in…
    await org.emit("meeting_invite", {"toEmail": EVE, "meetingId": ALPHA})
    assert await _wait(lambda: any(f["reason"] == "private" for f in failed))
    # …and a non-invitee may not ring an invitee to get themselves a foot in the door.
    failed.clear()
    await eve.emit("meeting_invite", {"toEmail": BOB, "meetingId": ALPHA})
    assert await _wait(lambda: any(f["reason"] == "private" for f in failed))
    # Invitee to invitee still rings.
    await org.emit("meeting_invite", {"toEmail": BOB, "meetingId": ALPHA})
    assert await _wait(lambda: len(incoming_bob) == 1)
    await asyncio.sleep(0.1)
    assert incoming_eve == []

    for c in (org, bob, eve):
        await c.disconnect()


async def test_a_non_invitee_cannot_register_into_a_private_meeting(server):
    await _book_private_now()
    org = await _connect_as(server, ORG)
    eve = await _connect_as(server, EVE)
    registry = socket_module.call_registry

    await eve.emit("call_joined", {"meetingId": ALPHA})
    await asyncio.sleep(0.2)
    assert registry.participants("meeting:mf-alpha") == []

    await org.emit("call_joined", {"meetingId": ALPHA})
    assert await _wait(lambda: registry.participants("meeting:mf-alpha") == [ORG])
    assert socket_module.meeting_hosts.host_of("meeting:mf-alpha") == ORG

    await eve.emit("call_joined", {"meetingId": ALPHA})
    await asyncio.sleep(0.2)
    assert registry.participants("meeting:mf-alpha") == [ORG]

    # An unrestricted room is unaffected.
    await eve.emit("call_joined", {"meetingId": "mf-bravo"})
    assert await _wait(lambda: registry.participants("meeting:mf-bravo") == [EVE])

    for c in (org, eve):
        await c.disconnect()


async def test_meeting_presence_says_which_booking_a_live_room_belongs_to(server):
    await _book_private_now()
    org = await _connect_as(server, ORG)
    eve = await _connect_as(server, EVE)
    seen: list = []
    eve.on("meeting_presence", lambda d: seen.append(d["meetings"]))

    await org.emit("call_joined", {"meetingId": ALPHA})
    await eve.emit("call_joined", {"meetingId": "mf-bravo"})  # an unbooked, ad-hoc room

    def entry(mid):
        for snap in reversed(seen):
            for m in snap:
                if m["meetingId"] == mid and m["participants"]:
                    return m
        return None

    assert await _wait(lambda: entry(ALPHA) is not None and entry("mf-bravo") is not None)
    booking = entry(ALPHA)["booking"]
    # Public window facts only — no title, no id, no invitees.
    assert set(booking) == {"startsAt", "endsAt", "isPrivate"} and booking["isPrivate"] is True
    assert entry("mf-bravo")["booking"] is None

    for c in (org, eve):
        await c.disconnect()


async def test_a_schedule_change_nudges_every_client_without_any_meeting_details(server):
    import httpx

    eve = await _connect_as(server, EVE)
    nudges: list = []
    eve.on("scheduled_meetings_changed", lambda d: nudges.append(d))
    start = datetime.now(timezone.utc) + timedelta(days=1)
    async with httpx.AsyncClient(base_url=server) as http:
        res = await http.post(
            "/scheduled-meetings",
            json={"title": "Secret", "roomId": "floor-2/alpha", "startsAt": start.isoformat(),
                  "endsAt": (start + timedelta(hours=1)).isoformat(), "isPrivate": True},
            headers={"x-dev-email": ORG},
        )
    assert res.status_code == 201
    assert await _wait(lambda: len(nudges) == 1)
    assert nudges[0] == {}
    await eve.disconnect()


async def test_an_invitee_starting_early_starts_their_own_booked_meeting(server):
    start = datetime.now(timezone.utc) + timedelta(minutes=12)  # Upcoming, before the 5-minute window
    async with async_session_maker() as db:
        await service.create(
            db,
            CreateScheduledMeetingIn(title="Early", room_id="floor-2/alpha", starts_at=start,
                                     ends_at=start + timedelta(hours=1), is_private=True, invitee_emails=[BOB]),
            ORG,
        )
    org = await _connect_as(server, ORG)
    await org.emit("call_joined", {"meetingId": ALPHA})
    assert await _wait(lambda: socket_module.call_registry.participants("meeting:mf-alpha") == [ORG])
    wire = service.live_booking_wire("meeting:mf-alpha")
    assert wire is not None and wire["isPrivate"] is True
    # …and so its privacy already holds: a non-invitee is refused.
    async with async_session_maker() as db:
        assert (await service.admit(db, ALPHA, EVE))[0] is False
    await org.disconnect()


async def test_a_non_invitee_starting_early_is_an_ad_hoc_session(server):
    start = datetime.now(timezone.utc) + timedelta(minutes=12)
    async with async_session_maker() as db:
        await service.create(
            db,
            CreateScheduledMeetingIn(title="Early", room_id="floor-2/alpha", starts_at=start,
                                     ends_at=start + timedelta(hours=1), is_private=True, invitee_emails=[BOB]),
            ORG,
        )
    eve = await _connect_as(server, EVE)
    await eve.emit("call_joined", {"meetingId": ALPHA})
    assert await _wait(lambda: socket_module.call_registry.participants("meeting:mf-alpha") == [EVE])
    assert service.live_booking_wire("meeting:mf-alpha") is None
    await eve.disconnect()
