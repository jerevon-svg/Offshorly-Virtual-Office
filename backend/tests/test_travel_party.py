from __future__ import annotations

from app.services.travel_party import MAX_PARTY_MEMBERS, TravelPartyRegistry, sanitize_destination, wire

# Go Together — the registry alone: membership, one-party-per-person, the journey stages, and which
# socket drives each body across a reload.

DEST = {"floor": "floor-2", "roomId": "floor-2/alpha", "label": "Alpha"}


def _party(reg: TravelPartyRegistry, leader: str = "lead@x.com") -> dict:
    return reg.create(leader_email=leader, leader_sid="s-lead", destination=DEST, leader_floor="floor-1")


def test_destination_is_shape_checked_and_stays_opaque() -> None:
    assert sanitize_destination({"floor": "floor-2"}) is None  # no label
    assert sanitize_destination("alpha") is None
    got = sanitize_destination({
        "floor": "floor-2", "label": " Alpha ", "roomId": "floor-2/alpha",
        "point": {"x": 1, "z": float("nan")}, "context": {"kind": "scheduled_meeting", "id": "m1"}, "extra": 1,
    })
    assert got == {"floor": "floor-2", "label": "Alpha", "roomId": "floor-2/alpha", "context": {"kind": "scheduled_meeting", "id": "m1"}}


def test_one_party_per_person_and_join_order_is_kept() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    assert reg.add_member(p["partyId"], "B@x.com", "s-b")
    assert reg.add_member(p["partyId"], "c@x.com", "s-c")
    assert not reg.add_member(p["partyId"], "b@x.com", "s-b2")  # already in
    other = _party(reg, "other@x.com")
    assert not reg.add_member(other["partyId"], "c@x.com", "s-c")  # in another party
    assert not reg.add_member(p["partyId"], "lead@x.com", "s")  # the leader is not a member
    assert reg.people(p) == ["lead@x.com", "b@x.com", "c@x.com"]
    assert reg.party_of("C@x.com") is p


def test_capacity() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    for i in range(MAX_PARTY_MEMBERS):
        assert reg.add_member(p["partyId"], f"m{i}@x.com", f"s{i}")
    assert not reg.add_member(p["partyId"], "late@x.com", "s")


def test_end_is_single_shot_and_frees_everyone() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    reg.add_member(p["partyId"], "b@x.com", "s-b")
    assert reg.end(p["partyId"]) is p
    assert reg.end(p["partyId"]) is None
    assert reg.party_of("lead@x.com") is None and reg.party_of("b@x.com") is None


def test_lost_driver_survives_a_reload_but_a_second_tab_cannot_steal() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    reg.add_member(p["partyId"], "b@x.com", "s-b")
    assert not reg.claim(p["partyId"], "b@x.com", "s-b2")  # the first tab is still alive
    assert reg.orphan_sid("s-b") == [(p["partyId"], "b@x.com")]
    assert reg.still_lost(p["partyId"], "b@x.com") and reg.controller_sid(p, "b@x.com") is None
    assert reg.claim(p["partyId"], "b@x.com", "s-b2")
    assert not reg.still_lost(p["partyId"], "b@x.com") and reg.controller_sid(p, "b@x.com") == "s-b2"
    assert reg.orphan_sid("s-unrelated") == []


def test_follow_state_is_edge_triggered_and_on_the_wire() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    reg.add_member(p["partyId"], "b@x.com", "s-b")
    assert not reg.set_following(p["partyId"], "b@x.com", True)
    assert reg.set_following(p["partyId"], "b@x.com", False)
    w = wire(p, pending=["z@x.com"])
    assert w["members"] == [{"email": "b@x.com", "following": False, "connected": True}]
    assert w["pending"] == ["z@x.com"] and w["leaderFollowing"] is True and "leader_sid" not in w


# ---- Phase 2: form → start walking → gather → ready -------------------------------------------------

from app.services.travel_party import TOGETHER_SPREAD, choose_rendezvous  # noqa: E402


def _where(reg, p, email, x, z, room="design-team", floor="floor-1") -> None:
    assert reg.report_where(p["partyId"], email, floor=floor, room_id=room, point={"x": x, "z": z})


