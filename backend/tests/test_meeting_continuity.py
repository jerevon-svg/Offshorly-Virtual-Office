from __future__ import annotations

from datetime import timedelta

import pytest

from app.models.meeting_intelligence import MeetingIntelligenceItem, MeetingIntelligenceRun
from app.models.meeting_session import KIND_INSTANT
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.realtime import socket as socket_module
from app.repositories import meeting_sessions as session_repo
from app.services.meeting_intelligence import current_transcript, fingerprint
from tests.test_meeting_intelligence import (  # noqa: F401 — db_ready is the shared autouse fixture
    BON,
    EVE,
    MICAH,
    ORG,
    T0,
    _get,
    _meeting,
    async_session_maker,
    db_ready,
)
from tests.test_meeting_receipt import no_bookings  # noqa: F401 — no_bookings is autouse

# PHASE 8C — Meeting Continuity: only deterministic relations (same booking, or same normalized title with a
# meaningful roster overlap), every related session through meeting_access before any of its content, no
# hidden gaps, effective intelligence only, and no invented transitions (resolved / changed / completed).

pytestmark = pytest.mark.asyncio

JAN = "jan@example.com"


async def _booking(title: str, invitees: list[str], *, room: str = "floor-2/foxtrot", private: bool = False) -> str:
    async with async_session_maker() as db:
        b = ScheduledMeeting(
            title=title, room_id=room, organizer_email=ORG, starts_at=T0, ends_at=T0 + timedelta(minutes=30),
            is_private=private,
        )
        db.add(b)
        await db.flush()
        for who in {ORG, *invitees}:
            db.add(ScheduledMeetingInvitee(meeting_id=b.id, email=who))
        await db.commit()
        return b.id


async def _occurrence(sid: str, day: int, booking_id: str | None, *, private: bool = False, room: str = "floor-2/foxtrot",
                      kind: str | None = None) -> str:
    """A session `day` days after T0 (ORG + BON attended), tied to `booking_id`."""
    await _meeting(sid, private=private, room=room, **({"kind": kind} if kind else {}))
    async with async_session_maker() as db:
        s = await session_repo.get(db, sid)
        s.started_at = T0 + timedelta(days=day)
        s.ended_at = T0 + timedelta(days=day, hours=1)
        s.scheduled_meeting_id = booking_id
        await db.commit()
    return sid


async def _series(sid: str, day: int, title: str = "Product Sync", invitees=(MICAH, EVE), **kw) -> str:
    return await _occurrence(sid, day, await _booking(title, list(invitees), **kw), private=kw.get("private", False))


async def _intel(sid: str, items: list[tuple], *, stale: bool = False) -> list[str]:
    """A succeeded run on `sid` with (type, content, review_state[, reviewed_content]) items. Returns item ids."""
    async with async_session_maker() as db:
        fp = fingerprint(await current_transcript(db, sid))
        run = MeetingIntelligenceRun(
            meeting_session_id=sid, version=1, status="succeeded", generator="stub-v1", requested_by_email=ORG,
            started_at=T0, completed_at=T0, source_segment_ids=[], source_segment_count=0,
            source_fingerprint="stale" if stale else fp,
        )
        db.add(run)
        await db.flush()
        ids = []
        for n, (item_type, content, state, *edited) in enumerate(items):
            it = MeetingIntelligenceItem(
                run_id=run.id, item_type=item_type, position=n, content=content, review_state=state,
                reviewed_content=edited[0] if edited else None, confidence=0.9,
            )
            db.add(it)
            await db.flush()
            ids.append(it.id)
        await db.commit()
        return ids


async def _timeline(sid: str, email: str) -> dict:
    res = await _get(f"{sid}/continuity", email)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(body: dict) -> list[str]:
    return [e["sessionId"] for e in body["events"]]


async def test_series_is_same_title_plus_roster_overlap_in_chronological_order():
    a = await _series("c-a", 0)
    b = await _series("c-b", 7, title="  product   SYNC ")  # normalized title matches
    c = await _series("c-c", 14)
    await _series("c-other", 3, title="Design review")  # unrelated title
    await _series("c-thin", 5, invitees=(JAN,))  # same title, roster {ORG, JAN}: 1 shared → not related
    await _occurrence("c-room", 6, None, kind=KIND_INSTANT)  # same room, no booking → never related
    await _series("c-similar", 8, title="Product Sync 2")  # merely similar

    body = await _timeline(b, BON)
    assert _ids(body) == [a, b, c]
    assert [e["isCurrent"] for e in body["events"]] == [False, True, False]
    assert [e["relation"] for e in body["events"]] == ["same_series", None, "same_series"]
    assert body["events"][0]["title"] == "Product Sync" and body["events"][0]["viewer"] == {"attended": True}


async def test_same_booking_restart_is_related_even_without_series_match():
    bid = await _booking("Standup", [MICAH])
    first = await _occurrence("c-1", 0, bid)
    second = await _occurrence("c-2", 1, bid)
    body = await _timeline(second, BON)
    assert _ids(body) == [first, second] and body["events"][0]["relation"] == "same_booking"


async def test_room_alone_and_instant_meetings_create_no_continuity():
    await _series("c-a", 0, title="Sprint planning")
    cur = await _series("c-b", 1, title="Budget")  # same room, same roster, different title
    inst = await _occurrence("c-i", 2, None, kind=KIND_INSTANT)
    assert _ids(await _timeline(cur, BON)) == [cur]
    assert _ids(await _timeline(inst, BON)) == [inst]


