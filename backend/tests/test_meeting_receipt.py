from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import delete

from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
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
    async_session_maker,
    db_ready,
)

# PHASE 7C — the Meeting Receipt's session reads: identity, planned vs actual, ACTUAL attendance, curate
# capability, and the recent list — all behind meeting_access (the room grants nothing).

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def no_bookings():
    async with async_session_maker() as db:
        await db.execute(delete(ScheduledMeetingInvitee))
        await db.execute(delete(ScheduledMeeting))
        await db.commit()


async def _booked(session_id: str, **meeting) -> str:
    """A scheduled session tied to a real booking (title + planned window), MICAH invited and absent."""
    async with async_session_maker() as db:
        booking = ScheduledMeeting(
            title="Launch sync", room_id="floor-2/foxtrot", organizer_email=ORG, starts_at=T0,
            ends_at=T0 + timedelta(minutes=30), is_private=False,
        )
        db.add(booking)
        await db.flush()
        db.add(ScheduledMeetingInvitee(meeting_id=booking.id, email=MICAH))
        await db.commit()
        booking_id = booking.id
    await _meeting(session_id, **meeting)
    async with async_session_maker() as db:
        s = await session_repo.get(db, session_id)
        s.scheduled_meeting_id = booking_id
        await db.commit()
    return session_id


async def test_session_detail_shows_planned_actual_and_only_real_attendees():
    sid = await _booked("s-1")
    res = await _get(sid, MICAH)  # invited, never attended — may read
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Launch sync" and body["kind"] == "scheduled" and body["roomId"] == "floor-2/foxtrot"
    assert body["planned"]["startsAt"].startswith("2026-09-28T09:00") and body["planned"]["organizerEmail"] == ORG
    assert body["startedAt"].startswith("2026-09-28T09:00") and body["endedAt"].startswith("2026-09-28T10:00")
    emails = [a["email"] for a in body["attendees"]]
    assert set(emails) == {ORG, BON}
    assert MICAH not in emails  # invitation ≠ attendance
    org = next(a for a in body["attendees"] if a["email"] == ORG)
    assert org["leftAt"].startswith("2026-09-28T10:00") and org["presentMs"] == 3_600_000 and len(org["intervals"]) == 1
    assert body["viewer"] == {"mayCurate": False}
    assert (await _get(sid, ORG)).json()["viewer"] == {"mayCurate": True}


async def test_instant_session_has_no_invented_plan():
    sid = await _meeting("s-inst", kind="instant", started_by=BON)
    body = (await _get(sid, BON)).json()
    assert body["title"] is None and body["planned"] is None and body["startedBy"] == BON
    assert body["viewer"]["mayCurate"] is True


async def test_session_reads_are_gated_and_the_room_grants_nothing():
    sid = await _booked("s-private", private=True)
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")
    res = await _get(sid, EVE)
    assert res.status_code == 404 and res.json() == {"error": "Not found"}
    assert (await _get("no-such", ORG)).status_code == 404
    assert (await _get("recent", EVE)).json() == {"sessions": []}


async def test_recent_lists_readable_ended_sessions_newest_first_with_intelligence_flag():
    old = await _meeting("s-old")
    await _capture(old, [(ORG, "decision: go")])
    assert (await _generate(old)).status_code == 201
    newer = await _booked("s-new")
    async with async_session_maker() as db:  # ended later than s-old
        s = await session_repo.get(db, newer)
        s.ended_at = T0 + timedelta(hours=3)
        await db.commit()
    await _meeting("s-live", ended=False)  # still running → not a Receipt yet

    for reader in (ORG, BON, MICAH):
        rows = (await _get("recent", reader)).json()["sessions"]
        assert [r["sessionId"] for r in rows] == [newer, old], reader
    new_row, old_row = (await _get("recent", MICAH)).json()["sessions"]
    assert new_row["title"] == "Launch sync" and new_row["attendeeCount"] == 2 and new_row["hasIntelligence"] is False
    assert old_row["title"] is None and old_row["hasIntelligence"] is True
