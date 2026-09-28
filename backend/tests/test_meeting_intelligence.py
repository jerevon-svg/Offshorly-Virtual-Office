from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import delete, select

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.models.meeting_capture import CaptureConsent, CaptureSession, TranscriptSegment
from app.models.meeting_intelligence import (
    MeetingIntelligenceEvidence,
    MeetingIntelligenceItem,
    MeetingIntelligenceRun,
)
from app.models.meeting_session import (
    GRANT_INVITEE,
    GRANT_ORGANIZER,
    KIND_INSTANT,
    KIND_SCHEDULED,
    MeetingSession,
    MeetingSessionAttendance,
    MeetingSessionGrant,
)
from app.realtime import socket as socket_module
from app.repositories import meeting_captures as capture_repo
from app.repositories import meeting_sessions as session_repo
from app.services import meeting_intelligence
from app.services.intelligence_generator import ItemDraft

# PHASE 7A — Meeting Intelligence Foundation. The Meeting Session / capture / transcript rows are written
# directly (their own rules are proven in test_meeting_sessions.py and test_meeting_capture.py); what is
# proven here is everything ABOVE them, over the real REST routes, with only in-process generators:
#   * a run is a new version over a settled transcript, with a stable snapshot of exactly what it analyzed;
#   * latest = highest succeeded version; failures are durable and never displace it;
#   * evidence cites only this run's own segments — never another meeting's;
#   * reads follow meeting_access (invited-but-absent reads, the room grants nothing, private stays private);
#   * generate/review need the owner; generated items stay `suggested` until a human confirms/edits/rejects.

pytestmark = pytest.mark.asyncio

ORG = "org@example.com"
BON = "bon@example.com"
MICAH = "micah@example.com"
EVE = "eve@example.com"
T0 = datetime(2026, 9, 28, 9, 0, tzinfo=timezone.utc)
TABLES = (
    MeetingIntelligenceEvidence, MeetingIntelligenceItem, MeetingIntelligenceRun, TranscriptSegment,
    CaptureConsent, CaptureSession, MeetingSessionGrant, MeetingSessionAttendance, MeetingSession,
)


@pytest.fixture(autouse=True)
async def db_ready():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for model in TABLES:
            await conn.execute(delete(model))
    meeting_intelligence._claim_locks.clear()
    yield
    socket_module.room_presence.leave(EVE)
    settings.APP_ENV = original_env


async def _meeting(
    session_id: str,
    *,
    kind: str = KIND_SCHEDULED,
    private: bool = False,
    ended: bool = True,
    room: str = "floor-2/foxtrot",
    started_by: str = ORG,
) -> str:
    """A Meeting Session: ORG organizes (scheduled), BON attended, MICAH was invited and never came."""
    async with async_session_maker() as db:
        await session_repo.create(
            db, session_id=session_id, meeting_key="mf-foxtrot", room_id=room, scheduled_meeting_id=None,
            kind=kind, is_private=private, started_by_email=started_by, started_at=T0,
        )
        if kind == KIND_SCHEDULED:
            await session_repo.add_grant(db, session_id, ORG, reason=GRANT_ORGANIZER)
            await session_repo.add_grant(db, session_id, MICAH, reason=GRANT_INVITEE)
        await session_repo.open_attendance(db, session_id, started_by, at=T0)
        await session_repo.open_attendance(db, session_id, BON, at=T0)
        if ended:
            await session_repo.close(db, session_id, at=T0 + timedelta(hours=1), reason="ended")
        await db.commit()
    return session_id


async def _capture(session_id: str, lines, *, stopped: bool = True) -> list[str]:
    """A capture with segments (speaker, text[, ref, revision]). Returns the segment ids in order."""
    ids = []
    async with async_session_maker() as db:
        cap = await capture_repo.create(
            db, meeting_session_id=session_id, started_by_email=ORG, started_at=T0 + timedelta(minutes=1), source="fake"
        )
        for n, line in enumerate(lines):
            speaker, text, *rest = line
            ref = rest[0] if rest else None
            rev = rest[1] if len(rest) > 1 else 1
            seg = await capture_repo.add_segment(
                db, capture_id=cap.id, speaker_email=speaker, speaker_name=None, start_offset_ms=n * 1000,
                end_offset_ms=n * 1000 + 500, text=text, confidence=0.9, source="fake", source_segment_ref=ref,
                revision=rev, created_at=T0 + timedelta(minutes=2, seconds=n), evidence_ref=None,
            )
            ids.append(seg.id)
        if stopped:
            await capture_repo.stop(db, cap.id, at=T0 + timedelta(minutes=30), reason="stopped")
        await db.commit()
        return ids


