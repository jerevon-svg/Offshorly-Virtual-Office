from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import socketio
import uvicorn
from sqlalchemy import delete, select

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import app as combined_app
from app.main import fastapi_app
from app.models.meeting_capture import CaptureConsent, CaptureSession, TranscriptSegment
from app.models.meeting_session import MeetingSession, MeetingSessionAttendance, MeetingSessionGrant
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.realtime import socket as socket_module
from app.repositories import meeting_captures as capture_repo
from app.repositories import meeting_sessions as session_repo
from app.schemas.scheduled_meetings import CreateScheduledMeetingIn
from app.services import meeting_access, meeting_capture, meeting_sessions
from app.services import scheduled_meetings as scheduled_service

# PHASE 6B — Capture + Consent + Transcript Evidence, end to end over the real socket handlers (the same
# live-uvicorn fixture as tests/test_meeting_sessions.py). Only the in-process FAKE source is used: no audio,
# no provider, no storage. What is proven here:
#   * a capture belongs to exactly one Meeting Session and cannot outlive it (stop, End, emptied, restart);
#   * only the in-call host — or a scheduled meeting's organizer — may start it; Memory access starts nothing;
#   * consent is explicit, per person, per capture; decline keeps you in the meeting; rejoin keeps your
#     decision; a new capture needs a new decision;
#   * ingestion refuses unknown / pending / declined speakers and any claimed identity but the source's own;
#   * transcript reads go through meeting_access only — invited-but-absent may read, the room grants nothing.

pytestmark = pytest.mark.asyncio

ORG = "org@example.com"
BON = "bon@example.com"
JAN = "jan@example.com"
MICAH = "micah@example.com"
EVE = "eve@example.com"
FOXTROT = "mf-foxtrot"
FOXTROT_KEY = "meeting:mf-foxtrot"


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
        for model in (
            TranscriptSegment, CaptureConsent, CaptureSession, MeetingSessionGrant, MeetingSessionAttendance,
            MeetingSession, ScheduledMeetingInvitee, ScheduledMeeting,
        ):
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


def _states(client) -> list:
    seen: list = []

    @client.on("capture_state")
    async def _on(data):
        seen.append(data)

    return seen


async def _join(client, email: str, meeting: str = FOXTROT) -> str:
    """Join and wait until the joiner is a participant of a persisted, live session. Returns its id."""
    await client.emit("call_joined", {"meetingId": meeting})
    key = "meeting:" + meeting
    assert await _wait(lambda: email in socket_module.call_registry.participants(key) and meeting_sessions.session_id_for(key))
    await asyncio.sleep(0.05)  # let on_join's consent enrolment land
    return meeting_sessions.session_id_for(key)


async def _call(client, event: str, **body) -> dict:
    return await client.call(event, {"meetingId": FOXTROT, **body}, timeout=5)


async def _say(client, capture_id: str, text: str = "hello", *, start=0, end=500, **extra) -> dict:
    return await _call(
        client, "capture_dev_segment", captureId=capture_id, startOffsetMs=start, endOffsetMs=end, text=text, **extra
    )


async def _consent(capture_id: str, email: str) -> CaptureConsent | None:
    async with async_session_maker() as db:
        return await capture_repo.consent(db, capture_id, email)


async def _capture(capture_id: str) -> CaptureSession:
    async with async_session_maker() as db:
        return await capture_repo.get(db, capture_id)


async def _elapsed_ms(capture_id: str) -> int:
    """Milliseconds since the capture's server start — to place a fake segment at "now" on its timeline."""
    started = (await _capture(capture_id)).started_at
    started = started if started.tzinfo else started.replace(tzinfo=timezone.utc)
    return int((datetime.now(timezone.utc) - started).total_seconds() * 1000)


async def _segments(capture_id: str) -> list[TranscriptSegment]:
    async with async_session_maker() as db:
        return await capture_repo.segments(db, [capture_id])


