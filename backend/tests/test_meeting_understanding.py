from __future__ import annotations

import socket
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.models.meeting_intelligence import MeetingIntelligenceItem
from app.realtime import socket as socket_module
from app.repositories import meeting_captures as capture_repo
from app.services.intelligence_fixtures import FIXTURES
from app.services.intelligence_generator import ItemDraft
from tests.test_meeting_intelligence import (  # noqa: F401 — db_ready is the shared autouse fixture
    BON,
    EVE,
    MICAH,
    ORG,
    T0,
    _capture,
    _generate,
    _generate_with,
    _get,
    _meeting,
    _review,
    _Stub,
    async_session_maker,
    db_ready,
)

# PHASE 7B — Meeting Understanding. Over the 7A run/item/evidence pipeline and the real REST routes:
#   * the development fixtures exercise every item type with the 7B distinctions (discussion ≠ decision,
#     request ≠ commitment, answered question ≠ open loop, hedged offer = medium confidence);
#   * the server enforces the contract on ANY generator: per-type shape, confidence bands, stated
#     uncertainty, and a commitment owner who actually spoke in its evidence — else the whole run fails;
#   * review, staleness, versioning and meeting_access behave exactly as in 7A with structured content.

pytestmark = pytest.mark.asyncio

JAN = "jan@example.com"
ANGELO = "angelo@example.com"
ROLES = {"A": ORG, "B": BON, "J": JAN, "M": ANGELO}


async def _fixture_meeting(name: str, session_id: str = "s-7b", **meeting) -> tuple[str, list[str]]:
    sid = await _meeting(session_id, **meeting)
    seg = await _capture(sid, [(ROLES[role], text) for role, text in FIXTURES[name].lines])
    return sid, seg


def _of(run: dict, item_type: str) -> list[dict]:
    return [i for i in run["items"] if i["type"] == item_type]


def _cites(item: dict) -> list[str]:
    return [e["segmentId"] for e in item["evidence"]]


async def _item_rows(run_id: str) -> int:
    async with async_session_maker() as db:
        q = select(func.count()).select_from(MeetingIntelligenceItem).where(MeetingIntelligenceItem.run_id == run_id)
        return (await db.execute(q)).scalar_one()


# ---- the understanding the fixtures demonstrate ---------------------------------------------------------------


async def test_summary_and_topics_are_grounded_in_the_meeting():
    sid, seg = await _fixture_meeting("launch-planning")
    run = (await _generate(sid)).json()
    assert run["status"] == "succeeded" and run["generator"] == "fake-v2"

    [summary] = _of(run, "summary")
    assert "Friday" in summary["content"]["text"] and ORG in summary["content"]["text"]  # display name = speaker
    assert summary["confidence"] is None and summary["confidenceLevel"] is None and summary["evidence"] == []

    topics = _of(run, "topic")
    assert [t["content"]["text"] for t in topics] == ["Launch date", "Pricing", "Launch follow-ups"]
    for t in topics:
        assert t["evidence"] and t["confidenceLevel"] == "high"
    assert _cites(topics[0]) == [seg[1], seg[3], seg[4]]


async def test_an_explicit_decision_is_recorded_and_a_suggestion_is_not():
    sid, seg = await _fixture_meeting("launch-planning")
    run = (await _generate(sid)).json()
    decisions = _of(run, "decision")
    assert [d["content"]["text"] for d in decisions] == ["Launch on Friday.", "Price at $20."]
    friday = decisions[0]
    assert _cites(friday) == [seg[4], seg[5]]  # "Okay, let's launch Friday." + "Agreed, Friday it is."
    assert friday["confidenceLevel"] == "high" and friday["content"]["rationale"]
    assert not any("Thursday" in d["content"]["text"] for d in decisions)
    assert not any(seg[1] in _cites(d) or seg[2] in _cites(d) for d in decisions)  # the suggestion/deferral

    # A suggestion followed only by a deferral is no decision — it stays open.
    other, oseg = await _fixture_meeting("undecided-launch", "s-undecided")
    undecided = (await _generate(other)).json()
    assert _of(undecided, "decision") == []
    [loop] = _of(undecided, "open_loop")
    assert loop["content"]["kind"] == "deferred_decision" and _cites(loop) == oseg