def _http() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


async def _generate(session_id: str, email: str = ORG) -> httpx.Response:
    async with _http() as http:
        return await http.post(f"/meeting-sessions/{session_id}/intelligence/runs", headers={"x-dev-email": email})


async def _get(path: str, email: str) -> httpx.Response:
    async with _http() as http:
        return await http.get(f"/meeting-sessions/{path}", headers={"x-dev-email": email})


async def _review(session_id: str, item_id: str, email: str = ORG, **body) -> httpx.Response:
    async with _http() as http:
        return await http.post(
            f"/meeting-sessions/{session_id}/intelligence/items/{item_id}/review", json=body,
            headers={"x-dev-email": email},
        )


async def _run_count(session_id: str) -> int:
    async with async_session_maker() as db:
        rows = await db.execute(select(MeetingIntelligenceRun).where(MeetingIntelligenceRun.meeting_session_id == session_id))
        return len(rows.scalars().all())


async def _generate_with(session_id: str, generator, email: str = ORG) -> dict:
    async with async_session_maker() as db:
        return await meeting_intelligence.generate(db, session_id, email, generator=generator)


class _Stub:
    """An in-process generator returning whatever it is told (or raising / hanging)."""

    def __init__(self, drafts=None, *, error: Exception | None = None, hang: bool = False) -> None:
        self.id = "stub-v1"
        self._drafts, self._error, self._hang = drafts or [], error, hang
        self.seen = None

    async def generate(self, source):
        self.seen = source
        if self._hang:
            await asyncio.sleep(10)
        if self._error:
            raise self._error
        return self._drafts


# ---- generation ----------------------------------------------------------------------------------------------


async def test_a_run_analyzes_a_snapshot_and_stores_suggested_items_with_real_evidence():
    sid = await _meeting("s-1")
    seg = await _capture(sid, [(ORG, "Kickoff for the homepage"), (BON, "decision: ship Friday"),
                               (BON, "commit: I will finish the homepage by Friday")])
    res = await _generate(sid)
    assert res.status_code == 201
    run = res.json()
    assert run["sessionId"] == sid and run["version"] == 1 and run["status"] == "succeeded"
    assert run["generator"] == "fake-v2" and run["requestedBy"] == ORG and run["failureReason"] is None
    assert run["completedAt"] is not None and run["startedAt"].endswith("+00:00")
    assert run["sourceSegmentIds"] == seg and run["source"]["segmentCount"] == 3
    assert run["source"]["throughAt"].startswith("2026-09-28T09:02:02")
    assert len(run["source"]["fingerprint"]) == 64

    by_type = {i["type"]: i for i in run["items"]}
    assert set(by_type) == {"summary", "key_point", "decision", "commitment"}
    for item in run["items"]:  # generated ≠ confirmed
        assert item["origin"] == "generated" and item["reviewState"] == "suggested"
        assert item["reviewedContent"] is None and item["reviewedBy"] is None
    assert by_type["summary"]["evidence"] == []
    [ev] = by_type["decision"]["evidence"]
    assert ev["segmentId"] == seg[1] and ev["speakerEmail"] == BON and ev["text"] == "decision: ship Friday"
    assert ev["startOffsetMs"] == 1000 and ev["revision"] == 1
    commitment = by_type["commitment"]
    # The marker's own speaker — a suggestion, not a task.
    assert commitment["content"] == {
        "text": "I will finish the homepage by Friday", "action": "I will finish the homepage by Friday", "ownerEmail": BON,
    }
    assert commitment["confidence"] == 0.8 and commitment["uncertainty"]

    latest = (await _get(f"{sid}/intelligence/latest", MICAH)).json()
    assert latest["run"]["runId"] == run["runId"] and latest["stale"] is False