async def _book(*, private=False, invitees=(BON, JAN, MICAH)) -> str:
    start = datetime.now(timezone.utc) + timedelta(minutes=2)
    async with async_session_maker() as db:
        out = await scheduled_service.create(
            db,
            CreateScheduledMeetingIn(
                title="Product Sync", room_id="floor-2/foxtrot", starts_at=start, ends_at=start + timedelta(hours=1),
                is_private=private, invitee_emails=list(invitees),
            ),
            ORG,
        )
    return out.id


async def _read(session_id: str, email: str) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test") as http:
        return await http.get(f"/meeting-sessions/{session_id}/transcript", headers={"x-dev-email": email})


async def _disconnect(*clients) -> None:
    for c in clients:
        await c.disconnect()


# ---- ownership + who may start ---------------------------------------------------------------------------


async def test_a_capture_belongs_to_one_meeting_session_and_not_to_the_room(server):
    bon = await _connect_as(server, BON)
    first = await _join(bon, BON)
    ack = await _call(bon, "capture_start")
    assert ack["ok"] is True
    old_capture = ack["captureId"]
    assert (await _capture(old_capture)).meeting_session_id == first

    await bon.emit("meeting_end", {"meetingId": FOXTROT})
    await bon.emit("call_left", {})
    assert await _wait(lambda: meeting_sessions.session_id_for(FOXTROT_KEY) is None)
    second = await _join(bon, BON)
    assert second != first
    # The old capture does not follow the room into the next meeting.
    assert (await _call(bon, "capture_consent", captureId=old_capture, decision="grant"))["code"] == "no_active_capture"
    ack = await _call(bon, "capture_start")
    assert ack["ok"] and (await _capture(ack["captureId"])).meeting_session_id == second
    await _disconnect(bon)


async def test_only_the_in_call_host_may_start_an_instant_capture(server):
    bon, jan, eve = await _connect_as(server, BON), await _connect_as(server, JAN), await _connect_as(server, EVE)
    await _join(bon, BON)
    await _join(jan, JAN)
    assert (await _call(jan, "capture_start"))["code"] == "not_allowed"  # a participant, not the host
    assert (await _call(eve, "capture_start"))["code"] == "not_participant"  # not in the call at all
    ack = await _call(bon, "capture_start")
    assert ack["ok"] and (await _capture(ack["captureId"])).started_by_email == BON
    assert (await _call(bon, "capture_start"))["code"] == "already_active"  # one active capture at a time
    assert (await _call(jan, "capture_stop"))["code"] == "not_allowed"
    await _disconnect(bon, jan, eve)


async def test_scheduled_organizer_may_start_but_an_absent_memory_reader_may_not(server):
    await _book()
    bon, org, micah = await _connect_as(server, BON), await _connect_as(server, ORG), await _connect_as(server, MICAH)
    session_id = await _join(bon, BON)  # Bon is host
    await _join(org, ORG)  # the organizer, in the call, not host
    async with async_session_maker() as db:
        assert await meeting_access.can_read(db, session_id, MICAH)  # authorized reader…
    assert (await _call(micah, "capture_start"))["code"] == "not_participant"  # …cannot start it remotely
    ack = await _call(org, "capture_start")
    assert ack["ok"] is True
    assert (await _call(org, "capture_stop"))["ok"] is True
    await _disconnect(bon, org, micah)


# ---- consent lifecycle + ingestion (scenarios A–E) --------------------------------------------------------