async def test_an_accepted_request_is_the_speakers_commitment_with_the_stated_timeframe():
    sid, seg = await _fixture_meeting("launch-planning")
    run = (await _generate(sid)).json()
    [firm] = _of(run, "commitment")

    assert firm["content"]["ownerEmail"] == JAN  # the persisted speaker who accepted
    assert firm["content"]["action"] == "Check deployment" and firm["content"]["deadline"] == "this afternoon"
    assert _cites(firm) == [seg[9], seg[11]]  # the request (by ORG) and the acceptance (by JAN)
    assert [e["speakerEmail"] for e in firm["evidence"]] == [ORG, JAN]
    assert firm["confidenceLevel"] == "high"

    # "I can probably take a look" (ANGELO) — a hedge, not a commitment, and not turned into anything else.
    assert not any(seg[12] in _cites(i) for i in run["items"] if i["type"] != "topic")

    # "Bon should handle the homepage copy." said by ORG → no Bon commitment, an unowned open loop instead.
    assert all(c["content"]["ownerEmail"] != BON for c in _of(run, "commitment"))
    unowned = next(o for o in _of(run, "open_loop") if o["content"]["kind"] == "unowned_action")
    assert _cites(unowned) == [seg[10]] and unowned["uncertainty"]


async def test_a_request_nobody_accepts_is_not_a_commitment():
    sid, seg = await _fixture_meeting("unanswered-request")
    run = (await _generate(sid)).json()
    assert _of(run, "commitment") == []
    [loop] = _of(run, "open_loop")
    assert loop["content"]["kind"] == "unowned_action" and _cites(loop) == seg


async def test_an_explicit_ill_is_a_commitment_and_might_or_if_needed_is_not():
    sid, seg = await _fixture_meeting("hedged-offers")
    run = (await _generate(sid)).json()
    [notes] = _of(run, "commitment")
    assert notes["content"] == {
        "text": f"{JAN} will send the release notes tomorrow.", "action": "Send the release notes",
        "deadline": "tomorrow", "ownerEmail": JAN,
    }
    assert _cites(notes) == [seg[3]] and notes["confidenceLevel"] == "high"
    # "I might be able to do it." (BON) / "I can look into it if needed." (ANGELO) → nobody's commitment.
    assert not any(c["content"]["ownerEmail"] in (BON, ANGELO) for c in _of(run, "commitment"))
    [loop] = _of(run, "open_loop")  # the changelog is independently unowned — "someone needs to" + no taker
    assert loop["content"]["kind"] == "unowned_action" and _cites(loop) == seg[:3]


async def test_open_loops_are_what_remained_unresolved_at_the_end():
    sid, seg = await _fixture_meeting("launch-planning")
    run = (await _generate(sid)).json()
    loops = _of(run, "open_loop")
    approval = next(o for o in loops if o["content"]["kind"] == "unanswered_question")
    assert approval["content"]["text"] == "Who will approve pricing is unresolved."
    assert _cites(approval) == [seg[13], seg[14]]  # the question and the non-answer
    # "What are we charging?" was answered later ("we agreed on $20") → a decision, not an open loop,
    # and the Thursday/Friday debate resolved too.
    assert not any(seg[6] in _cites(o) or seg[1] in _cites(o) for o in loops)
    assert {o["content"]["kind"] for o in loops} == {"unanswered_question", "unowned_action"}

    [key_point] = _of(run, "key_point")  # not a copy of a decision/commitment/open loop
    assert key_point["content"]["text"] == "Thursday clashes with the client demo." and _cites(key_point) == [seg[3]]


async def test_multi_segment_evidence_is_ordered_and_carries_speakers():
    sid, seg = await _fixture_meeting("launch-planning")
    run = (await _generate(sid)).json()
    price = _of(run, "decision")[1]
    assert [(e["segmentId"], e["position"], e["speakerEmail"]) for e in price["evidence"]] == [
        (seg[6], 0, ORG), (seg[7], 1, BON), (seg[8], 2, ORG),
    ]
    assert price["evidence"][2]["text"] == "Yes, we agreed on $20."


async def test_a_fixture_needs_one_distinct_speaker_per_role():
    # Same words, but one person "agrees" with themself — the fixture does not apply; the marker fallback does.
    sid = await _meeting("s-solo")
    await _capture(sid, [(ORG, t) for _, t in FIXTURES["undecided-launch"].lines])
    run = (await _generate(sid)).json()
    assert {i["type"] for i in run["items"]} == {"summary", "key_point"}