async def test_generation_is_refused_without_a_settled_transcript_or_a_generator():
    empty = await _meeting("s-empty")
    res = await _generate(empty)
    assert res.status_code == 409 and res.json()["error"] == "no_transcript", res.text
    assert await _run_count(empty) == 0

    live = await _meeting("s-live", ended=False)
    await _capture(live, [(ORG, "still talking")])
    assert (await _generate(live)).json()["error"] == "meeting_active"

    capturing = await _meeting("s-capturing")
    await _capture(capturing, [(ORG, "hello")], stopped=False)
    assert (await _generate(capturing)).json()["error"] == "capture_active"

    done = await _meeting("s-done")
    await _capture(done, [(ORG, "hello")])
    settings.APP_ENV = "production"  # no generator exists outside development in this phase
    with pytest.raises(meeting_intelligence.IntelligenceError) as refused:
        async with async_session_maker() as db:
            await meeting_intelligence.generate(db, done, ORG)
    assert refused.value.code == "generator_unavailable"
    for s in (live, capturing, done):
        assert await _run_count(s) == 0


async def test_regeneration_versions_and_failures_never_displace_the_latest_success(monkeypatch):
    sid = await _meeting("s-1")
    await _capture(sid, [(ORG, "decision: go")])
    v1 = (await _generate(sid)).json()

    boom = RuntimeError("secret transcript words")
    v2 = await _generate_with(sid, _Stub(error=boom))
    assert v2["version"] == 2 and v2["status"] == "failed" and v2["failureReason"] == "generator_error"
    assert v2["completedAt"] is not None and v2["items"] == [] and "secret" not in str(v2)

    monkeypatch.setattr(meeting_intelligence, "GENERATION_TIMEOUT_S", 0.05)
    v3 = await _generate_with(sid, _Stub(hang=True))
    assert v3["version"] == 3 and v3["failureReason"] == "timeout"

    listing = (await _get(f"{sid}/intelligence/runs", ORG)).json()
    assert [r["version"] for r in listing["runs"]] == [3, 2, 1]
    assert listing["latestRunId"] == v1["runId"]
    assert (await _get(f"{sid}/intelligence/latest", ORG)).json()["run"]["version"] == 1

    v4 = (await _generate(sid)).json()  # retry = a new version
    assert v4["version"] == 4 and v4["status"] == "succeeded"
    assert (await _get(f"{sid}/intelligence/latest", ORG)).json()["run"]["runId"] == v4["runId"]
    old = (await _get(f"{sid}/intelligence/runs/{v1['runId']}", ORG)).json()  # history stays
    assert old["status"] == "succeeded" and len(old["items"]) == len(v1["items"])
    failed = (await _get(f"{sid}/intelligence/runs/{v2['runId']}", ORG)).json()
    assert failed["status"] == "failed" and failed["sourceSegmentIds"] == v1["sourceSegmentIds"]


async def test_evidence_must_be_a_segment_this_run_analyzed_from_the_same_meeting():
    sid = await _meeting("s-1")
    [mine] = await _capture(sid, [(BON, "we agreed")])
    other = await _meeting("s-other")
    [theirs] = await _capture(other, [(ORG, "the other meeting's secret")])

    def decision(*ids):
        return ItemDraft(item_type="decision", content={"text": "x"}, evidence_segment_ids=ids, confidence=0.9)

    for bad in (
        [decision(theirs)],  # another Meeting Session's segment
        [decision(mine, theirs)],  # even alongside a valid one
        [decision("no-such-segment")],
        [decision()],  # a decision must cite something
        [ItemDraft(item_type="task", content={"text": "x"}, evidence_segment_ids=(mine,))],
        [ItemDraft(item_type="decision", content={"no": "text"}, evidence_segment_ids=(mine,))],
        [ItemDraft(item_type="decision", content={"text": "x"}, evidence_segment_ids=(mine,), confidence=1.5)],
    ):
        run = await _generate_with(sid, _Stub(bad))
        assert run["status"] == "failed" and run["failureReason"] == "invalid_output" and run["items"] == []

    stub = _Stub([decision(mine, mine)])
    ok = await _generate_with(sid, stub)
    assert ok["status"] == "succeeded"
    assert [e["segmentId"] for e in ok["items"][0]["evidence"]] == [mine]  # deduplicated
    # The generator saw only this meeting's transcript.
    assert [s.segment_id for s in stub.seen.segments] == [mine] and stub.seen.meeting_session_id == sid
    async with async_session_maker() as db:
        cited = (await db.execute(select(MeetingIntelligenceEvidence.segment_id))).scalars().all()
    assert cited == [mine]


