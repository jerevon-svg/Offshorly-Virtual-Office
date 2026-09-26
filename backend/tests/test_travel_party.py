from __future__ import annotations

from app.services.travel_party import MAX_PARTY_MEMBERS, TravelPartyRegistry, sanitize_destination, wire

# Go Together V1 — the registry alone: membership, one-party-per-person, the departure fact, and which
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


def test_depart_moves_the_leader_floor_and_filters_members() -> None:
    reg = TravelPartyRegistry()
    p = _party(reg)
    reg.add_member(p["partyId"], "b@x.com", "s-b")
    reg.gather(p["partyId"], "floor-1")
    assert p["phase"] == "gathering"
    reg.gather(p["partyId"], None)
    assert p["phase"] == "travelling" and p["gather_floor"] is None
    reg.gather(p["partyId"], "floor-1")
    d = reg.depart(p["partyId"], from_floor="floor-1", to_floor="floor-2", members=["B@x.com", "stranger@x.com"])
    assert d == {"partyId": p["partyId"], "departureId": f"{p['partyId']}:1", "fromFloor": "floor-1", "toFloor": "floor-2", "members": ["b@x.com"]}
    assert p["leader_floor"] == "floor-2" and p["phase"] == "travelling"


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
    assert w["pending"] == ["z@x.com"] and w["leaderFloor"] == "floor-1" and "leader_sid" not in w
