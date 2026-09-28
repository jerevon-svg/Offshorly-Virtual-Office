from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlencode

import pytest

from app.models.meeting_session import KIND_INSTANT
from app.realtime import socket as socket_module
from app.repositories import meeting_sessions as session_repo
from tests.test_meeting_intelligence import (  # noqa: F401 — db_ready is the shared autouse fixture
    BON,
    EVE,
    MICAH,
    ORG,
    T0,
    _capture,
    _generate,
    _get,
    _meeting,
    _review,
    async_session_maker,
    db_ready,
)
from tests.test_meeting_receipt import _booked, no_bookings  # noqa: F401 — no_bookings is autouse

# PHASE 8A — Meeting Memory: the caller's ended Meeting Sessions, paged, searched and filtered ONLY inside
# what meeting_access lets them read; attended vs invited-but-absent from real attendance; the preview is
# the latest succeeded run's ACTIVE, effective content; no-intelligence and stale meetings stay listed.

pytestmark = pytest.mark.asyncio


async def _ended(session_id: str, hours: float) -> None:
    async with async_session_maker() as db:
        s = await session_repo.get(db, session_id)
        s.ended_at = T0 + timedelta(hours=hours)
        await db.commit()


async def _memory(email: str, **params) -> dict:
    res = await _get(f"memory?{urlencode(params)}", email)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(body: dict) -> list[str]:
    return [r["sessionId"] for r in body["sessions"]]


async def test_lists_only_readable_ended_sessions_with_attendance_relation():
    booked = await _booked("m-booked")
    await _ended(booked, 3)
    instant = await _meeting("m-instant", kind=KIND_INSTANT, started_by=EVE)  # EVE + BON attended
    await _ended(instant, 2)
    await _meeting("m-live", ended=False)
    private = await _booked("m-private", private=True)
    await _ended(private, 1)
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")  # standing in the room grants nothing

    assert _ids(await _memory(BON)) == [booked, instant, private]
    assert _ids(await _memory(MICAH)) == [booked, private]  # invited, never attended; instant was not shared
    assert _ids(await _memory(EVE)) == [instant]  # not the private Foxtrot meeting she is standing in
    assert (await _memory("stranger@example.com"))["sessions"] == []

    row = (await _memory(MICAH))["sessions"][0]
    assert row["title"] == "Launch sync" and row["kind"] == "scheduled" and row["roomId"] == "floor-2/foxtrot"
    assert row["attendeeCount"] == 2 and row["durationMs"] == 3 * 3_600_000
    assert row["viewer"] == {"attended": False}  # invitation ≠ attendance
    assert (await _memory(BON))["sessions"][0]["viewer"] == {"attended": True}
    assert row["intelligence"] is None and row["match"] is None  # no receipt yet — still listed


async def test_pages_past_the_recent_limit_with_a_stable_cursor():
    for n in range(25):
        await _meeting(f"m-{n:02d}")
        await _ended(f"m-{n:02d}", 1 + n / 10)
    seen, cursor, pages = [], None, 0
    while True:
        body = await _memory(BON, limit=10, **({"cursor": cursor} if cursor else {}))
        seen += _ids(body)
        pages += 1
        cursor = body["nextCursor"]
        if cursor is None:
            break
    assert pages == 3 and len(seen) == 25 and len(set(seen)) == 25
    assert seen == [f"m-{n:02d}" for n in reversed(range(25))]  # newest ended first
    bad = await _get("memory?cursor=not-a-cursor", BON)
    assert bad.status_code == 422 and bad.json() == {"error": "invalid_cursor"}
    assert (await _get("memory?filter=everything", BON)).status_code == 422


