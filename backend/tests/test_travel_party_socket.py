from __future__ import annotations

import asyncio

import pytest
import socketio
import uvicorn

from app.config import settings
from app.database import Base, engine
from app.main import app as combined_app
from app.realtime import socket as socket_module

# Go Together over a live server: invite → accept → form → gather → journey legs → arrive, the refusals,
# and the leader's End. Same live-uvicorn fixture shape as tests/test_scheduled_meeting_socket.py.

pytestmark = pytest.mark.asyncio

LEAD = "lead@example.com"
BOB = "bob@example.com"
CAT = "cat@example.com"
DEST = {"floor": "floor-2", "roomId": "floor-2/alpha", "label": "Alpha", "context": {"kind": "scheduled_meeting", "id": "m1"}}


def _reset() -> None:
    socket_module.travel_parties.reset()
    socket_module.party_invites.reset()


@pytest.fixture
async def server():
    original_env = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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


class Peer:
    def __init__(self, email: str) -> None:
        self.email = email
        self.client = socketio.AsyncClient()
        self.events: list[tuple[str, dict]] = []
        for name in ("party_updated", "party_ended", "party_invite_incoming", "party_invite_resolved",
                     "party_invite_result", "party_departing", "travel_party", "party_invites"):
            self.client.on(name, self._recorder(name))

    def _recorder(self, name: str):
        async def rec(data):
            self.events.append((name, data))
        return rec

    def last(self, name: str) -> dict | None:
        for n, d in reversed(self.events):
            if n == name:
                return d
        return None

    async def connect(self, url: str) -> "Peer":
        await asyncio.wait_for(
            self.client.connect(url, auth={"x-dev-email": self.email}, socketio_path="socket.io", transports=["websocket"]),
            timeout=5,
        )
        return self


async def _wait(pred, timeout=3.0) -> bool:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.02)
    return False