async def test_consent_lifecycle_and_ingestion_refuse_everyone_who_has_not_granted(server):
    bon, jan, eve = await _connect_as(server, BON), await _connect_as(server, JAN), await _connect_as(server, EVE)
    seen_jan, seen_eve = _states(jan), _states(eve)
    await _join(bon, BON)
    await _join(jan, JAN)
    capture_id = (await _call(bon, "capture_start"))["captureId"]

    # A. Both present → both pending; each told their own state; an outsider told nothing.
    assert (await _consent(capture_id, BON)).state == "pending"
    assert (await _consent(capture_id, JAN)).state == "pending"
    assert await _wait(lambda: any(s["capture"] and s["capture"]["active"] for s in seen_jan))
    jan_state = next(s for s in reversed(seen_jan) if s["capture"])
    assert jan_state["myConsent"] == "pending" and jan_state["capture"]["startedBy"] == BON
    assert jan_state["canControl"] is False
    await asyncio.sleep(0.1)
    assert seen_eve == []
    assert (await _say(bon, capture_id))["code"] == "consent_pending"

    # B. Bon grants → his segment is accepted.
    assert (await _call(bon, "capture_consent", captureId=capture_id, decision="grant"))["consent"] == "granted"
    ok = await _say(bon, capture_id, "we ship friday", start=100, end=900, confidence=0.91)
    assert ok["ok"] is True

    # C. Jan declines → still in the meeting, but nothing of Jan's is accepted.
    assert (await _call(jan, "capture_consent", captureId=capture_id, decision="decline"))["consent"] == "declined"
    assert JAN in socket_module.call_registry.participants(FOXTROT_KEY)
    assert (await _say(jan, capture_id))["code"] == "consent_declined"

    # Unknown speaker (never in this meeting) and a claimed identity that is not the source's own.
    assert (await _say(eve, capture_id))["code"] == "unknown_speaker"
    assert (await _say(jan, capture_id, speakerEmail=BON))["code"] == "speaker_mismatch"

    # D. Micah joins late → pending, nothing accepted.
    micah = await _connect_as(server, MICAH)
    seen_micah = _states(micah)
    await _join(micah, MICAH)
    assert (await _consent(capture_id, MICAH)).state == "pending"
    assert await _wait(lambda: any(s["myConsent"] == "pending" for s in seen_micah))
    assert (await _say(micah, capture_id))["code"] == "consent_pending"

    # E. Micah grants → subsequent segments accepted.
    await _call(micah, "capture_consent", captureId=capture_id, decision="grant")
    assert (await _say(micah, capture_id, "late but here", start=1000, end=1500))["ok"] is True

    rows = await _segments(capture_id)
    assert [(r.speaker_email, r.text) for r in rows] == [(BON, "we ship friday"), (MICAH, "late but here")]
    bon_row = rows[0]
    assert bon_row.start_offset_ms == 100 and bon_row.end_offset_ms == 900 and bon_row.confidence == 0.91
    assert bon_row.source == "fake" and bon_row.revision == 1 and bon_row.evidence_ref is None
    assert bon_row.speaker_name == "Bon" and bon_row.created_at is not None
    await _disconnect(bon, jan, eve, micah)


async def test_segment_timing_and_shape_are_validated_by_the_server(server):
    bon = await _connect_as(server, BON)
    await _join(bon, BON)
    capture_id = (await _call(bon, "capture_start"))["captureId"]
    await _call(bon, "capture_consent", captureId=capture_id, decision="grant")
    assert (await _say(bon, capture_id, start=-1, end=10))["code"] == "invalid_segment"
    assert (await _say(bon, capture_id, start=500, end=100))["code"] == "invalid_segment"
    assert (await _say(bon, capture_id, "   "))["code"] == "invalid_segment"
    assert (await _say(bon, capture_id, confidence=1.5))["code"] == "invalid_segment"
    # A segment claiming to end an hour after the capture started, seconds after it started, is refused.
    assert (await _say(bon, capture_id, start=0, end=3_600_000))["code"] == "offset_out_of_range"
    # Re-delivery of the same source revision is a duplicate; a corrected revision is a new row.
    assert (await _say(bon, capture_id, "v1", segmentRef="s-1"))["ok"] is True
    assert (await _say(bon, capture_id, "v1", segmentRef="s-1"))["code"] == "duplicate_segment"
    assert (await _say(bon, capture_id, "v2", segmentRef="s-1", revision=2))["ok"] is True
    await _disconnect(bon)