def test_a_party_is_born_forming_and_start_needs_somebody_who_accepted() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    assert p["stage"] == "forming" and wire(p)["stage"] == "forming" and wire(p)["rendezvous"] is None
    assert reg.start(p["partyId"]) is None  # nobody accepted yet
    reg.add_member(p["partyId"], "b@x.com", "s-b")
    rv = reg.start(p["partyId"])
    assert rv is not None and p["stage"] == "gathering"
    assert p["participants"] == ["lead@x.com", "b@x.com"]
    assert reg.start(p["partyId"]) is None  # single-shot
    assert not reg.report_where(p["partyId"], "b@x.com", floor="floor-1", room_id=None, point={"x": 0, "z": 0})


def test_central_hub_rule() -> None:
    people = ["a", "b", "c"]
    near = {"floor": "floor-1", "roomId": "design-team"}
    together = {e: {**near, "point": {"x": 100 + i * 40, "z": 100}} for i, e in enumerate(people)}
    got = choose_rendezvous(together, people)
    assert got == {"kind": "here", "floor": "floor-1", "roomId": "design-team", "point": {"x": 100, "z": 100}}  # the leader's spot
    # different rooms → hub
    assert choose_rendezvous({**together, "c": {**together["c"], "roomId": "dev-room"}}, people) == {"kind": "hub"}
    # different floors → hub
    assert choose_rendezvous({**together, "c": {**together["c"], "floor": "floor-2"}}, people) == {"kind": "hub"}
    # one room, too spread out → hub
    far = {**together, "c": {**near, "point": {"x": 100 + TOGETHER_SPREAD + 1, "z": 100}}}
    assert choose_rendezvous(far, people) == {"kind": "hub"}
    # somebody never reported → hub (never guess)
    assert choose_rendezvous({"a": together["a"], "b": together["b"]}, people) == {"kind": "hub"}
    # both outside any room, close → one area
    corridor = {e: {"floor": "floor-1", "roomId": None, "point": {"x": i * 30, "z": 0}} for i, e in enumerate(people)}
    assert choose_rendezvous(corridor, people)["kind"] == "here"


def test_start_decides_from_the_reports_in() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    reg.add_member(p["partyId"], "b@x.com", "s-b")
    _where(reg, p, "lead@x.com", 0, 0)
    _where(reg, p, "b@x.com", 50, 0)
    assert reg.start(p["partyId"])["kind"] == "here"
    q = _party(reg, "q@x.com")
    reg.add_member(q["partyId"], "c@x.com", "s-c")
    _where(reg, q, "q@x.com", 0, 0)
    _where(reg, q, "c@x.com", 50, 0, room="dev-room")
    assert reg.start(q["partyId"])["kind"] == "hub"


def test_gathered_only_when_every_active_participant_said_ready() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    for e in ("b@x.com", "c@x.com"):
        reg.add_member(p["partyId"], e, f"s-{e}")
    rv = reg.start(p["partyId"])
    assert not reg.mark_ready(p["partyId"], "b@x.com", "wrong-stage")
    assert reg.mark_ready(p["partyId"], "b@x.com", rv["stageId"])
    assert not reg.mark_ready(p["partyId"], "b@x.com", rv["stageId"])  # once
    assert reg.mark_ready(p["partyId"], "lead@x.com", rv["stageId"])
    assert reg.finish_gathering(p["partyId"]) is None and p["stage"] == "gathering"  # c is not there yet
    # a paused member is not waited for
    reg.set_following(p["partyId"], "c@x.com", False)
    assert reg.finish_gathering(p["partyId"]) == [] and p["stage"] == "ready"
    w = wire(p)
    assert w["stage"] == "ready" and w["rendezvous"]["ready"] == ["b@x.com", "lead@x.com"]


def test_deadline_pauses_the_stuck_and_moves_the_party_on() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    for e in ("b@x.com", "c@x.com"):
        reg.add_member(p["partyId"], e, f"s-{e}")
    rv = reg.start(p["partyId"])
    reg.mark_ready(p["partyId"], "lead@x.com", rv["stageId"])
    reg.mark_ready(p["partyId"], "b@x.com", rv["stageId"])
    assert reg.finish_gathering(p["partyId"], force=True) == ["c@x.com"]
    assert p["stage"] == "ready" and p["members"]["c@x.com"]["following"] is False
    # a member who left keeps nobody else's slot from moving
    reg.remove_member(p["partyId"], "b@x.com")
    assert wire(p)["rendezvous"]["participants"] == ["lead@x.com", "b@x.com", "c@x.com"]