async def test_snapshot_is_stable_when_the_transcript_changes_and_regeneration_follows_it():
    sid = await _meeting("s-1")
    [a, b] = await _capture(sid, [(ORG, "decision: blue", "ref-a", 1), (BON, "open: budget?")])
    v1 = (await _generate(sid)).json()
    assert v1["sourceSegmentIds"] == [a, b]

    # A corrected revision of ref-a and a new segment arrive later (a future adapter's late delivery).
    async with async_session_maker() as db:
        [cap] = await capture_repo.for_session(db, sid)
        a2 = (await capture_repo.add_segment(
            db, capture_id=cap.id, speaker_email=ORG, speaker_name=None, start_offset_ms=0, end_offset_ms=500,
            text="decision: green", confidence=0.95, source="fake", source_segment_ref="ref-a", revision=2,
            created_at=T0 + timedelta(minutes=40), evidence_ref=None,
        )).id
        await db.commit()

    latest = (await _get(f"{sid}/intelligence/latest", ORG)).json()
    assert latest["stale"] is True
    run = latest["run"]
    assert run["runId"] == v1["runId"] and run["sourceSegmentIds"] == [a, b]
    assert run["source"]["fingerprint"] == v1["source"]["fingerprint"]
    decision = next(i for i in run["items"] if i["type"] == "decision")
    assert decision["evidence"][0]["segmentId"] == a and decision["evidence"][0]["text"] == "decision: blue"

    v2 = (await _generate(sid)).json()
    assert v2["sourceSegmentIds"] == [a2, b]  # the superseded revision is not analyzed again
    assert v2["source"]["fingerprint"] != v1["source"]["fingerprint"]
    assert (await _get(f"{sid}/intelligence/latest", ORG)).json()["stale"] is False


async def test_an_orphaned_running_run_blocks_nothing_after_restart_recovery():
    sid = await _meeting("s-1")
    await _capture(sid, [(ORG, "hi")])
    async with async_session_maker() as db:
        db.add(MeetingIntelligenceRun(
            meeting_session_id=sid, version=1, status="running", generator="fake-v1", requested_by_email=ORG,
            started_at=T0, source_segment_ids=[], source_segment_count=0, source_fingerprint="0" * 64,
        ))
        await db.commit()
    assert (await _generate(sid)).json()["error"] == "generation_in_progress"
    assert await meeting_intelligence.fail_orphans(now=T0 + timedelta(hours=2)) == 1
    [orphan] = (await _get(f"{sid}/intelligence/runs", ORG)).json()["runs"]
    assert orphan["status"] == "failed" and orphan["failureReason"] == "server_restart"
    assert (await _generate(sid)).json()["version"] == 2


# ---- access ---------------------------------------------------------------------------------------------------


async def test_reads_follow_meeting_access_and_the_room_grants_nothing():
    sid = await _meeting("s-1")
    await _capture(sid, [(BON, "decision: yes")])
    run = (await _generate(sid)).json()
    paths = [f"{sid}/intelligence/runs", f"{sid}/intelligence/latest", f"{sid}/intelligence/runs/{run['runId']}"]

    for reader in (ORG, BON, MICAH):  # organizer, attendee, invited-but-absent
        for p in paths:
            assert (await _get(p, reader)).status_code == 200, (reader, p)

    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")  # standing in the room opens nothing
    for p in paths:
        res = await _get(p, EVE)
        assert res.status_code == 404 and res.json() == {"error": "Not found"}
    assert (await _get("no-such-session/intelligence/latest", ORG)).status_code == 404

    # A run id from another meeting is not reachable through a session the caller can read.
    other = await _meeting("s-other", room="floor-2/golf")
    await _capture(other, [(ORG, "hi")])
    other_run = (await _generate(other)).json()
    assert (await _get(f"{sid}/intelligence/runs/{other_run['runId']}", ORG)).status_code == 404


