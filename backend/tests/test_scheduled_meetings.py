from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import delete

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.realtime.state import call_registry
from app.services import scheduled_meetings as service
from app.services.meeting_floor_rooms import MEETING_FLOOR_ROOMS

# Scheduled Meetings V1, Phase 1 — the booking rules, the private-metadata rule and the private-room
# token gate, through the real ASGI app with the dev x-dev-email identity (same conventions as
# tests/test_calls_router.py). The socket half of the private gate is tests/test_scheduled_meeting_socket.py.

pytestmark = pytest.mark.asyncio

ORG = "org@example.com"
BOB = "bob@example.com"
EVE = "eve@example.com"
ALPHA = "floor-2/alpha"
BRAVO = "floor-2/bravo"


@pytest.fixture(autouse=True)
async def _fresh_state():
    original_env = settings.APP_ENV
    original = (settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    settings.APP_ENV = "development"
    settings.LIVEKIT_URL = "wss://test.livekit.example"
    settings.LIVEKIT_API_KEY = "APItestkey"
    settings.LIVEKIT_API_SECRET = "test-secret-value-long-enough-to-sign"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(delete(ScheduledMeetingInvitee))
        await conn.execute(delete(ScheduledMeeting))
    call_registry.reset()
    service.reset_live()
    yield
    call_registry.reset()
    service.reset_live()
    settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET = original
    settings.APP_ENV = original_env


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _h(email: str) -> dict:
    return {"x-dev-email": email}


# Tomorrow 10:00 UTC — far enough ahead that "not in the past" never flakes.
BASE = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)


def _at(hours: float) -> str:
    return (BASE + timedelta(hours=hours)).isoformat()


def _body(**over) -> dict:
    body = {"title": "Design sync", "roomId": ALPHA, "startsAt": _at(0), "endsAt": _at(1), "inviteeEmails": [BOB]}
    body.update(over)
    return body


async def _create(client, email=ORG, **over) -> httpx.Response:
    return await client.post("/scheduled-meetings", json=_body(**over), headers=_h(email))


# --- create / validation --------------------------------------------------------------------------


async def test_create_includes_the_organizer_and_normalises_invitees_and_times():
    async with _client() as c:
        res = await _create(c, email="Org@Example.com", inviteeEmails=[" BOB@example.com ", BOB, "org@example.com"],
                            startsAt=(BASE.astimezone(timezone(timedelta(hours=8)))).isoformat())
    assert res.status_code == 201, res.text
    m = res.json()
    assert m["organizerEmail"] == ORG
    assert m["status"] == "scheduled" and m["isPrivate"] is False
    assert {(i["email"], i["response"]) for i in m["invitees"]} == {(ORG, "accepted"), (BOB, "pending")}
    # A +08:00 start is the same instant, stored and returned as UTC.
    assert m["startsAt"] == BASE.strftime("%Y-%m-%dT%H:%M:%S.000Z")


@pytest.mark.parametrize(
    "over, fragment",
    [
        ({"roomId": "floor-2/zulu"}, "Unknown Meeting Floor room"),
        ({"roomId": "design-team"}, "Unknown Meeting Floor room"),
        ({"title": "   "}, "Title is required"),
        ({"title": "x" * 121}, "at most 120"),
        ({"endsAt": _at(0)}, "endsAt must be after startsAt"),
        ({"endsAt": _at(-1)}, "endsAt must be after startsAt"),
        ({"endsAt": _at(0.2)}, "at least 15 minutes"),
        ({"endsAt": _at(8.5)}, "at most 8 hours"),
        ({"startsAt": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
          "endsAt": datetime.now(timezone.utc).isoformat()}, "in the past"),
        ({"startsAt": "2030-01-01T10:00:00", "endsAt": "2030-01-01T11:00:00"}, "timezone offset"),
        ({"inviteeEmails": ["not-an-email"]}, "Invalid invitee email"),
    ],
)
async def test_invalid_bookings_are_rejected(over, fragment):
    async with _client() as c:
        res = await _create(c, **over)
    assert res.status_code == 400, res.text
    assert fragment in res.text


# --- conflicts ------------------------------------------------------------------------------------