async def test_search_covers_title_attendee_intelligence_and_room_within_access_only():
    booked = await _booked("m-launch")
    await _ended(booked, 3)
    other = await _meeting("m-other", room="floor-2/golf")
    await _capture(other, [(ORG, "Pricing review"), (BON, "decision: raise the starter tier")])
    assert (await _generate(other)).status_code == 201
    await _ended(other, 2)
    hidden = await _meeting("m-hidden", kind=KIND_INSTANT, started_by=EVE)  # MICAH has no access
    await _capture(hidden, [(EVE, "decision: raise the starter tier")])
    assert (await _generate(hidden, EVE)).status_code == 201

    by_title = await _memory(MICAH, q="LAUNCH")
    assert _ids(by_title) == [booked] and by_title["sessions"][0]["match"] == {"kind": "title"}
    by_text = await _memory(MICAH, q="starter tier")
    assert _ids(by_text) == [other]  # never EVE's meeting that says the same words
    assert by_text["sessions"][0]["match"]["kind"] == "intelligence"
    assert by_text["sessions"][0]["match"]["itemType"] == "decision"
    assert by_text["sessions"][0]["match"]["reviewState"] == "suggested"
    by_person = await _memory(MICAH, q="bon@")
    assert set(_ids(by_person)) == {booked, other} and by_person["sessions"][0]["match"]["kind"] == "attendee"
    assert _ids(await _memory(MICAH, q="micah")) == []  # invited only — not an attendee match
    assert _ids(await _memory(MICAH, q="golf")) == [other]
    assert _ids(await _memory(EVE, q="launch")) == []
    assert _ids(await _memory(MICAH, q="100%_")) == []  # LIKE wildcards are literal


async def test_filters_attended_and_absent():
    booked = await _booked("m-a")
    await _ended(booked, 2)
    plain = await _meeting("m-b")
    await _ended(plain, 1)
    async with async_session_maker() as db:  # MICAH dropped into m-b for a while
        await session_repo.open_attendance(db, plain, MICAH, at=T0 + timedelta(minutes=5))
        await session_repo.close_attendance(db, plain, MICAH, at=T0 + timedelta(minutes=9))
        await db.commit()
    assert _ids(await _memory(MICAH, filter="attended")) == [plain]
    assert _ids(await _memory(MICAH, filter="absent")) == [booked]
    assert _ids(await _memory(MICAH, filter="all")) == [booked, plain]
    assert _ids(await _memory(BON, filter="absent")) == []


async def test_preview_uses_effective_active_content_and_marks_stale():
    sid = await _meeting("m-intel")
    await _capture(sid, [(ORG, "Kickoff"), (BON, "decision: ship Friday"), (ORG, "decision: drop the beta"),
                         (BON, "commit: write the notes"), (ORG, "open: who signs off")])
    run = (await _generate(sid)).json()
    by_text = {i["content"]["text"]: i["itemId"] for i in run["items"]}
    assert (await _review(sid, by_text["ship Friday"], action="edit", content={"text": "Ship on Friday 3 Oct"})).status_code == 200
    assert (await _review(sid, by_text["drop the beta"], action="reject")).status_code == 200

    preview = (await _memory(MICAH))["sessions"][0]["intelligence"]
    assert preview["decisions"] == [{"text": "Ship on Friday 3 Oct", "reviewState": "edited"}]
    assert preview["counts"] == {"decisions": 1, "commitments": 1, "openLoops": 1}
    assert preview["reviewedCount"] == 1 and preview["stale"] is False and preview["runVersion"] == 1
    assert preview["summary"]["reviewState"] == "suggested"
    assert _ids(await _memory(MICAH, q="drop the beta")) == []  # rejected is not active intelligence
    assert _ids(await _memory(MICAH, q="3 oct")) == [sid]  # the human's wording is searchable
    assert _ids(await _memory(MICAH, q="ship friday")) == []  # …and replaced the generated wording

    await _capture(sid, [(BON, "one more thing")])  # the transcript moved on after generation
    row = (await _memory(MICAH))["sessions"][0]
    assert row["intelligence"]["stale"] is True and row["sessionId"] == sid  # still listed, marked stale


async def test_room_context_narrows_within_access_and_never_grants():
    foxtrot = await _booked("m-fox")
    await _ended(foxtrot, 2)
    golf = await _meeting("m-golf", room="floor-2/golf")
    await _ended(golf, 1)
    private = await _booked("m-fox-private", private=True)
    await _ended(private, 3)
    assert _ids(await _memory(BON, roomId="floor-2/foxtrot")) == [private, foxtrot]
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")
    assert _ids(await _memory(EVE, roomId="floor-2/foxtrot")) == []


async def test_recent_still_works_on_the_shared_candidate_query():
    sid = await _booked("m-recent")
    rows = (await _get("recent", MICAH)).json()["sessions"]
    assert [r["sessionId"] for r in rows] == [sid]