async def test_a_private_meeting_stays_private_to_outsiders():
    sid = await _meeting("s-private", private=True)
    await _capture(sid, [(BON, "private words")])
    assert (await _generate(sid)).status_code == 201
    assert (await _get(f"{sid}/intelligence/latest", MICAH)).status_code == 200
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")
    assert (await _get(f"{sid}/intelligence/latest", EVE)).status_code == 404
    assert (await _generate(sid, EVE)).status_code == 404


async def test_generating_and_reviewing_need_the_meeting_owner_not_just_read_access():
    sid = await _meeting("s-1")
    await _capture(sid, [(BON, "decision: yes")])
    for reader in (BON, MICAH):  # may read — may not generate
        res = await _generate(sid, reader)
        assert res.status_code == 403 and res.json()["error"] == "not_allowed"
    assert (await _generate(sid, EVE)).status_code == 404
    item = (await _generate(sid, ORG)).json()["items"][0]
    assert (await _review(sid, item["itemId"], BON, action="confirm")).status_code == 403
    assert (await _review(sid, item["itemId"], EVE, action="confirm")).status_code == 404

    # Instant meeting: whoever started it curates; another attendee does not.
    inst = await _meeting("s-instant", kind=KIND_INSTANT, started_by=BON)
    await _capture(inst, [(BON, "hi")])
    assert (await _generate(inst, ORG)).status_code == 404  # ORG never took part
    assert (await _generate(inst, BON)).status_code == 201


# ---- human review ---------------------------------------------------------------------------------------------


async def test_review_confirms_edits_or_rejects_and_keeps_the_generated_original():
    sid = await _meeting("s-1")
    await _capture(sid, [(BON, "decision: ship Friday"), (BON, "commit: homepage by Friday"), (ORG, "open: who QA?")])
    run = (await _generate(sid)).json()
    items = {i["type"]: i for i in run["items"]}

    res = await _review(sid, items["decision"]["itemId"], action="confirm")
    assert res.status_code == 200
    assert res.json()["reviewState"] == "confirmed" and res.json()["reviewedBy"] == ORG

    commitment = items["commitment"]
    edited = {"text": "Bon finishes the homepage by Friday 5pm", "ownerEmail": BON}
    res = (await _review(sid, commitment["itemId"], action="edit", content=edited)).json()
    assert res["reviewState"] == "edited" and res["reviewedContent"] == edited
    assert res["content"] == commitment["content"]  # the AI original is untouched
    assert res["evidence"] == commitment["evidence"]

    res = (await _review(sid, items["open_loop"]["itemId"], action="reject")).json()
    assert res["reviewState"] == "rejected" and res["reviewedContent"] is None

    bad = [
        {"action": "edit", "content": {"no": "text"}},
        {"action": "edit"},
        {"action": "confirm", "content": {"text": "sneaky"}},
    ]
    for body in bad:
        r = await _review(sid, items["key_point"]["itemId"], **body)
        assert r.status_code == 422, body
    assert (await _review(sid, items["key_point"]["itemId"], action="approve")).status_code == 422

    latest = {i["type"]: i for i in (await _get(f"{sid}/intelligence/latest", MICAH)).json()["run"]["items"]}
    assert latest["key_point"]["reviewState"] == "suggested"
    assert latest["commitment"]["reviewState"] == "edited"

    # Regeneration: the old run's reviews stay as history, and that run can no longer be reviewed.
    v2 = (await _generate(sid)).json()
    assert all(i["reviewState"] == "suggested" for i in v2["items"])
    r = await _review(sid, items["key_point"]["itemId"], action="confirm")
    assert r.status_code == 409 and r.json()["error"] == "run_superseded"
    old = {i["type"]: i for i in (await _get(f"{sid}/intelligence/runs/{run['runId']}", ORG)).json()["items"]}
    assert old["decision"]["reviewState"] == "confirmed" and old["commitment"]["reviewedContent"] == edited
