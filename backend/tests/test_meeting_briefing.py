from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from app.models.meeting_session import KIND_INSTANT
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.repositories import meeting_captures as capture_repo
from app.services import meeting_briefing
from tests.test_meeting_continuity import JAN, _occurrence, _series
from tests.test_meeting_intelligence import (  # noqa: F401 — db_ready is the shared autouse fixture
    BON,
    EVE,
    MICAH,
    ORG,
    T0,
    _capture,
    _http,
    async_session_maker,
    db_ready,
)
from tests.test_meeting_receipt import (
    no_bookings,  # noqa: F401 — no_bookings is autouse
)
from tests.test_organizational_memory import _intel

# PHASE 9C — Pre-Meeting Briefing: the upcoming booking gates who may ask; 8C's pairwise rule picks related
# past sessions; each passes meeting_access on its own; only structured, effective, evidence-backed items
# are composed; no status, cause, supersession or resolution is ever invented; a hidden session leaves no trace.

pytestmark = pytest.mark.asyncio


async def _upcoming(title: str = "Product Sync", invitees=(BON, MICAH, EVE), *, hours: float = 3,
                    status: str = "scheduled", private: bool = False) -> str:
    start = datetime.now(timezone.utc) + timedelta(hours=hours)
    async with async_session_maker() as db:
        b = ScheduledMeeting(title=title, room_id="floor-2/alpha", organizer_email=ORG, starts_at=start,
                             ends_at=start + timedelta(minutes=30), is_private=private, status=status)
        db.add(b)
        await db.flush()
        for who in {ORG, *invitees}:
            db.add(ScheduledMeetingInvitee(meeting_id=b.id, email=who))
        await db.commit()
        return b.id


async def _past(sid: str, day: int, lines, *, speaker: str = ORG, **kw) -> tuple[str, list[str]]:
    """A related past Product Sync (roster ORG, MICAH, EVE; BON attended, EVE invited and absent)."""
    await _series(sid, day, **kw)
    lines = [line if isinstance(line, tuple) else (speaker, line) for line in lines]
    return sid, await _capture(sid, lines)


async def _brief(booking_id: str, email: str, status: int = 200) -> dict:
    async with _http() as http:
        res = await http.get(f"/scheduled-meetings/{booking_id}/briefing", headers={"x-dev-email": email})
    assert res.status_code == status, res.text
    return res.json()


async def _available(ids, email: str) -> list[str]:
    async with _http() as http:
        res = await http.post("/scheduled-meetings/briefings/availability", json={"ids": ids},
                              headers={"x-dev-email": email})
    assert res.status_code == 200, res.text
    return res.json()["available"]


def _src(body: dict) -> list[str]:
    return [s["sessionId"] for s in body["sources"]]


def _texts(body: dict, key: str) -> list[str]:
    return [e["text"] for e in body[key]]


# ---- the booking gate + which past sessions relate --------------------------------------------------------


async def test_authorized_caller_gets_a_briefing_of_related_sessions_only():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, ["Okay, launch Friday."])
    await _intel(a, [("decision", {"text": "Launch on Friday"}, "confirmed", sa)])
    other, so = await _past("b-other", 1, ["Budget is fixed."], title="Budget review")  # unrelated title
    await _intel(other, [("decision", {"text": "Budget fixed"}, "confirmed", so)])
    room, sr = await _past("b-room", 2, ["Room talk."], title="Standup")  # same room, same roster, other title
    await _intel(room, [("decision", {"text": "Standup moved"}, "confirmed", sr)])
    await _occurrence("b-inst", 3, None, kind=KIND_INSTANT)  # same room, no booking
    similar, ss = await _past("b-sim", 4, ["x"], title="Product Sync 2")
    await _intel(similar, [("decision", {"text": "Similar only"}, "confirmed", ss)])

    body = await _brief(up, EVE)
    assert body["meeting"]["id"] == up and body["meeting"]["title"] == "Product Sync" and body["available"] is True
    assert _src(body) == [a] and body["sources"][0]["relation"] == "same_series"
    assert _texts(body, "decisions") == ["Launch on Friday"]
    raw = json.dumps(body)
    for leaked in ("b-other", "b-room", "b-inst", "b-sim", "Budget", "Standup", "Similar"):
        assert leaked not in raw
    assert await _available([up], EVE) == [up]