async def test_overlapping_booking_of_the_same_room_is_rejected_with_409():
    async with _client() as c:
        assert (await _create(c)).status_code == 201
        for start, end in [(0, 1), (0.5, 1.5), (-0.5, 0.5), (0.25, 0.75), (-1, 2)]:
            res = await _create(c, email=EVE, startsAt=_at(start), endsAt=_at(end), inviteeEmails=[])
            assert res.status_code == 409, (start, end, res.text)
        detail = res.json()
        assert detail["error"] == "Room is already booked for part of that time"
        assert detail["conflict"]["roomId"] == ALPHA
        assert "title" not in detail["conflict"]  # the window may be told, the meeting may not
        # Another room at the same time is fine.
        assert (await _create(c, email=EVE, roomId=BRAVO)).status_code == 201


async def test_back_to_back_bookings_are_allowed():
    async with _client() as c:
        assert (await _create(c)).status_code == 201
        assert (await _create(c, startsAt=_at(1), endsAt=_at(2))).status_code == 201
        assert (await _create(c, startsAt=_at(-1), endsAt=_at(0))).status_code == 201


async def test_cancelling_frees_the_slot_and_only_the_organizer_may_cancel():
    async with _client() as c:
        mid = (await _create(c)).json()["id"]
        assert (await c.delete(f"/scheduled-meetings/{mid}", headers=_h(BOB))).status_code == 403
        assert (await c.delete(f"/scheduled-meetings/{mid}", headers=_h(EVE))).status_code == 404
        res = await c.delete(f"/scheduled-meetings/{mid}", headers=_h(ORG))
        assert res.status_code == 200 and res.json()["status"] == "cancelled"
        assert (await c.delete(f"/scheduled-meetings/{mid}", headers=_h(ORG))).status_code == 200  # idempotent
        assert (await _create(c, email=EVE, inviteeEmails=[])).status_code == 201
        # A cancelled meeting cannot be edited back into a clash.
        assert (await c.patch(f"/scheduled-meetings/{mid}", json={"title": "x"}, headers=_h(ORG))).status_code == 400


# --- list / update / respond ----------------------------------------------------------------------


async def test_list_mine_shows_invited_meetings_only():
    async with _client() as c:
        await _create(c)
        await _create(c, roomId=BRAVO, inviteeEmails=[])
        cancelled = (await _create(c, roomId="floor-2/charlie")).json()["id"]
        await c.delete(f"/scheduled-meetings/{cancelled}", headers=_h(ORG))
        org = (await c.get("/scheduled-meetings/mine", headers=_h(ORG))).json()
        bob = (await c.get("/scheduled-meetings/mine", headers=_h(BOB))).json()
        eve = (await c.get("/scheduled-meetings/mine", headers=_h(EVE))).json()
    assert [m["roomId"] for m in org] == [ALPHA, BRAVO]
    assert [m["roomId"] for m in bob] == [ALPHA]
    assert eve == []


async def test_update_is_organizer_only_rechecks_conflicts_and_keeps_responses():
    async with _client() as c:
        mid = (await _create(c)).json()["id"]
        await _create(c, email=EVE, startsAt=_at(2), endsAt=_at(3), inviteeEmails=[])
        await c.patch(f"/scheduled-meetings/{mid}/response", json={"response": "accepted"}, headers=_h(BOB))

        assert (await c.patch(f"/scheduled-meetings/{mid}", json={"title": "x"}, headers=_h(BOB))).status_code == 403
        assert (await c.patch(f"/scheduled-meetings/{mid}", json={"title": "x"}, headers=_h(EVE))).status_code == 404
        # Extending into Eve's booking clashes; extending to exactly its start does not.
        assert (await c.patch(f"/scheduled-meetings/{mid}", json={"endsAt": _at(2.5)}, headers=_h(ORG))).status_code == 409
        res = await c.patch(
            f"/scheduled-meetings/{mid}",
            json={"title": "Design review", "endsAt": _at(2), "isPrivate": True,
                  "inviteeEmails": [BOB, "carol@example.com"]},
            headers=_h(ORG),
        )
        assert res.status_code == 200, res.text
        m = res.json()
        assert m["title"] == "Design review" and m["isPrivate"] is True and m["endsAt"].startswith(_at(2)[:16])
        assert {(i["email"], i["response"]) for i in m["invitees"]} == {
            (ORG, "accepted"), (BOB, "accepted"), ("carol@example.com", "pending")
        }
        # Dropping an invitee removes them; the organizer can never be dropped.
        m = (await c.patch(f"/scheduled-meetings/{mid}", json={"inviteeEmails": []}, headers=_h(ORG))).json()
        assert [i["email"] for i in m["invitees"]] == [ORG]