# ---- F + G: rejoin keeps the decision; a new capture needs a new one ---------------------------------------


async def test_leave_and_rejoin_keeps_consent_and_a_second_capture_needs_fresh_consent(server):
    bon, jan = await _connect_as(server, BON), await _connect_as(server, JAN)
    await _join(bon, BON)
    await _join(jan, JAN)
    first = (await _call(bon, "capture_start"))["captureId"]
    await _call(bon, "capture_consent", captureId=first, decision="grant")
    assert (await _say(bon, first, "before"))["ok"]

    # F. Bon leaves (Jan keeps the meeting alive) and rejoins: same capture, same decision.
    await bon.emit("call_left", {})
    assert await _wait(lambda: BON not in socket_module.call_registry.participants(FOXTROT_KEY))
    await _join(bon, BON)
    assert (await _consent(first, BON)).state == "granted"
    now = await _elapsed_ms(first)
    assert (await _say(bon, first, "after rejoin", start=now, end=now + 100))["ok"] is True

    # Stop: no more segments, nothing deleted. Host passed to Jan when Bon left, so Jan stops it.
    assert (await _call(jan, "capture_stop"))["ok"] is True
    stopped = await _capture(first)
    assert stopped.stopped_at is not None and stopped.stop_reason == "stopped"
    assert (await _say(bon, first, "too late"))["code"] == "capture_stopped"
    assert len(await _segments(first)) == 2

    # G. A new capture in the same Meeting Session starts with no carried-over consent.
    second = (await _call(jan, "capture_start"))["captureId"]
    assert second != first
    assert (await _capture(second)).meeting_session_id == stopped.meeting_session_id
    assert (await _consent(second, BON)).state == "pending"
    assert (await _say(bon, second))["code"] == "consent_pending"
    await _disconnect(bon, jan)


# ---- stop / end / emptied / restart ------------------------------------------------------------------------


async def test_meeting_end_stops_capture_and_later_ingestion_is_refused(server):
    bon, jan = await _connect_as(server, BON), await _connect_as(server, JAN)
    seen_jan = _states(jan)
    await _join(bon, BON)
    await _join(jan, JAN)
    capture_id = (await _call(bon, "capture_start"))["captureId"]
    await _call(bon, "capture_consent", captureId=capture_id, decision="grant")
    assert (await _say(bon, capture_id))["ok"]

    await bon.emit("meeting_end", {"meetingId": FOXTROT})

    async def stopped():
        return (await _capture(capture_id)).stopped_at is not None

    assert await _wait(stopped)
    assert (await _capture(capture_id)).stop_reason == "meeting_ended"
    assert await _wait(lambda: any(s["capture"] and not s["capture"]["active"] for s in seen_jan))
    assert (await _say(bon, capture_id))["code"] == "meeting_not_live"
    assert len(await _segments(capture_id)) == 1  # kept
    await _disconnect(bon, jan)


async def test_an_emptied_meeting_stops_its_capture_after_the_grace(server):
    bon = await _connect_as(server, BON)
    await _join(bon, BON)
    capture_id = (await _call(bon, "capture_start"))["captureId"]
    await bon.emit("call_left", {})

    async def stopped():
        return (await _capture(capture_id)).stopped_at is not None

    assert await _wait(stopped)
    assert (await _capture(capture_id)).stop_reason == "meeting_emptied"
    await _disconnect(bon)