async def test_caller_not_on_the_booking_gets_not_found_and_no_availability():
    up = await _upcoming(invitees=(BON, MICAH))
    a, sa = await _past("b-a", 0, ["Launch Friday."], invitees=(MICAH, JAN))
    await _intel(a, [("decision", {"text": "Launch on Friday"}, "confirmed", sa)])
    # JAN may read the past session but is not on the upcoming booking.
    assert (await _brief(up, JAN, 404)) == {"error": "Meeting not found"}
    assert await _available([up], JAN) == []
    assert (await _brief("nope", BON, 404)) == {"error": "Meeting not found"}
    cancelled = await _upcoming(status="cancelled")
    ended = await _upcoming(hours=-2)
    await _brief(cancelled, BON, 404)
    await _brief(ended, BON, 404)


async def test_same_booking_restart_relates_and_instant_meetings_never_do():
    up = await _upcoming()
    earlier = await _occurrence("b-restart", 0, up)  # an earlier occurrence of this very booking
    segs = await _capture(earlier, [(ORG, "We agreed to ship.")])
    await _intel(earlier, [("decision", {"text": "Ship it"}, "confirmed", segs)])
    inst = await _occurrence("b-inst", 1, None, kind=KIND_INSTANT)
    si = await _capture(inst, [(ORG, "Instant chat.")])
    await _intel(inst, [("decision", {"text": "Instant decision"}, "confirmed", si)])
    body = await _brief(up, BON)
    assert _src(body) == [earlier] and body["sources"][0]["relation"] == "same_booking"
    assert "Instant" not in json.dumps(body)


# ---- authorization of the past ----------------------------------------------------------------------------


async def test_hidden_related_session_leaks_nothing_and_changes_nothing():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, ["Launch Friday."])
    await _intel(a, [("decision", {"text": "Launch on Friday"}, "confirmed", sa),
                     ("open_loop", {"text": "Pricing", "kind": "unresolved_issue"}, "confirmed", sa)])
    c, sc = await _past("b-c", 14, ["QA is a condition."])
    await _intel(c, [("decision", {"text": "QA stays a condition"}, "confirmed", sc)])
    before = await _brief(up, EVE)

    # Between them: a related Product Sync EVE was never invited to — private, BON attended.
    b, sb = await _past("b-b", 7, ["Secret pricing is $99."], invitees=(MICAH,), private=True)
    await _intel(b, [("decision", {"text": "Secret pricing set"}, "confirmed", sb),
                     ("open_loop", {"text": "Pricing", "kind": "unresolved_issue"}, "confirmed", sb)])
    after = await _brief(up, EVE)
    assert after == before  # no source, count, date, gap, grouping or wording difference at all
    raw = json.dumps(after)
    assert b not in raw and "Secret" not in raw and "$99" not in raw
    # BON may read it, so it relates for BON (private, 2 shared people, Jaccard 1/2).
    bon = await _brief(up, BON)
    assert b in _src(bon) and next(s for s in bon["sources"] if s["sessionId"] == b)["isPrivate"] is True
    [pricing] = bon["openLoops"]
    assert [r["sessionId"] for r in pricing["recorded"]] == [a, b]


async def test_upcoming_invite_grants_no_access_to_past_sessions():
    # JAN is on the upcoming booking, but was not on any past occurrence and never attended.
    up = await _upcoming(invitees=(BON, MICAH, EVE, JAN))
    a, sa = await _past("b-a", 0, ["Private talk."], private=True)
    await _intel(a, [("decision", {"text": "Private decision"}, "confirmed", sa)])
    body = await _brief(up, JAN)
    assert body["available"] is False and body["sources"] == [] and "Private decision" not in json.dumps(body)
    assert await _available([up], JAN) == []


async def test_invited_but_absent_history_contributes():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, ["Launch Friday."])
    await _intel(a, [("decision", {"text": "Launch on Friday"}, "confirmed", sa)])
    body = await _brief(up, EVE)  # EVE was invited to b-a, never attended
    assert body["sources"][0]["viewer"] == {"attended": False} and _texts(body, "decisions") == ["Launch on Friday"]
    assert (await _brief(up, BON))["sources"][0]["viewer"] == {"attended": True}


# ---- decisions and change ---------------------------------------------------------------------------------


async def test_decisions_are_chronological_proposals_are_not_decisions_and_no_supersession():
    up = await _upcoming()
    c, sc = await _past("b-c", 14, ["Friday stays the target pending QA."])
    await _intel(c, [("decision", {"text": "Friday remains the target pending QA"}, "confirmed", sc)])
    a, sa = await _past("b-a", 0, ["What about Thursday?"])
    await _intel(a, [("key_point", {"text": "Thursday was proposed"}, "confirmed", sa)])
    b, sb = await _past("b-b", 7, ["Launch Thursday.", "Launch Friday."])
    await _intel(b, [("decision", {"text": "Launch Thursday"}, "confirmed", [sb[0]]),
                     ("decision", {"text": "Launch Friday"}, "suggested", [sb[1]])])
    body = await _brief(up, EVE)
    assert _texts(body, "decisions") == ["Launch Thursday", "Launch Friday", "Friday remains the target pending QA"]
    assert [d["sessionId"] for d in body["decisions"]] == [b, b, c]
    assert all(d["recordedChange"] is False and d["rationale"] is None for d in body["decisions"])
    assert _texts(body, "keyContext") == ["Thursday was proposed"]  # a proposal is context, never a decision
    raw = json.dumps(body).lower()
    assert "supersed" not in raw and "replaced" not in raw and "because" not in raw