async def test_accept_and_decline_are_invitee_only():
    async with _client() as c:
        mid = (await _create(c)).json()["id"]
        res = await c.patch(f"/scheduled-meetings/{mid}/response", json={"response": "declined"}, headers=_h(BOB))
        assert res.status_code == 200
        assert {i["email"]: i["response"] for i in res.json()["invitees"]}[BOB] == "declined"
        res = await c.patch(f"/scheduled-meetings/{mid}/response", json={"response": "accepted"}, headers=_h(BOB))
        assert {i["email"]: i["response"] for i in res.json()["invitees"]}[BOB] == "accepted"
        assert (await c.patch(f"/scheduled-meetings/{mid}/response", json={"response": "accepted"}, headers=_h(EVE))).status_code == 404
        assert (await c.patch(f"/scheduled-meetings/{mid}/response", json={"response": "accepted"}, headers=_h(ORG))).status_code == 400
        assert (await c.patch(f"/scheduled-meetings/{mid}/response", json={"response": "maybe"}, headers=_h(BOB))).status_code == 422


# --- availability / floor bookings ----------------------------------------------------------------


async def test_room_availability_reflects_standing_bookings():
    async with _client() as c:
        await _create(c)
        cancelled = (await _create(c, roomId=BRAVO)).json()["id"]
        await c.delete(f"/scheduled-meetings/{cancelled}", headers=_h(ORG))
        rooms = (await c.get("/scheduled-meetings/rooms/availability",
                             params={"startsAt": _at(0.5), "endsAt": _at(1.5)}, headers=_h(EVE))).json()
        after = (await c.get("/scheduled-meetings/rooms/availability",
                             params={"startsAt": _at(1), "endsAt": _at(2)}, headers=_h(EVE))).json()
    assert len(rooms) == 13
    free = {r["roomId"]: r["available"] for r in rooms}
    assert free[ALPHA] is False and free[BRAVO] is True and sum(free.values()) == 12
    assert all(r["available"] for r in after)  # back-to-back: free from the minute it ends


async def test_private_meeting_metadata_is_hidden_from_non_invitees():
    async with _client() as c:
        await _create(c, isPrivate=True, title="Salary review")
        await _create(c, roomId=BRAVO, title="Open demo", inviteeEmails=[])
        window = {"from": _at(-2), "to": _at(6)}
        eve = (await c.get("/scheduled-meetings/rooms/today", params=window, headers=_h(EVE))).json()
        bob = (await c.get("/scheduled-meetings/rooms/today", params=window, headers=_h(BOB))).json()
    by_room = {b["roomId"]: b for b in eve}
    private = by_room[ALPHA]
    assert private["isPrivate"] is True
    assert private["title"] is None and private["organizerEmail"] is None and private["id"] is None
    assert "invitees" not in private
    assert "Salary review" not in str(eve)
    assert by_room[BRAVO]["title"] == "Open demo" and by_room[BRAVO]["organizerEmail"] == ORG
    mine = {b["roomId"]: b for b in bob}[ALPHA]
    assert mine["title"] == "Salary review" and mine["viewerIsInvitee"] is True


# --- private meeting token gate -------------------------------------------------------------------


async def _book_now(client, **over) -> str:
    """A booking whose access window is open now: it starts in 2 minutes, inside the 5-minute lead."""
    start = datetime.now(timezone.utc) + timedelta(minutes=2)
    res = await _create(client, startsAt=start.isoformat(), endsAt=(start + timedelta(hours=1)).isoformat(), **over)
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_private_meeting_token_is_for_invitees_only():
    async with _client() as c:
        await _book_now(c, isPrivate=True)
        assert (await c.post("/meetings/mf-alpha/token", headers=_h(ORG))).status_code == 200
        assert (await c.post("/meetings/mf-alpha/token", headers=_h(BOB))).status_code == 200
        res = await c.post("/meetings/mf-alpha/token", headers=_h(EVE))
        assert res.status_code == 403
        # Other rooms and other meetings are untouched.
        assert (await c.post("/meetings/mf-bravo/token", headers=_h(EVE))).status_code == 200
        assert (await c.post("/meetings/cave-all-hands/token", headers=_h(EVE))).status_code == 200


async def test_public_or_cancelled_bookings_do_not_restrict_the_token():
    async with _client() as c:
        await _book_now(c)
        assert (await c.post("/meetings/mf-alpha/token", headers=_h(EVE))).status_code == 200
        mid = await _book_now(c, roomId=BRAVO, isPrivate=True)
        assert (await c.post("/meetings/mf-bravo/token", headers=_h(EVE))).status_code == 403
        await c.delete(f"/scheduled-meetings/{mid}", headers=_h(ORG))
        assert (await c.post("/meetings/mf-bravo/token", headers=_h(EVE))).status_code == 200