# ---- the contract, enforced on any generator ------------------------------------------------------------------


async def test_malformed_structured_content_fails_the_whole_run():
    sid = await _meeting("s-1")
    [ask, other] = await _capture(sid, [(ORG, "Jan, can you check deployment?"), (BON, "Sounds good.")])
    ok_summary = ItemDraft(item_type="summary", content={"text": "Deployment came up."})
    ok_decision = ItemDraft(item_type="decision", content={"text": "x"}, evidence_segment_ids=(other,), confidence=0.9)

    def commit(content, *ids, c=0.9, u=None):
        return ItemDraft(item_type="commitment", content=content, evidence_segment_ids=ids or (ask,), confidence=c,
                         uncertainty=u)

    bad_items = [
        # a guessed owner: JAN is named in ORG's words but never spoke
        commit({"text": "Jan checks deployment", "ownerEmail": JAN}),
        # an owner who spoke — but not in THIS item's evidence
        commit({"text": "Bon checks deployment", "ownerEmail": BON}, ask),
        commit({"text": "x", "ownerEmail": "not-an-email"}),
        commit({"text": "x", "ownerEmail": ORG, "assignee": BON}),  # unknown key
        commit({"text": "x", "ownerEmail": ORG, "deadline": 20260930}),  # not a string
        commit({"text": "x", "ownerEmail": ORG, "deadline": ""}),
        commit({"text": "x"}),  # no owner and no stated uncertainty
        commit({"text": "x", "ownerEmail": ORG}, c=0.6),  # medium without uncertainty
        # a hedge is omitted, not down-rated: no medium commitment even with the hedge stated
        commit({"text": "Org might check", "ownerEmail": ORG}, c=0.6, u="Hedged: \"might\"."),
        commit({"text": "x", "ownerEmail": ORG}, c=0.3, u="weak"),  # below the floor: must be omitted
        commit({"text": "x", "ownerEmail": ORG}, c=None),  # every item but the summary is rated
        ItemDraft(item_type="open_loop", content={"text": "x"}, evidence_segment_ids=(ask,), confidence=0.9),
        ItemDraft(item_type="open_loop", content={"text": "x", "kind": "vibes"}, evidence_segment_ids=(ask,), confidence=0.9),
        ItemDraft(item_type="topic", content={"text": "t" * 201}, evidence_segment_ids=(ask,), confidence=0.9),
        ItemDraft(item_type="decision", content={"text": "x", "rationale": None}, evidence_segment_ids=(ask,), confidence=0.9),
        ok_summary,  # a second summary
    ]
    for bad in bad_items:
        run = await _generate_with(sid, _Stub([ok_summary, ok_decision, bad]))
        assert run["status"] == "failed" and run["failureReason"] == "invalid_output", bad
        assert run["items"] == [] and await _item_rows(run["runId"]) == 0

    too_many = [ItemDraft(item_type="topic", content={"text": f"t{n}"}, evidence_segment_ids=(ask,), confidence=0.9)
                for n in range(21)]
    assert (await _generate_with(sid, _Stub(too_many)))["failureReason"] == "invalid_output"

    # The same shapes, well-formed, pass — an ownerless commitment is fine once it says why.
    good = await _generate_with(sid, _Stub([
        ok_summary, ok_decision,
        commit({"text": "Someone checks deployment", "ownerEmail": None}, u="Requested; nobody accepted."),
        commit({"text": "Org checks it", "ownerEmail": ORG.upper(), "deadline": "Friday"}),
    ]))
    assert good["status"] == "succeeded"
    unowned, owned = _of(good, "commitment")
    assert unowned["content"]["ownerEmail"] is None and "deadline" not in unowned["content"]  # never inferred
    assert owned["content"]["ownerEmail"] == ORG and owned["content"]["deadline"] == "Friday"


async def test_cross_session_evidence_is_still_refused():
    sid, seg = await _fixture_meeting("launch-planning")
    other = await _meeting("s-other", room="floor-2/golf")
    [theirs] = await _capture(other, [(JAN, "Yes, I'll check it this afternoon.")])
    draft = ItemDraft(item_type="commitment", content={"text": "Jan checks", "ownerEmail": JAN},
                      evidence_segment_ids=(seg[9], theirs), confidence=0.9)
    run = await _generate_with(sid, _Stub([draft]))
    assert run["failureReason"] == "invalid_output" and await _item_rows(run["runId"]) == 0