async def test_explicit_change_wording_supports_a_change_but_no_cause_is_composed():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, ["We're moving launch from Thursday to Friday because QA needs another day."])
    await _intel(a, [("decision", {"text": "Move launch from Thursday to Friday",
                                   "rationale": "QA needs another day"}, "confirmed", sa)])
    b, sb = await _past("b-b", 7, ["Launch Monday."])
    await _intel(b, [("decision", {"text": "Launch Monday"}, "confirmed", sb)])
    body = await _brief(up, EVE)
    moved, monday = body["decisions"]
    assert moved["recordedChange"] is True and moved["rationale"] == "QA needs another day"
    assert moved["text"] == "Move launch from Thursday to Friday"  # its own recorded words
    assert monday["recordedChange"] is False and monday["rationale"] is None  # no cause invented for a difference


# ---- commitments ------------------------------------------------------------------------------------------


async def test_commitments_keep_owner_and_deadline_carry_no_status_and_identify_the_caller():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, [(MICAH, "I'll check deployment by Friday."), (EVE, "I'll prepare the QA checklist."),
                                   (ORG, "Eve, could you also update the docs?")])
    await _intel(a, [
        ("commitment", {"text": "Check deployment", "action": "Check deployment", "ownerEmail": MICAH,
                        "deadline": "by Friday"}, "confirmed", [sa[0]]),
        ("commitment", {"text": "Prepare the QA checklist", "ownerEmail": EVE, "deadline": None}, "suggested", [sa[1]]),
        # a request to EVE that she never accepted: the owner is who spoke, not who was named
        ("key_point", {"text": "Eve was asked to update the docs"}, "suggested", [sa[2]]),
    ])
    body = await _brief(up, EVE)
    mine, micah = body["commitments"]  # the caller's own first
    assert mine["text"] == "Prepare the QA checklist" and mine["isYours"] is True and mine["deadline"] is None
    assert mine["reviewState"] == "suggested"
    assert micah["ownerEmail"] == MICAH and micah["deadline"] == "by Friday" and micah["isYours"] is False
    assert "Eve was asked to update the docs" not in _texts(body, "commitments")
    for c in body["commitments"]:
        assert not {"status", "pending", "overdue", "completed", "active", "done"} & set(c)
    raw = json.dumps(body).lower()
    assert "overdue" not in raw and "completed" not in raw and "still needs" not in raw
    assert all(c["isYours"] is False for c in (await _brief(up, BON))["commitments"])


# ---- open loops -------------------------------------------------------------------------------------------


async def test_open_loops_are_historical_grouped_and_never_resolved():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, ["Pricing is unresolved."])
    await _intel(a, [("open_loop", {"text": "Pricing", "kind": "unresolved_issue"}, "confirmed", sa)])
    b, sb = await _past("b-b", 7, ["Pricing still open.", "Pricing set at ten dollars."])
    await _intel(b, [("open_loop", {"text": " pricing ", "kind": "unresolved_issue"}, "suggested", [sb[0]]),
                     ("decision", {"text": "Pricing set at ten dollars"}, "confirmed", [sb[1]])])
    c, sc = await _past("b-c", 14, ["Hiring plan is open."])
    await _intel(c, [("open_loop", {"text": "Hiring plan", "kind": "deferred_decision"}, "confirmed", sc)])
    body = await _brief(up, EVE)
    pricing, hiring = body["openLoops"]
    assert [r["sessionId"] for r in pricing["recorded"]] == [a, b] and pricing["sessionId"] == b  # latest accessible
    assert hiring["kind"] == "deferred_decision" and [r["sessionId"] for r in hiring["recorded"]] == [c]
    for o in body["openLoops"]:
        assert not {"resolved", "resolvedBy", "status", "stillOpen"} & set(o)
    assert _texts(body, "decisions") == ["Pricing set at ten dollars"]  # shown as its own decision, not a resolution
    wording = json.dumps([{k: v for k, v in o.items() if k != "kind"} for o in body["openLoops"]]).lower()
    assert "resolved" not in wording


# ---- review, stale, transcript-only, evidence ---------------------------------------------------------------