async def test_a_private_booking_outside_its_access_window_restricts_nothing():
    async with _client() as c:
        await _create(c, isPrivate=True)  # tomorrow
        assert (await c.post("/meetings/mf-alpha/token", headers=_h(EVE))).status_code == 200


# --- overrun: a live session keeps the booking it started under --------------------------------


async def test_a_live_session_keeps_its_own_booking_past_the_scheduled_end():
    async with _client() as c:
        private = (await _create(c, isPrivate=True)).json()["id"]                         # 10:00-11:00
        await _create(c, startsAt=_at(1), endsAt=_at(2), inviteeEmails=[])                # 11:00-12:00 public
        await _create(c, roomId=BRAVO, startsAt=_at(1), endsAt=_at(2), isPrivate=True)    # bravo 11-12 private
    later = BASE + timedelta(hours=1, minutes=30)
    async with async_session_maker() as db:
        # Nobody in Alpha at 11:30: the public booking governs.
        assert (await service.admit(db, "mf-alpha", EVE, now=later))[0] is True
        # The private meeting is still running at 11:30: it keeps governing until the room empties.
        call_registry.join("meeting:mf-alpha", ORG, "sid-org")
        service.bind_live("meeting:mf-alpha", private, fresh=True)
        assert (await service.admit(db, "mf-alpha", EVE, now=later))[0] is False
        assert (await service.admit(db, "mf-alpha", BOB, now=later))[0] is True
        call_registry.leave(ORG, "sid-org")
        service.release_live("meeting:mf-alpha")
        assert (await service.admit(db, "mf-alpha", EVE, now=later))[0] is True
        # An unbooked session already running in Bravo is not taken over by the private booking.
        call_registry.join("meeting:mf-bravo", EVE, "sid-eve")
        service.bind_live("meeting:mf-bravo", None, fresh=True)
        assert (await service.admit(db, "mf-bravo", "zed@example.com", now=later))[0] is True


# --- frontend/backend room parity -----------------------------------------------------------------


async def test_backend_rooms_match_the_meeting_floor_definition():
    """The 13 rooms are defined by the frontend's Meeting Floor. If a room is added, renamed or
    re-capacitied there, this fails until services/meeting_floor_rooms.py is updated to match."""
    src = (Path(__file__).resolve().parents[2] / "frontend/src/dev/vo3d/rooms/floor2Meeting.ts").read_text()
    found = re.findall(r'\{\s*slug:\s*"([a-z]+)",\s*name:\s*"([A-Za-z]+)",\s*kind:\s*"[a-z]+",\s*capacity:\s*(\d+)', src)
    assert [(s, n, int(cap)) for s, n, cap in found] == [(r.slug, r.name, r.capacity) for r in MEETING_FLOOR_ROOMS]
    # The id schemes the frontend derives from each slug.
    assert "id: `floor-2/${d.slug}`" in src and "meetingId: `mf-${d.slug}`" in src


async def test_ending_a_live_session_early_completes_that_occurrence():
    """Started early, then ENDED by the host before its time: the same occurrence is done — it governs
    nothing, the reminder sweep's window skips it, and its original start never reactivates it."""
    async with _client() as client:
        meeting_id = (await _create(client)).json()["id"]
    call_registry.join("meeting:mf-alpha", ORG, "sid-org")
    service.bind_live("meeting:mf-alpha", meeting_id, fresh=True)
    async with async_session_maker() as db:
        assert (await service.live_booking(db, "meeting:mf-alpha")).id == meeting_id
        ended = await service.end_live(db, "meeting:mf-alpha")
        assert ended is not None and ended.status == "ended"
        # the room, at the occurrence's original start: nothing governs it any more
        assert await service.admit(db, "mf-alpha", EVE, now=BASE) == (True, None)
        # a second End (or an ad-hoc session) ends nothing
        assert await service.end_live(db, "meeting:mf-alpha") is None
        from app.repositories import scheduled_meetings as repo
        due = await repo.starting_between(db, after=BASE - timedelta(minutes=10), until=BASE + timedelta(minutes=1))
        assert meeting_id not in [m.id for m in due]
    assert service.live_booking_wire("meeting:mf-alpha") is None