async def test_invite_accept_decline_pause_end(server) -> None:
    lead, bob, cat = Peer(LEAD), Peer(BOB), Peer(CAT)
    for p in (lead, bob, cat):
        await p.connect(server)
    try:
        await lead.client.emit("party_invite", {"emails": [BOB, CAT, "ghost@example.com"], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: lead.last("party_invite_result") is not None)
        results = {r["email"]: r for r in lead.last("party_invite_result")["results"]}
        assert results[BOB]["ok"] and results[CAT]["ok"]
        assert results["ghost@example.com"] == {"email": "ghost@example.com", "ok": False, "reason": "offline"}

        assert await _wait(lambda: bob.last("party_invite_incoming") is not None)
        inc = bob.last("party_invite_incoming")
        assert inc["party"]["destination"]["label"] == "Alpha" and inc["fromEmail"] == LEAD
        await bob.client.emit("party_invite_accept", {"inviteId": inc["inviteId"]})
        assert await _wait(lambda: any(m["email"] == BOB for m in (bob.last("party_updated") or {"party": {"members": []}})["party"]["members"]))
        upd = bob.last("party_updated")
        assert upd["controllerSid"] == bob.client.get_sid()
        assert upd["party"]["pending"] == [CAT]

        assert await _wait(lambda: cat.last("party_invite_incoming") is not None)
        await cat.client.emit("party_invite_decline", {"inviteId": cat.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: (lead.last("party_invite_resolved") or {}).get("outcome") == "declined")

        # a member's pause is visible to the leader
        await bob.client.emit("party_follow_state", {"following": False})
        assert await _wait(lambda: lead.last("party_updated")["party"]["members"][0]["following"] is False)

        await lead.client.emit("party_leave", {})
        assert await _wait(lambda: (bob.last("party_ended") or {}).get("reason") == "ended")
        assert socket_module.travel_parties.party_of(BOB) is None
    finally:
        for p in (lead, bob, cat):
            await p.client.disconnect()


async def test_nobody_invitable_leaves_no_party_and_leader_end_cancels_invites(server) -> None:
    lead, bob = Peer(LEAD), Peer(BOB)
    await lead.connect(server)
    await bob.connect(server)
    try:
        await lead.client.emit("party_invite", {"emails": ["ghost@example.com"], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: lead.last("party_invite_result") is not None)
        assert lead.last("party_invite_result")["partyId"] is None
        assert socket_module.travel_parties.party_of(LEAD) is None

        await lead.client.emit("party_invite", {"emails": [BOB], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: bob.last("party_invite_incoming") is not None)
        await lead.client.emit("party_leave", {})
        assert await _wait(lambda: (bob.last("party_invite_resolved") or {}).get("outcome") == "cancelled")
        assert await _wait(lambda: (lead.last("party_ended") or {}).get("reason") == "ended")
    finally:
        await lead.client.disconnect()
        await bob.client.disconnect()


async def test_reconnect_snapshot_restores_party_and_reclaim(server) -> None:
    lead, bob = Peer(LEAD), Peer(BOB)
    await lead.connect(server)
    await bob.connect(server)
    try:
        await lead.client.emit("party_invite", {"emails": [BOB], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: bob.last("party_invite_incoming") is not None)
        await bob.client.emit("party_invite_accept", {"inviteId": bob.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: socket_module.travel_parties.party_of(BOB) is not None)
        await bob.client.disconnect()
        bob2 = Peer(BOB)
        await bob2.connect(server)
        assert await _wait(lambda: bob2.last("travel_party") is not None)
        snap = bob2.last("travel_party")
        assert snap["party"]["leaderEmail"] == LEAD and snap["controllerSid"] is None  # lost, awaiting a claim
        await bob2.client.emit("party_claim", {})
        assert await _wait(lambda: (bob2.last("party_updated") or {}).get("controllerSid") == bob2.client.get_sid())
        await bob2.client.disconnect()
    finally:
        await lead.client.disconnect()


async def _formed(server, *emails: str) -> list[Peer]:
    peers = [Peer(e) for e in (LEAD, *emails)]
    for p in peers:
        await p.connect(server)
    return peers


async def test_phase2_form_start_gather_ready(server) -> None:
    lead, bob, cat, dan = await _formed(server, BOB, CAT, "dan@example.com")
    bob_tab2 = await Peer(BOB).connect(server)
    try:
        await lead.client.emit("party_invite", {"emails": [BOB, CAT, "dan@example.com"], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: bob.last("party_invite_incoming") is not None and cat.last("party_invite_incoming") is not None)
        await bob.client.emit("party_invite_accept", {"inviteId": bob.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: socket_module.travel_parties.party_of(BOB) is not None)
        await cat.client.emit("party_invite_decline", {"inviteId": cat.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: (cat.last("party_invite_resolved") or {}).get("outcome") == "declined")
        party = socket_module.travel_parties.party_of(LEAD)
        # ACCEPTANCE DOES NOT START ANYTHING — the party is forming, Dan's invite still open
        assert party["stage"] == "forming" and lead.last("party_updated")["party"]["stage"] == "forming"
        assert lead.last("party_updated")["party"]["pending"] == ["dan@example.com"]
        # "I'll walk there" is shown on the card, and never waited for
        assert lead.last("party_updated")["party"]["declined"] == [CAT]

        # own places, from the DRIVING tabs only: Bob's second tab's (lying) report is ignored
        await lead.client.emit("party_where", {"floor": "floor-1", "roomId": "design-team", "position": {"x": 0, "z": 0}})
        await bob.client.emit("party_where", {"floor": "floor-1", "roomId": "dev-room", "position": {"x": 900, "z": 40}})
        await bob_tab2.client.emit("party_where", {"floor": "floor-1", "roomId": "design-team", "position": {"x": 10, "z": 0}})
        assert await _wait(lambda: party["where"].get(BOB, {}).get("roomId") == "dev-room")
        await asyncio.sleep(0.1)
        assert party["where"][BOB]["roomId"] == "dev-room"

        # only the leader starts; the unanswered invite does not block it and is withdrawn
        await bob.client.emit("party_start", {})
        await asyncio.sleep(0.1)
        assert party["stage"] == "forming"
        await lead.client.emit("party_start", {})
        assert await _wait(lambda: (bob.last("party_updated") or {})["party"]["stage"] == "gathering")
        assert await _wait(lambda: (dan.last("party_invite_resolved") or {}).get("outcome") == "cancelled")
        rv = bob.last("party_updated")["party"]["rendezvous"]
        assert rv["kind"] == "hub" and rv["participants"] == [LEAD, BOB]  # separated → Central Hub; Cat declined
        await lead.client.emit("party_invite", {"emails": [CAT], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: (lead.last("party_invite_result") or {}).get("results", [{}])[0].get("reason") == "started")

        # ready is said by each body's own driving tab, about itself
        await bob_tab2.client.emit("party_ready", {"stageId": rv["stageId"]})
        await lead.client.emit("party_ready", {"stageId": rv["stageId"]})
        assert await _wait(lambda: lead.last("party_updated")["party"]["rendezvous"]["ready"] == [LEAD])
        await asyncio.sleep(0.1)
        assert party["stage"] == "gathering"  # Bob's other tab does not count
        await bob.client.emit("party_ready", {"stageId": rv["stageId"]})
        assert await _wait(lambda: lead.last("party_updated")["party"]["stage"] == "ready")
    finally:
        for p in (lead, bob, cat, dan, bob_tab2):
            await p.client.disconnect()


async def test_phase2_already_together_gathers_in_place(server) -> None:
    lead, bob = await _formed(server, BOB)
    try:
        await lead.client.emit("party_invite", {"emails": [BOB], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: bob.last("party_invite_incoming") is not None)
        await bob.client.emit("party_invite_accept", {"inviteId": bob.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: socket_module.travel_parties.party_of(BOB) is not None)
        await lead.client.emit("party_where", {"floor": "floor-1", "roomId": "design-team", "position": {"x": 300, "z": 200}})
        await bob.client.emit("party_where", {"floor": "floor-1", "roomId": "design-team", "position": {"x": 360, "z": 220}})
        await asyncio.sleep(0.1)
        await lead.client.emit("party_start", {})
        assert await _wait(lambda: (bob.last("party_updated") or {})["party"]["stage"] == "gathering")
        rv = bob.last("party_updated")["party"]["rendezvous"]
        assert rv["kind"] == "here" and rv["roomId"] == "design-team" and rv["point"] == {"x": 300.0, "z": 200.0}
    finally:
        await lead.client.disconnect()
        await bob.client.disconnect()


async def test_phase2_stuck_member_does_not_deadlock(server, monkeypatch) -> None:
    monkeypatch.setattr(socket_module, "PARTY_GATHER_DEADLINE_SECONDS", 0.3)
    lead, bob = await _formed(server, BOB)
    try:
        await lead.client.emit("party_invite", {"emails": [BOB], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: bob.last("party_invite_incoming") is not None)
        await bob.client.emit("party_invite_accept", {"inviteId": bob.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: socket_module.travel_parties.party_of(BOB) is not None)
        await lead.client.emit("party_start", {})
        assert await _wait(lambda: (lead.last("party_updated") or {})["party"]["stage"] == "gathering")
        await lead.client.emit("party_ready", {"stageId": lead.last("party_updated")["party"]["rendezvous"]["stageId"]})
        # Bob never gets there: at the deadline the party is READY and Bob is paused (Resume / catch-up)
        assert await _wait(lambda: lead.last("party_updated")["party"]["stage"] == "ready")
        assert bob.last("party_updated")["party"]["members"][0]["following"] is False
    finally:
        await lead.client.disconnect()
        await bob.client.disconnect()


async def test_phase3_journey_runs_leg_by_leg_and_ends_once(server, monkeypatch) -> None:
    monkeypatch.setattr(socket_module, "PARTY_READY_BEAT_SECONDS", 0.05)
    lead, bob = await _formed(server, BOB)
    try:
        await lead.client.emit("party_invite", {"emails": [BOB], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: bob.last("party_invite_incoming") is not None)
        await bob.client.emit("party_invite_accept", {"inviteId": bob.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: socket_module.travel_parties.party_of(BOB) is not None)
        await lead.client.emit("party_start", {})
        assert await _wait(lambda: (lead.last("party_updated") or {})["party"]["stage"] == "gathering")
        rv = lead.last("party_updated")["party"]["rendezvous"]["stageId"]
        for p in (lead, bob):
            await p.client.emit("party_ready", {"stageId": rv, "floor": "floor-1"})
        # READY, then — a beat later, for both at once — the first leg
        assert await _wait(lambda: (bob.last("party_updated") or {})["party"]["stage"] == "to_lift")
        seen = []
        for kind in ("to_lift", "ride", "to_room"):
            assert await _wait(lambda: (bob.last("party_updated") or {})["party"]["stage"] == kind), kind
            leg = bob.last("party_updated")["party"]["leg"]
            seen.append(leg["kind"])
            if kind == "ride":
                assert leg["riders"] == [LEAD, BOB] and leg["toFloor"] == "floor-2"
            await lead.client.emit("party_ready", {"stageId": leg["stageId"]})
            await asyncio.sleep(0.1)
            assert bob.last("party_updated")["party"]["stage"] == kind  # nobody moves on alone
            await bob.client.emit("party_ready", {"stageId": leg["stageId"]})
        assert seen == ["to_lift", "ride", "to_room"]
        assert await _wait(lambda: (bob.last("party_ended") or {}).get("reason") == "arrived")
        assert [n for n, d in bob.events if n == "party_ended"] == ["party_ended"]  # exactly once
    finally:
        await lead.client.disconnect()
        await bob.client.disconnect()


async def test_phase5_travel_chat_reaches_only_current_travellers(server) -> None:
    lead, bob, cat, eve = await _formed(server, BOB, CAT, "eve@example.com")
    bob_tab2 = await Peer(BOB).connect(server)
    chats: dict[str, list[dict]] = {}
    for p, key in ((lead, "lead"), (bob, "bob"), (cat, "cat"), (eve, "eve"), (bob_tab2, "bob2")):
        chats[key] = []
        p.client.on("party_chat", (lambda k: (lambda d: chats[k].append(d)))(key))
    try:
        await lead.client.emit("party_invite", {"emails": [BOB, CAT], "destination": DEST, "floor": "floor-1"})
        assert await _wait(lambda: bob.last("party_invite_incoming") is not None and cat.last("party_invite_incoming") is not None)
        await bob.client.emit("party_invite_accept", {"inviteId": bob.last("party_invite_incoming")["inviteId"]})
        await cat.client.emit("party_invite_accept", {"inviteId": cat.last("party_invite_incoming")["inviteId"]})
        assert await _wait(lambda: socket_module.travel_parties.party_of(CAT) is not None and socket_module.travel_parties.party_of(BOB) is not None)
        party = socket_module.travel_parties.party_of(LEAD)
        await lead.client.emit("party_where", {"floor": "floor-1", "roomId": "dev-room", "position": {"x": 0, "z": 0}})
        await bob.client.emit("party_where", {"floor": "floor-1", "roomId": "dev-room", "position": {"x": 30, "z": 0}})
        await cat.client.emit("party_where", {"floor": "floor-2", "roomId": None, "position": {"x": 6200, "z": 0}})
        assert await _wait(lambda: len(party["where"]) == 3)

        # forming: nobody can talk yet
        await lead.client.emit("party_chat_send", {"text": "too early"})
        await asyncio.sleep(0.15)
        assert all(not v for v in chats.values())

        await lead.client.emit("party_start", {})
        assert await _wait(lambda: party["stage"] == "gathering")
        await bob.client.emit("party_chat_send", {"text": "  Are we presenting the new version?  ", "to": [CAT, "eve@example.com"]})
        assert await _wait(lambda: len(chats["lead"]) == 1 and len(chats["bob"]) == 1)
        msg = chats["lead"][0]
        assert msg["text"] == "Are we presenting the new version?" and msg["email"] == BOB and msg["partyId"] == party["partyId"]
        await asyncio.sleep(0.15)
        # Cat waits upstairs (not merged yet), Eve is outside the party, Bob's other tab does not drive his body;
        # a client-supplied recipient list is ignored
        assert chats["cat"] == [] and chats["eve"] == [] and chats["bob2"] == []

        # outsiders and non-driving tabs cannot speak into it
        await eve.client.emit("party_chat_send", {"text": "let me in"})
        await bob_tab2.client.emit("party_chat_send", {"text": "second tab"})
        await cat.client.emit("party_chat_send", {"text": "not merged yet"})
        await asyncio.sleep(0.4)
        assert len(chats["lead"]) == 1

        # burst guard, then length cap
        await lead.client.emit("party_chat_send", {"text": "one"})
        await lead.client.emit("party_chat_send", {"text": "two"})
        assert await _wait(lambda: len(chats["bob"]) == 2)
        await asyncio.sleep(0.4)
        assert [m["text"] for m in chats["bob"]] == ["Are we presenting the new version?", "one"]
        await lead.client.emit("party_chat_send", {"text": "x" * 1000})
        assert await _wait(lambda: len(chats["bob"]) == 3)
        assert len(chats["bob"][-1]["text"]) == 400

        # jump the journey to the merged walk to the room: Cat now hears new lines (and none of the old ones)
        party["stage"], party["leg"] = "to_room", {"stageId": "x:to_room", "kind": "to_room", "floor": "floor-2"}
        party["expect"], party["ready"] = [LEAD, BOB, CAT], set()
        await asyncio.sleep(0.4)
        await bob.client.emit("party_chat_send", {"text": "see you upstairs"})
        assert await _wait(lambda: len(chats["cat"]) == 1)
        assert chats["cat"][0]["text"] == "see you upstairs"

        # a member who leaves stops hearing it
        await cat.client.emit("party_leave", {})
        assert await _wait(lambda: socket_module.travel_parties.party_of(CAT) is None)
        await asyncio.sleep(0.4)
        await lead.client.emit("party_chat_send", {"text": "after cat left"})
        assert await _wait(lambda: chats["bob"][-1]["text"] == "after cat left")
        await asyncio.sleep(0.15)
        assert len(chats["cat"]) == 1 and chats["eve"] == []
        # and she cannot talk into it either
        await cat.client.emit("party_chat_send", {"text": "stale"})
        await asyncio.sleep(0.15)
        assert chats["bob"][-1]["text"] == "after cat left"
    finally:
        for p in (lead, bob, cat, eve, bob_tab2):
            await p.client.disconnect()