# ---- review, staleness, versioning, access with structured content --------------------------------------------


async def test_generated_understanding_stays_suggested_and_review_works_on_structured_content():
    sid, _ = await _fixture_meeting("launch-planning")
    run = (await _generate(sid)).json()
    assert all(i["reviewState"] == "suggested" and i["reviewedBy"] is None for i in run["items"])
    [firm] = _of(run, "commitment")
    decision, price = _of(run, "decision")
    loop = _of(run, "open_loop")[0]

    assert (await _review(sid, decision["itemId"], action="confirm")).json()["reviewState"] == "confirmed"
    # A reviewer may set the owner/timeframe the AI could not — the speaker rule binds generators, not humans.
    edit = {"text": "Micah reviews the pricing page", "action": "Review pricing page", "ownerEmail": MICAH,
            "deadline": "Monday"}
    res = (await _review(sid, firm["itemId"], action="edit", content=edit)).json()
    assert res["reviewState"] == "edited" and res["reviewedContent"] == edit and res["content"] == firm["content"]
    assert (await _review(sid, price["itemId"], action="reject")).json()["reviewState"] == "rejected"

    for bad in ({"text": "x", "assignee": BON}, {"text": "x", "ownerEmail": "nobody"}):
        assert (await _review(sid, firm["itemId"], action="edit", content=bad)).status_code == 422
    assert (await _review(sid, loop["itemId"], action="edit", content={"text": "x", "kind": "vibes"})).status_code == 422
    assert (await _review(sid, loop["itemId"], action="edit",
                          content={"text": "Pricing approver still needed", "kind": "unowned_action"})).status_code == 200


async def test_transcript_change_marks_understanding_stale_and_regeneration_versions_it():
    sid, _ = await _fixture_meeting("launch-planning")
    v1 = (await _generate(sid)).json()
    v2 = (await _generate(sid)).json()  # same transcript → same understanding, new version
    assert (v1["version"], v2["version"]) == (1, 2)
    assert [(i["type"], i["content"]) for i in v1["items"]] == [(i["type"], i["content"]) for i in v2["items"]]
    assert {i["itemId"] for i in v1["items"]}.isdisjoint({i["itemId"] for i in v2["items"]})

    async with async_session_maker() as db:  # a late segment: someone does answer the approval question
        [cap] = await capture_repo.for_session(db, sid)
        await capture_repo.add_segment(
            db, capture_id=cap.id, speaker_email=BON, speaker_name=None, start_offset_ms=99_000, end_offset_ms=99_500,
            text="I'll approve pricing.", confidence=0.9, source="fake", source_segment_ref=None, revision=1,
            created_at=T0 + timedelta(minutes=45), evidence_ref=None,
        )
        await db.commit()
    latest = (await _get(f"{sid}/intelligence/latest", ORG)).json()
    assert latest["stale"] is True and latest["run"]["runId"] == v2["runId"]

    v3 = (await _generate(sid)).json()  # no longer the fixture → the fake's marker fallback, no open loop
    assert v3["version"] == 3 and _of(v3, "open_loop") == []
    assert (await _get(f"{sid}/intelligence/latest", ORG)).json()["stale"] is False
    old = (await _get(f"{sid}/intelligence/runs/{v1['runId']}", ORG)).json()
    assert len(_of(old, "open_loop")) == 2  # history keeps what it said


async def test_invited_absent_reader_reads_structured_understanding_and_outsiders_do_not():
    sid, _ = await _fixture_meeting("launch-planning", private=True)
    run = (await _generate(sid)).json()
    latest = await _get(f"{sid}/intelligence/latest", MICAH)  # invited, never attended
    assert latest.status_code == 200
    assert [i["content"] for i in latest.json()["run"]["items"]] == [i["content"] for i in run["items"]]
    assert (await _generate(sid, MICAH)).status_code == 403
    socket_module.room_presence.enter(EVE, "floor-2/foxtrot")
    for p in (f"{sid}/intelligence/latest", f"{sid}/intelligence/runs/{run['runId']}"):
        assert (await _get(p, EVE)).status_code == 404


async def test_understanding_needs_no_network(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    sid, _ = await _fixture_meeting("launch-planning")
    run = (await _generate(sid)).json()
    assert run["status"] == "succeeded" and len(run["items"]) == 10