async def test_restart_closes_an_orphaned_active_capture_truthfully(server):
    started = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with async_session_maker() as db:
        await session_repo.create(
            db, session_id="orphan-6b", meeting_key=FOXTROT, room_id="floor-2/foxtrot", scheduled_meeting_id=None,
            kind="instant", is_private=False, started_by_email=BON, started_at=started,
        )
        capture = await capture_repo.create(
            db, meeting_session_id="orphan-6b", started_by_email=BON, started_at=started, source="fake"
        )
        consent = await capture_repo.ensure_pending(db, capture.id, BON)
        consent.state = "granted"
        await db.commit()
        capture_id = capture.id

    # Before recovery runs, the dead process's capture already accepts nothing: it is not live here.
    with pytest.raises(meeting_capture.CaptureError) as err:
        await meeting_capture.ingest_segment(
            capture_id, meeting_capture.SourceIdentity(BON, "fake"), meeting_capture.SegmentIn(0, 10, "x"),
            now=datetime.now(timezone.utc),
        )
    assert err.value.code == "meeting_not_live"

    await meeting_sessions.close_orphans(now=datetime.now(timezone.utc))
    row = await _capture(capture_id)
    assert row.stopped_at is not None and row.stop_reason == "server_restart"


# ---- reads: meeting_access only ------------------------------------------------------------------------------


async def test_transcript_reads_follow_meeting_access_not_attendance_consent_or_room(server):
    await _book(invitees=(BON, JAN, MICAH))
    org, bon = await _connect_as(server, ORG), await _connect_as(server, BON)
    session_id = await _join(org, ORG)
    await _join(bon, BON)
    capture_id = (await _call(org, "capture_start"))["captureId"]
    await _call(org, "capture_consent", captureId=capture_id, decision="grant")
    assert (await _say(org, capture_id, "decision: ship"))["ok"]

    # Micah was invited, never attended, never consented — and may read the transcript.
    res = await _read(session_id, MICAH)
    assert res.status_code == 200
    body = res.json()
    assert body["sessionId"] == session_id
    [cap] = body["captures"]
    assert cap["captureId"] == capture_id and cap["startedBy"] == ORG and cap["source"] == "fake"
    [seg] = cap["segments"]
    assert seg["speakerEmail"] == ORG and seg["text"] == "decision: ship" and seg["evidenceRef"] is None
    assert "consents" not in cap

    # Eve is nobody to this meeting; standing in Foxtrot changes nothing. Same 404 as a missing id.
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")
    assert (await _read(session_id, EVE)).status_code == 404
    socket_module.room_presence.leave(EVE)
    assert (await _read("no-such-session", ORG)).status_code == 404
    await _disconnect(org, bon)


async def test_a_private_meeting_keeps_its_boundary_for_capture_state_and_transcript(server):
    await _book(private=True, invitees=(BON, MICAH))
    org, bon, eve = await _connect_as(server, ORG), await _connect_as(server, BON), await _connect_as(server, EVE)
    seen_eve = _states(eve)
    session_id = await _join(org, ORG)
    await _join(bon, BON)
    # Eve cannot enter the private meeting's call, so she can neither start nor contribute.
    await eve.emit("call_joined", {"meetingId": FOXTROT})
    await asyncio.sleep(0.15)
    assert EVE not in socket_module.call_registry.participants(FOXTROT_KEY)
    assert (await _call(eve, "capture_start"))["code"] == "not_participant"

    capture_id = (await _call(org, "capture_start"))["captureId"]
    assert (await _say(eve, capture_id))["code"] == "unknown_speaker"
    await _call(bon, "capture_consent", captureId=capture_id, decision="grant")
    assert (await _say(bon, capture_id, "private words"))["ok"]
    await asyncio.sleep(0.1)
    assert seen_eve == []  # capture state never reaches an outsider

    assert (await _read(session_id, MICAH)).status_code == 200  # invited, absent
    assert (await _read(session_id, EVE)).status_code == 404
    await _disconnect(org, bon, eve)


async def test_the_dev_segment_source_is_disabled_outside_development(server):
    bon = await _connect_as(server, BON)
    await _join(bon, BON)
    capture_id = (await _call(bon, "capture_start"))["captureId"]
    settings.APP_ENV = "production"
    try:
        assert (await _say(bon, capture_id))["code"] == "disabled"
    finally:
        settings.APP_ENV = "development"
    await _disconnect(bon)


# ---- transcript timing must fall inside a real attendance interval ------------------------------------------


