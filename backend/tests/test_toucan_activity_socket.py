from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
import socketio
import uvicorn
from sqlalchemy import select

from app import database as app_db
from app.config import settings
from app.database import Base
from app.main import app as combined_app
from app.models.activity_event import EVENT_CALL_MISSED, ActivityEvent
from app.models.toucan import ToucanAttentionCursor
from app.realtime import socket as socket_module
from app.repositories import toucan_activity as activity_repo

# Socket-layer coverage for Toucan T2's TWO instrumentation hooks, and nothing else. Mirrors
# tests/test_call_invite_socket.py's fixture.
#
# What is being pinned here is not the wording or the counting (tests/test_toucan_activity.py
# owns those) but the narrow claim that these two facts get WRITTEN DOWN at the right moments:
# a person being seen, and a ring nobody answered. Everything else about the realtime layer must
# stay exactly as it was — which is itself asserted below.

pytestmark = pytest.mark.asyncio

A = "a@example.com"
B = "b@example.com"


@pytest.fixture
async def server(isolated_app_db):
    # `isolated_app_db` FIRST, and it is not optional: it repoints the application at a
    # throwaway database before anything below runs. Without it the truncations here would
    # execute against the developer's real virtual_office_fastapi.db (see tests/conftest.py).
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(ActivityEvent.__table__.delete())
        await conn.execute(ToucanAttentionCursor.__table__.delete())
    for reg in (socket_module.spatial_sessions, socket_module.call_registry, socket_module.call_invites):
        reg.reset()
    socket_module.dnd_registry._dnd_emails.clear()
    socket_module.offline_lineup._slot_by_email.clear()

    config = uvicorn.Config(combined_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    await task
    for reg in (socket_module.spatial_sessions, socket_module.call_registry, socket_module.call_invites):
        reg.reset()
    socket_module.dnd_registry._dnd_emails.clear()
    socket_module.offline_lineup._slot_by_email.clear()
    settings.APP_ENV = original_env


async def _connect(url: str, email: str, bag: dict) -> socketio.AsyncClient:
    c = socketio.AsyncClient()
    for evt in (
        "call_invite_incoming",
        "call_invite_ringing",
        "call_invite_accepted",
        "call_invite_declined",
        "call_invite_cancelled",
        "call_invite_failed",
    ):
        def handler(data, _evt=evt):
            bag.setdefault(_evt, []).append(data)
        c.on(evt, handler)
    await asyncio.wait_for(
        c.connect(url, auth={"x-dev-email": email}, socketio_path="socket.io", transports=["websocket"]),
        timeout=5,
    )
    return c


async def _wait(pred, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


async def _events(subject: str) -> list[ActivityEvent]:
    async with app_db.async_session_maker() as session:
        return list(
            (
                await session.execute(
                    select(ActivityEvent).where(ActivityEvent.subject_email == subject)
                )
            ).scalars().all()
        )


async def _snapshot_reason(email: str) -> str:
    """What the window would mean right now, straight from the repository the router uses."""
    async with app_db.async_session_maker() as session:
        return (await activity_repo.attention_snapshot(session, viewer_email=email))["since_reason"]


async def _cursor(email: str) -> ToucanAttentionCursor | None:
    async with app_db.async_session_maker() as session:
        return (
            await session.execute(
                select(ToucanAttentionCursor).where(ToucanAttentionCursor.email == email)
            )
        ).scalar_one_or_none()


# --- presence -----------------------------------------------------------------------------


async def test_connecting_records_the_presence_cursor(server):
    a = await _connect(server, A, {})
    await asyncio.sleep(0.3)

    row = await _cursor(A)
    assert row is not None
    assert row.email == A
    assert row.away_since is None  # first sighting is not an absence
    await a.disconnect()


async def test_one_socket_of_several_closing_is_not_a_departure(server):
    """A browser holds many sockets at once. Losing one of them says nothing about whether the
    person is still here, so it must leave the cursor completely untouched."""
    first = await _connect(server, A, {})
    second = await _connect(server, A, {})
    await asyncio.sleep(0.4)
    before = (await _cursor(A)).last_seen_at

    await first.disconnect()
    await asyncio.sleep(0.4)

    assert (await _cursor(A)).last_seen_at == before
    await second.disconnect()


async def test_the_last_socket_closing_records_the_departure(server):
    """The other half of the same rule: once nothing is left, the person has actually gone and
    the moment is worth writing down. This is the "closed the laptop without checking out" path."""
    first = await _connect(server, A, {})
    second = await _connect(server, A, {})
    await asyncio.sleep(0.4)
    await first.disconnect()
    await asyncio.sleep(0.3)
    before = (await _cursor(A)).last_seen_at

    await second.disconnect()
    await asyncio.sleep(0.5)

    after = (await _cursor(A)).last_seen_at
    assert after > before
    # A departure only records a candidate — whether it was an absence is decided on return.
    assert (await _cursor(A)).away_since is None


async def test_another_persons_socket_does_not_hold_your_session_open(server):
    """The last-socket check is per email, not global — B being online must not stop A's
    departure from being recorded."""
    a = await _connect(server, A, {})
    b = await _connect(server, B, {})
    await asyncio.sleep(0.4)
    before = (await _cursor(A)).last_seen_at

    await a.disconnect()
    await asyncio.sleep(0.5)

    assert (await _cursor(A)).last_seen_at > before
    await b.disconnect()


async def test_a_refresh_records_no_absence(server):
    """Disconnect immediately followed by reconnect — well inside ABSENCE_GAP_SECONDS — is the
    shape of every page refresh, and must never look like time away."""
    a = await _connect(server, A, {})
    await asyncio.sleep(0.3)
    await a.disconnect()
    await asyncio.sleep(0.3)

    b = await _connect(server, A, {})
    await asyncio.sleep(0.4)

    row = await _cursor(A)
    assert row.away_since is None
    assert (await _snapshot_reason(A)) == "tracking_started"
    await b.disconnect()


async def test_checking_out_moves_the_cursor_to_the_moment_of_departure(server):
    a = await _connect(server, A, {})
    await asyncio.sleep(0.3)
    before = (await _cursor(A)).last_seen_at

    await a.emit("go_offline")
    assert await _wait(lambda: socket_module.offline_lineup.snapshot() != [])
    await asyncio.sleep(0.4)

    row = await _cursor(A)
    assert row.last_seen_at > before
    assert row.away_since is None  # a checkout is a candidate, not yet an absence
    await a.disconnect()


async def test_checking_back_in_quickly_records_no_absence(server):
    a = await _connect(server, A, {})
    await asyncio.sleep(0.3)
    await a.emit("go_offline")
    assert await _wait(lambda: socket_module.offline_lineup.snapshot() != [])
    await asyncio.sleep(0.3)

    await a.emit("come_online")
    assert await _wait(lambda: socket_module.offline_lineup.snapshot() == [])
    await asyncio.sleep(0.4)

    assert (await _cursor(A)).away_since is None
    await a.disconnect()


# --- missed calls -------------------------------------------------------------------------


async def test_calling_somebody_who_is_not_connected_records_a_missed_call(server):
    """THE CASE T2 EXISTS FOR: no invite is ever minted here, so without this hook the attempt
    would leave no trace anywhere for the recipient to find when they come back."""
    bag = {}
    a = await _connect(server, A, bag)
    await asyncio.sleep(0.2)

    await a.emit("call_invite", {"toEmail": B})
    assert await _wait(lambda: bag.get("call_invite_failed"))
    assert bag["call_invite_failed"][-1]["reason"] == "offline"
    await asyncio.sleep(0.3)

    events = await _events(B)
    assert len(events) == 1
    assert events[0].event_type == EVENT_CALL_MISSED
    assert events[0].actor_email == A
    await a.disconnect()


async def test_the_caller_hanging_up_records_a_missed_call_for_the_recipient(server):
    A_bag, B_bag = {}, {}
    a = await _connect(server, A, A_bag)
    b = await _connect(server, B, B_bag)
    await asyncio.sleep(0.3)

    await a.emit("call_invite", {"toEmail": B})
    assert await _wait(lambda: B_bag.get("call_invite_incoming"))
    invite_id = B_bag["call_invite_incoming"][-1]["inviteId"]

    await a.emit("call_invite_cancel", {"inviteId": invite_id})
    assert await _wait(lambda: B_bag.get("call_invite_cancelled"))
    await asyncio.sleep(0.3)

    events = await _events(B)
    assert [e.event_type for e in events] == [EVENT_CALL_MISSED]
    assert events[0].reference_id == invite_id
    # The caller did not miss anything — the event is recorded against the recipient only.
    assert await _events(A) == []
    await a.disconnect(); await b.disconnect()


async def test_declining_is_not_a_missed_call(server):
    """The recipient was there and made a choice. Recording it as "missed" would misreport
    a deliberate decision back to them days later."""
    A_bag, B_bag = {}, {}
    a = await _connect(server, A, A_bag)
    b = await _connect(server, B, B_bag)
    await asyncio.sleep(0.3)

    await a.emit("call_invite", {"toEmail": B})
    assert await _wait(lambda: B_bag.get("call_invite_incoming"))
    await b.emit("call_invite_decline", {"inviteId": B_bag["call_invite_incoming"][-1]["inviteId"]})
    assert await _wait(lambda: A_bag.get("call_invite_declined"))
    await asyncio.sleep(0.3)

    assert await _events(B) == []
    await a.disconnect(); await b.disconnect()


async def test_accepting_is_not_a_missed_call(server):
    A_bag, B_bag = {}, {}
    a = await _connect(server, A, A_bag)
    b = await _connect(server, B, B_bag)
    await asyncio.sleep(0.3)

    await a.emit("call_invite", {"toEmail": B})
    assert await _wait(lambda: B_bag.get("call_invite_incoming"))
    await b.emit("call_invite_accept", {"inviteId": B_bag["call_invite_incoming"][-1]["inviteId"]})
    assert await _wait(lambda: A_bag.get("call_invite_accepted"))
    await asyncio.sleep(0.3)

    assert await _events(B) == []
    await a.disconnect(); await b.disconnect()


async def test_a_dropped_caller_socket_records_a_missed_call(server):
    A_bag, B_bag = {}, {}
    a = await _connect(server, A, A_bag)
    b = await _connect(server, B, B_bag)
    await asyncio.sleep(0.3)

    await a.emit("call_invite", {"toEmail": B})
    assert await _wait(lambda: B_bag.get("call_invite_incoming"))

    await a.disconnect()
    assert await _wait(lambda: B_bag.get("call_invite_cancelled"))
    await asyncio.sleep(0.3)

    assert [e.event_type for e in await _events(B)] == [EVENT_CALL_MISSED]
    await b.disconnect()


async def test_ringing_still_creates_no_session_or_media(server):
    """Regression guard: T2 added writes to these handlers and must have changed nothing else
    about what ringing does."""
    A_bag, B_bag = {}, {}
    a = await _connect(server, A, A_bag)
    b = await _connect(server, B, B_bag)
    await asyncio.sleep(0.3)

    await a.emit("call_invite", {"toEmail": B})
    assert await _wait(lambda: B_bag.get("call_invite_incoming"))

    assert socket_module.spatial_sessions.snapshot() == []
    assert socket_module.call_registry.snapshot() == []
    await a.disconnect(); await b.disconnect()


async def test_a_ring_that_times_out_records_a_missed_call(server):
    """The TTL path, driven directly rather than by waiting out INVITE_TTL_SECONDS. Calls the
    real expiry coroutine with its one sleep neutralised, so the sweep, the event write and the
    terminal emit all run exactly as they do in production."""
    a = await _connect(server, A, {})
    b = await _connect(server, B, {})
    await asyncio.sleep(0.3)

    invite = socket_module.call_invites.create(from_email=A, from_sid="sid-a", to_email=B)

    async def _no_wait(_seconds):
        return None

    real_sleep = asyncio.sleep
    asyncio.sleep = _no_wait
    try:
        await socket_module._expire_invite_later(invite["inviteId"])
    finally:
        asyncio.sleep = real_sleep

    await real_sleep(0.2)
    events = await _events(B)
    assert [e.event_type for e in events] == [EVENT_CALL_MISSED]
    assert events[0].actor_email == A
    assert await _events(A) == []
    await a.disconnect(); await b.disconnect()


async def test_the_reported_case_end_to_end_closing_the_browser_then_returning_a_day_later(server):
    """THE EXACT CASE THE REVIEW FOUND, driven through real sockets rather than the repository.

    Connect in the morning, close the browser in the evening with no explicit checkout, come
    back the next day. The absence must be measured from the moment the last socket went away,
    not from the connect that started the session.

    The only thing faked here is the passage of time: the stored row is shifted back a day
    between the departure and the return, so the return sees a real gap. Both timestamps are
    shifted by the same amount, so the connect-vs-departure distinction the assertion turns on
    is untouched."""
    a = await _connect(server, A, {})
    await asyncio.sleep(0.4)
    connected_at = (await _cursor(A)).last_seen_at

    await a.disconnect()
    await asyncio.sleep(0.5)
    departed_at = (await _cursor(A)).last_seen_at
    assert departed_at > connected_at, "the last socket closing must move the cursor"

    a_day = timedelta(days=1)
    async with app_db.async_session_maker() as session:
        row = (
            await session.execute(
                select(ToucanAttentionCursor).where(ToucanAttentionCursor.email == A)
            )
        ).scalar_one()
        row.last_seen_at = departed_at - a_day
        await session.commit()

    back = await _connect(server, A, {})
    await asyncio.sleep(0.5)

    row = await _cursor(A)
    assert row.away_since is not None
    # Measured from the evening's departure...
    assert abs((row.away_since - (departed_at - a_day)).total_seconds()) < 0.001
    # ...and NOT from the morning's connect, which is what the bug did.
    assert abs((row.away_since - (connected_at - a_day)).total_seconds()) > 0.001
    assert (await _snapshot_reason(A)) == "last_active"
    await back.disconnect()