async def test_edited_wording_used_rejected_excluded_and_reviewed_preferred():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, [f"Line {n}" for n in range(12)])
    items = [("decision", {"text": "Launch Fri"}, "edited", [sa[0]], {"text": "Launch on Friday, pending QA"}),
             ("decision", {"text": "Rejected idea"}, "rejected", [sa[1]])]
    items += [("decision", {"text": f"Suggestion {n}"}, "suggested", [sa[2 + n]]) for n in range(10)]
    await _intel(a, items)
    body = await _brief(up, EVE)
    texts = _texts(body, "decisions")
    assert len(texts) == meeting_briefing.MAX_DECISIONS and "Launch on Friday, pending QA" in texts
    assert "Launch Fri" not in texts and "Rejected idea" not in json.dumps(body)
    edited = next(d for d in body["decisions"] if d["text"].startswith("Launch"))
    assert edited["reviewState"] == "edited"
    assert body["sources"][0]["review"] == "partly"


async def test_stale_item_with_current_evidence_is_kept_and_flagged_but_superseded_evidence_drops_it():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, ["Keep QA as a condition."])
    await _intel(a, [("decision", {"text": "QA stays a condition"}, "confirmed", sa)], stale=True)
    b = await _series("b-b", 7)
    sb = await _capture(b, [(ORG, "Onboarding starts in October.", "u1", 1)])
    await _intel(b, [("decision", {"text": "Onboarding in October"}, "confirmed", sb)])
    async with async_session_maker() as db:
        [cap] = await capture_repo.for_session(db, b)
        await capture_repo.add_segment(
            db, capture_id=cap.id, speaker_email=ORG, speaker_name=None, start_offset_ms=0, end_offset_ms=500,
            text="Onboarding starts in November.", confidence=0.95, source="fake", source_segment_ref="u1",
            revision=2, created_at=T0 + timedelta(minutes=40), evidence_ref=None,
        )
        await db.commit()
    body = await _brief(up, EVE)
    [kept] = body["decisions"]
    assert kept["text"] == "QA stays a condition" and kept["stale"] is True
    assert "October" not in json.dumps(body) and "November" not in json.dumps(body)
    by = {s["sessionId"]: s for s in body["sources"]}
    assert by[b]["stale"] is True and by[b]["omittedStale"] == 1 and by[b]["notes"] == "nothing_useful"
    assert by[a]["stale"] is True and by[a]["omittedStale"] == 0


async def test_transcript_only_and_note_free_history_make_no_claims():
    up = await _upcoming()
    await _past("b-t", 0, ["We will launch on Thursday, I'll check deployment."])  # transcript, no run
    await _series("b-n", 1)  # no transcript, no run
    body = await _brief(up, EVE)
    assert body["available"] is False
    assert [s["notes"] for s in body["sources"]] == ["transcript_only", "none"]
    assert not (body["decisions"] or body["commitments"] or body["openLoops"] or body["keyContext"])
    assert "Thursday" not in json.dumps(body)
    assert await _available([up], EVE) == []


async def test_evidence_belongs_to_the_items_own_session():
    up = await _upcoming()
    a, sa = await _past("b-a", 0, ["Launch Friday."])
    b, _ = await _past("b-b", 7, ["Unrelated words."])
    await _intel(a, [("decision", {"text": "Launch on Friday"}, "confirmed", sa)])
    # b's item cites a's line: cross-session evidence is never current evidence → left out
    await _intel(b, [("decision", {"text": "Borrowed evidence"}, "confirmed", [sa[0]])])
    body = await _brief(up, EVE)
    [d] = body["decisions"]
    assert d["sessionId"] == a and [e["text"] for e in d["evidence"]] == ["Launch Friday."]
    assert "Borrowed" not in json.dumps(body)


async def test_no_related_history_is_an_honest_empty_briefing():
    up = await _upcoming(title="Brand new sync")
    a, sa = await _past("b-a", 0, ["Launch Friday."])
    await _intel(a, [("decision", {"text": "Launch on Friday"}, "confirmed", sa)])
    body = await _brief(up, EVE)
    assert body["available"] is False and body["sources"] == [] and body["decisions"] == []
    assert await _available([up, "nope"], EVE) == []


async def test_availability_lists_only_useful_bookings_the_caller_is_on():
    useful = await _upcoming()
    empty = await _upcoming(title="Something else")
    notmine = await _upcoming(invitees=(MICAH,))
    a, sa = await _past("b-a", 0, ["Launch Friday."], invitees=(MICAH, EVE, BON))
    await _intel(a, [("decision", {"text": "Launch on Friday"}, "confirmed", sa)])
    assert await _available([useful, empty, notmine, useful], EVE) == [useful]