# ---- Phase 3: the journey legs ------------------------------------------------------------------------


def _ready_party(reg: TravelPartyRegistry, *members: str) -> dict:
    p = _party(reg)
    for e in members:
        reg.add_member(p["partyId"], e, f"s-{e}")
    rv = reg.start(p["partyId"])
    for e in reg.people(p):
        reg.mark_ready(p["partyId"], e, rv["stageId"], floor="floor-1")
    assert reg.finish_gathering(p["partyId"]) == [] and p["stage"] == "ready"
    return p


def _all_ready(reg, p) -> None:
    for e in reg.people(p):
        reg.mark_ready(p["partyId"], e, p["leg"]["stageId"])


def test_journey_legs_lift_ride_room_arrived() -> None:
    reg = TravelPartyRegistry()
    p = _ready_party(reg, "b@x.com", "c@x.com")
    leg = reg.begin_journey(p["partyId"])
    assert leg["kind"] == "to_lift" and leg["floor"] == "floor-1" and leg["toFloor"] == "floor-2"
    assert p["expect"] == ["lead@x.com", "b@x.com", "c@x.com"]
    reg.mark_ready(p["partyId"], "lead@x.com", leg["stageId"])
    assert reg.advance(p["partyId"]) is None  # the lift is a barrier: nobody rides first
    _all_ready(reg, p)
    step = reg.advance(p["partyId"])
    ride = step["leg"]
    assert ride["kind"] == "ride" and ride["riders"] == ["lead@x.com", "b@x.com", "c@x.com"]  # slot order
    assert not reg.mark_ready(p["partyId"], "b@x.com", leg["stageId"])  # a stale report never advances a later leg
    _all_ready(reg, p)
    room = reg.advance(p["partyId"])["leg"]
    assert room["kind"] == "to_room" and room["floor"] == "floor-2" and p["floor"] == "floor-2"
    _all_ready(reg, p)
    assert reg.advance(p["partyId"]) == {"leg": None, "arrived": True, "stragglers": []}
    assert wire(p)["leg"]["kind"] == "to_room"


def test_same_floor_destination_goes_straight_to_the_room() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    p["destination"] = {**DEST, "floor": "floor-1"}
    reg.add_member(p["partyId"], "b@x.com", "s-b")
    rv = reg.start(p["partyId"])
    for e in reg.people(p):
        reg.mark_ready(p["partyId"], e, rv["stageId"], floor="floor-1")
    reg.finish_gathering(p["partyId"])
    assert reg.begin_journey(p["partyId"])["kind"] == "to_room"


def test_a_paused_or_departed_member_never_holds_a_leg() -> None:
    reg = TravelPartyRegistry()
    p = _ready_party(reg, "b@x.com", "c@x.com")
    leg = reg.begin_journey(p["partyId"])
    reg.mark_ready(p["partyId"], "lead@x.com", leg["stageId"])
    reg.mark_ready(p["partyId"], "b@x.com", leg["stageId"])
    reg.set_following(p["partyId"], "c@x.com", False)  # Esc
    step = reg.advance(p["partyId"])
    assert step["leg"]["riders"] == ["lead@x.com", "b@x.com"]
    # a resumed member is not in this leg's barrier (they catch up on their own)
    reg.set_following(p["partyId"], "c@x.com", True)
    assert p["expect"] == ["lead@x.com", "b@x.com"]
    # a paused LEADER is not waited for either
    reg.mark_ready(p["partyId"], "b@x.com", step["leg"]["stageId"])
    reg.set_following(p["partyId"], "lead@x.com", False)
    assert reg.advance(p["partyId"])["leg"]["kind"] == "to_room"


def test_a_leg_deadline_pauses_the_stuck_and_moves_on() -> None:
    reg = TravelPartyRegistry()
    p = _ready_party(reg, "b@x.com")
    leg = reg.begin_journey(p["partyId"])
    reg.mark_ready(p["partyId"], "lead@x.com", leg["stageId"])
    step = reg.advance(p["partyId"], force=True)
    assert step["stragglers"] == ["b@x.com"] and p["members"]["b@x.com"]["following"] is False
    assert step["leg"]["riders"] == ["lead@x.com"]