async def test_spoken_time_must_fall_inside_an_attendance_interval(server, monkeypatch):
    monkeypatch.setattr(meeting_capture, "ATTENDANCE_TOLERANCE_MS", 50)
    bon, jan = await _connect_as(server, BON), await _connect_as(server, JAN)
    await _join(bon, BON)
    await _join(jan, JAN)  # keeps the meeting alive while Bon is away
    cid = (await _call(bon, "capture_start"))["captureId"]
    await _call(bon, "capture_consent", captureId=cid, decision="grant")

    # 1. attending now → accepted
    t = await _elapsed_ms(cid)
    assert (await _say(bon, cid, "now", start=max(0, t - 100), end=t))["ok"] is True
    before_leave = await _elapsed_ms(cid)
    await asyncio.sleep(0.3)

    await bon.emit("call_left", {})
    assert await _wait(lambda: BON not in socket_module.call_registry.participants(FOXTROT_KEY))
    await asyncio.sleep(0.4)
    # 2. a DELAYED result for speech made before he left, received after → accepted, no connection needed
    assert (await _say(bon, cid, "delayed", start=before_leave, end=before_leave + 200))["ok"] is True
    # 3. speech claiming to happen after he left → refused, consent notwithstanding
    t = await _elapsed_ms(cid)
    assert (await _say(bon, cid, "ghost", start=t - 100, end=t))["code"] == "not_attending"
    gap = t - 100

    await asyncio.sleep(0.3)
    await _join(bon, BON)
    await asyncio.sleep(0.2)
    # 4. the rejoin interval stands on its own
    t = await _elapsed_ms(cid)
    assert (await _say(bon, cid, "back", start=t - 50, end=t))["ok"] is True
    # 5. entirely inside the leave/rejoin gap → refused
    assert (await _say(bon, cid, "gap", start=gap, end=gap + 50))["code"] == "not_attending"
    # a span crossing the leave is not covered by any single interval → refused
    assert (await _say(bon, cid, "span", start=before_leave, end=t))["code"] == "not_attending"
    # attendance never implies consent: Jan attended the whole time and has not granted
    assert (await _say(jan, cid, "jan", start=0, end=10))["code"] == "consent_pending"
    texts = [r.text for r in await _segments(cid)]
    assert texts == ["now", "delayed", "back"]
    await _disconnect(bon, jan)


# ---- instant meeting invitees are visible to the meeting's own people (Go Together candidates) ----------------


async def test_presence_lists_the_invited_only_to_authorized_viewers(server):
    alex_email = "alex@example.com"
    alex, bon, eve = await _connect_as(server, alex_email), await _connect_as(server, BON), await _connect_as(server, EVE)
    jan = await _connect_as(server, JAN)  # an invitation needs its recipient online
    seen: dict[str, list] = {BON: [], EVE: [], alex_email: []}
    for who, c in ((BON, bon), (EVE, eve), (alex_email, alex)):
        c.on("meeting_presence", lambda d, who=who: seen[who].append(d["meetings"]))
    await _join(alex, alex_email)
    await alex.emit("meeting_invite", {"toEmail": BON, "meetingId": FOXTROT})
    await alex.emit("meeting_invite", {"toEmail": JAN, "meetingId": FOXTROT})

    def entry(who):
        return next((m for m in (seen[who][-1] if seen[who] else []) if m["meetingId"] == FOXTROT), None)

    assert await _wait(lambda: (entry(BON) or {}).get("invited") == [BON, JAN])
    assert entry(alex_email)["invited"] == [BON, JAN]
    assert entry(EVE) is not None and "invited" not in entry(EVE)
    # Accepting is not joining: Bon has no attendance and no consent until he actually connects.
    session_id = meeting_sessions.session_id_for(FOXTROT_KEY)
    async with async_session_maker() as db:
        assert [a for a in await session_repo.attendance(db, session_id) if a.email == BON] == []
    await _disconnect(alex, bon, eve, jan)