async def test_every_related_session_is_authorized_and_a_hidden_middle_leaks_nothing():
    a = await _series("c-a", 0)  # roster ORG, MICAH, EVE — EVE invited
    b = await _series("c-b", 7, invitees=(MICAH,))  # EVE not invited, never attended
    await _intel(b, [("decision", {"text": "Secret pricing decided"}, "confirmed")])
    c = await _series("c-c", 14)
    body = await _timeline(c, EVE)
    assert _ids(body) == [a, c]
    raw = str(body)
    assert b not in raw and "Secret" not in raw
    # a → c are adjacent for EVE; nothing counts or names the gap
    assert set(body["events"][1]) == {
        "sessionId", "isCurrent", "relation", "title", "kind", "isPrivate", "roomId", "startedAt", "endedAt",
        "viewer", "intelligence", "change",
    }
    # BON (attended all) sees all three
    assert _ids(await _timeline(c, BON)) == [a, b, c]
    # EVE cannot open b's continuity at all
    assert (await _get(f"{b}/continuity", EVE)).status_code == 404
    assert (await _get(f"{a}/continuity", "stranger@example.com")).status_code == 404


async def test_private_related_meeting_stays_private_even_for_someone_in_the_room():
    a = await _series("c-a", 0)
    p = await _series("c-p", 7, invitees=(MICAH,), private=True)
    c = await _series("c-c", 14)
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")  # standing in the room grants nothing
    assert p not in _ids(await _timeline(c, EVE))
    assert p in _ids(await _timeline(c, MICAH))
    # the 8A room-context seam grants nothing either
    res = await _get("memory?roomId=floor-2/foxtrot", EVE)
    assert res.status_code == 200 and p not in [r["sessionId"] for r in res.json()["sessions"]]
    assert {a, c} <= {r["sessionId"] for r in res.json()["sessions"]}


async def test_authorized_but_absent_meeting_appears_as_shared():
    a = await _series("c-a", 0)
    c = await _series("c-c", 7)
    body = await _timeline(c, MICAH)  # invited to both, attended neither
    assert _ids(body) == [a, c] and [e["viewer"]["attended"] for e in body["events"]] == [False, False]


async def test_effective_state_stale_and_no_intelligence():
    a = await _series("c-a", 0)
    b = await _series("c-b", 7)
    c = await _series("c-c", 14)
    await _intel(a, [
        ("decision", {"text": "Launch Thursday"}, "suggested"),
        ("decision", {"text": "Old wording"}, "edited", {"text": "Launch Friday, pending QA"}),
        ("decision", {"text": "Rejected idea"}, "rejected"),
        ("commitment", {"text": "Jan will check deployment", "ownerEmail": JAN}, "confirmed"),
        ("open_loop", {"text": "Pricing unresolved", "kind": "deferred_decision"}, "suggested"),
    ], stale=True)
    body = await _timeline(b, BON)
    first, mid = body["events"][0], body["events"][1]
    intel = first["intelligence"]
    assert intel["stale"] is True
    assert [d["text"] for d in intel["decisions"]] == ["Launch Thursday", "Launch Friday, pending QA"]
    assert [d["reviewState"] for d in intel["decisions"]] == ["suggested", "edited"]
    assert "Rejected idea" not in str(body)
    assert intel["counts"] == {
        "decisions": 2, "decisionsReviewed": 1, "commitments": 1, "commitmentsReviewed": 1,
        "openLoops": 1, "openLoopsReviewed": 0,
    }
    assert intel["commitments"][0]["ownerEmail"] == JAN
    assert intel["openLoops"][0]["kind"] == "deferred_decision"
    assert mid["intelligence"] is None and mid["change"] is None  # no receipt: still in the timeline
    assert _ids(body) == [a, b, c]


async def test_no_invented_resolution_change_or_completion():
    a = await _series("c-a", 0)
    b = await _series("c-b", 7)
    await _intel(a, [
        ("decision", {"text": "Launch Thursday"}, "confirmed"),
        ("commitment", {"text": "Jan will check deployment", "ownerEmail": JAN}, "confirmed"),
        ("open_loop", {"text": "Pricing unresolved", "kind": "deferred_decision"}, "confirmed"),
        ("open_loop", {"text": "QA owner", "kind": "unowned_action"}, "confirmed"),
    ])
    await _intel(b, [
        ("decision", {"text": "Launch Friday"}, "confirmed"),
        ("decision", {"text": "Pricing decision confirmed"}, "confirmed"),
        ("key_point", {"text": "Deployment discussed again"}, "confirmed"),
        ("open_loop", {"text": "  qa   OWNER ", "kind": "unowned_action"}, "suggested"),
    ])
    body = await _timeline(b, BON)
    change = body["events"][1]["change"]
    assert change["sinceSessionId"] == a
    # the only transition asserted: the same open loop raised again (normalized exact text)
    assert [r["text"] for r in change["raisedAgain"]] == ["qa OWNER"]
    assert set(change) == {"sinceSessionId", "raisedAgain"}  # no "resolved", "superseded" or "completed"
    def keys(node):
        if isinstance(node, dict):
            for k, v in node.items():
                yield k.lower()
                yield from keys(v)
        elif isinstance(node, list):
            for v in node:
                yield from keys(v)

    for word in ("resolv", "supersed", "complet", "status", "changed"):
        assert not [k for k in keys(body) if word in k]  # no field that could carry an invented transition
    # both decisions stay as separate chronological facts
    assert [d["text"] for d in body["events"][0]["intelligence"]["decisions"]] == ["Launch Thursday"]
    assert [d["text"] for d in body["events"][1]["intelligence"]["decisions"]] == ["Launch Friday", "Pricing decision confirmed"]


async def test_window_is_capped_around_the_current_session():
    ids = [await _series(f"c-{n}", n) for n in range(9)]
    body = await _timeline(ids[4], BON)
    assert _ids(body) == ids[1:8]
    assert _ids(await _timeline(ids[0], BON)) == ids[0:4]
