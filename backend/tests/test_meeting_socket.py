from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module

# PHASE 7D — socket coverage for STANDALONE MEETINGS: presence, Start-vs-Join, host assignment and
# transfer, and the lifecycle that ends a meeting when the last participant goes. Same live-uvicorn
# fixture as tests/test_call_socket.py, which this sits beside.
#
# The point of testing here rather than only against the registries is the wiring: a meeting has NO
# spatial session, and the old call_joined handler refused anything that did not have one.

pytestmark = pytest.mark.asyncio

CAVE = "cave-all-hands"


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    socket_module.spatial_sessions.reset()
    socket_module.call_registry.reset()
    socket_module.meeting_hosts.reset()

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
    socket_module.call_registry.reset()
    socket_module.meeting_hosts.reset()
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


def _watch(client) -> list:
    seen: list = []

    @client.on("meeting_presence")
    async def _on(data):
        seen.append(data["meetings"])

    return seen


async def test_a_meeting_needs_no_spatial_session_and_its_first_joiner_hosts_it(server):
    """The whole reason the old handler could not carry meetings: there is no conversation here."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    seen = _watch(b)
    await asyncio.sleep(0.2)

    await a.emit("call_joined", {"meetingId": CAVE})
    assert await _wait(lambda: seen and seen[-1])
    assert seen[-1][0]["meetingId"] == CAVE
    assert seen[-1][0]["participants"] == ["a@example.com"]
    assert seen[-1][0]["host"] == "a@example.com"

    await a.disconnect()
    await b.disconnect()


async def test_a_second_person_joins_the_same_meeting_without_taking_the_host(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    seen = _watch(b)
    await asyncio.sleep(0.2)

    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)
    await b.emit("call_joined", {"meetingId": CAVE})

    assert await _wait(lambda: seen and len(seen[-1][0]["participants"]) == 2)
    assert seen[-1][0]["participants"] == ["a@example.com", "b@example.com"]
    assert seen[-1][0]["host"] == "a@example.com"

    await a.disconnect()
    await b.disconnect()


async def test_host_leaving_transfers_to_the_longest_present_remaining_participant(server):
    """Arrival order a -> b -> c. When a leaves it must go to B, not to whoever sorts first."""
    a = await _connect_as(server, "c@example.com")  # hosts; sorts LAST alphabetically
    b = await _connect_as(server, "b@example.com")
    c = await _connect_as(server, "a@example.com")  # sorts FIRST alphabetically
    seen = _watch(c)
    await asyncio.sleep(0.2)

    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.15)
    await b.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.15)
    await c.emit("call_joined", {"meetingId": CAVE})
    assert await _wait(lambda: seen and len(seen[-1][0]["participants"]) == 3)
    assert seen[-1][0]["host"] == "c@example.com"

    await a.emit("call_left", {})
    assert await _wait(lambda: seen and len(seen[-1][0]["participants"]) == 2)
    assert seen[-1][0]["host"] == "b@example.com"

    await a.disconnect()
    await b.disconnect()
    await c.disconnect()


async def test_a_dropped_socket_transfers_the_host_exactly_like_an_orderly_leave(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    watcher = await _connect_as(server, "w@example.com")
    seen = _watch(watcher)
    await asyncio.sleep(0.2)

    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.15)
    await b.emit("call_joined", {"meetingId": CAVE})
    assert await _wait(lambda: seen and len(seen[-1][0]["participants"]) == 2)

    await a.disconnect()  # the host's browser goes away
    assert await _wait(lambda: seen and len(seen[-1][0]["participants"]) == 1)
    assert seen[-1][0]["host"] == "b@example.com"

    await b.disconnect()
    await watcher.disconnect()


async def test_the_last_participant_leaving_ends_the_meeting(server):
    a = await _connect_as(server, "a@example.com")
    watcher = await _connect_as(server, "w@example.com")
    seen = _watch(watcher)
    await asyncio.sleep(0.2)

    await a.emit("call_joined", {"meetingId": CAVE})
    assert await _wait(lambda: seen and seen[-1])
    await a.emit("call_left", {})

    # An empty list is how the Cave's panel goes back to "Start meeting".
    assert await _wait(lambda: seen and seen[-1] == [])
    assert socket_module.meeting_hosts.host_of("meeting:" + CAVE) is None

    await a.disconnect()
    await watcher.disconnect()


async def test_a_connecting_client_is_told_at_once_whether_a_meeting_is_running(server):
    """Without this snapshot, somebody walking into the Cave shows Start for a live meeting."""
    a = await _connect_as(server, "a@example.com")
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)

    late = socketio.AsyncClient()
    seen: list = []

    @late.on("meeting_presence")
    async def _on(data):
        seen.append(data["meetings"])

    await late.connect(
        server, auth={"x-dev-email": "late@example.com"}, socketio_path="socket.io", transports=["websocket"]
    )
    assert await _wait(lambda: seen and seen[-1])
    assert seen[-1][0]["host"] == "a@example.com"

    await late.disconnect()
    await a.disconnect()


async def test_a_meeting_never_appears_in_the_spatial_call_feed(server):
    """Load-bearing: chat surfaces match spatial_calls entries against conversation ids."""
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    spatial: list = []

    @b.on("spatial_calls")
    async def _on(data):
        spatial.append(data["calls"])

    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)
    assert all(entry == [] for entry in spatial)

    await a.disconnect()
    await b.disconnect()


async def test_a_malformed_meeting_id_registers_nothing(server):
    a = await _connect_as(server, "a@example.com")
    watcher = await _connect_as(server, "w@example.com")
    seen = _watch(watcher)
    await asyncio.sleep(0.2)

    await a.emit("call_joined", {"meetingId": "NOT A VALID ID!"})
    await asyncio.sleep(0.3)
    assert all(entry == [] for entry in seen)

    await a.disconnect()
    await watcher.disconnect()


# --- meeting INVITATIONS -------------------------------------------------------------------------
#
# A separate ring from the spatial one: it offers a ROOM, not a conversation between two avatars. These
# pin that the two never touch each other, and that every refusal reason is a real one.


async def test_inviting_somebody_rings_them_and_tells_the_inviter(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    incoming, ringing = [], []
    b.on("meeting_invite_incoming", lambda d: incoming.append(d))
    a.on("meeting_invite_ringing", lambda d: ringing.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)

    await a.emit("meeting_invite", {"toEmail": "b@example.com", "meetingId": CAVE})

    assert await _wait(lambda: incoming and ringing)
    assert incoming[-1]["fromEmail"] == "a@example.com"
    assert incoming[-1]["meetingId"] == CAVE
    assert incoming[-1]["inviteId"] == ringing[-1]["inviteId"]

    await a.disconnect()
    await b.disconnect()


async def test_accepting_clears_both_prompts_and_declining_says_so(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    incoming, accepted, declined = [], [], []
    b.on("meeting_invite_incoming", lambda d: incoming.append(d))
    a.on("meeting_invite_accepted", lambda d: accepted.append(d))
    a.on("meeting_invite_declined", lambda d: declined.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)

    await a.emit("meeting_invite", {"toEmail": "b@example.com", "meetingId": CAVE})
    assert await _wait(lambda: incoming)
    await b.emit("meeting_invite_accept", {"inviteId": incoming[-1]["inviteId"]})
    assert await _wait(lambda: accepted)

    incoming.clear()
    await a.emit("meeting_invite", {"toEmail": "b@example.com", "meetingId": CAVE})
    assert await _wait(lambda: incoming)
    await b.emit("meeting_invite_decline", {"inviteId": incoming[-1]["inviteId"]})
    assert await _wait(lambda: declined)
    assert declined[-1]["reason"] == "declined"

    await a.disconnect()
    await b.disconnect()


async def test_a_meeting_invitation_and_a_spatial_ring_never_resolve_each_other(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    meeting_in, spatial_in = [], []
    b.on("meeting_invite_incoming", lambda d: meeting_in.append(d))
    b.on("call_invite_incoming", lambda d: spatial_in.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)

    await a.emit("meeting_invite", {"toEmail": "b@example.com", "meetingId": CAVE})
    assert await _wait(lambda: meeting_in)
    # Resolving the MEETING invitation with the spatial handler must do nothing at all.
    await b.emit("call_invite_decline", {"inviteId": meeting_in[-1]["inviteId"]})
    await asyncio.sleep(0.3)
    assert spatial_in == []
    # ...and the meeting invitation is still live, resolvable by its own handler.
    declined = []
    a.on("meeting_invite_declined", lambda d: declined.append(d))
    await b.emit("meeting_invite_decline", {"inviteId": meeting_in[-1]["inviteId"]})
    assert await _wait(lambda: declined)

    await a.disconnect()
    await b.disconnect()


async def test_every_refusal_reason_is_a_real_one(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    failed = []
    a.on("meeting_invite_failed", lambda d: failed.append(d))
    await asyncio.sleep(0.2)
    await a.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.2)

    # Nobody there.
    await a.emit("meeting_invite", {"toEmail": "ghost@example.com", "meetingId": CAVE})
    assert await _wait(lambda: failed)
    assert failed[-1]["reason"] == "offline"

    # Already in the meeting.
    await b.emit("call_joined", {"meetingId": CAVE})
    await asyncio.sleep(0.3)
    failed.clear()
    await a.emit("meeting_invite", {"toEmail": "b@example.com", "meetingId": CAVE})
    assert await _wait(lambda: failed)
    assert failed[-1]["reason"] == "already_in"

    await a.disconnect()
    await b.disconnect()


async def test_a_malformed_or_missing_meeting_id_invites_nobody(server):
    a = await _connect_as(server, "a@example.com")
    b = await _connect_as(server, "b@example.com")
    incoming, failed = [], []
    b.on("meeting_invite_incoming", lambda d: incoming.append(d))
    a.on("meeting_invite_failed", lambda d: failed.append(d))
    await asyncio.sleep(0.2)

    await a.emit("meeting_invite", {"toEmail": "b@example.com", "meetingId": "NOT VALID!"})
    await a.emit("meeting_invite", {"toEmail": "b@example.com"})
    await asyncio.sleep(0.4)
    assert incoming == []
    assert failed == []

    await a.disconnect()
    await b.disconnect()
