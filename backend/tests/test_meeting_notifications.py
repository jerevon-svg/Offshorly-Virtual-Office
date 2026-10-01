from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import delete, select

from app.config import settings
from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.models.notification import Notification
from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee
from app.services import meeting_notifications

# Scheduled Meetings V1, Phase 3 — the bell: invite / update / cancel notifications and the 5-minute
# reminder sweep, all through the existing notify() and its dedupe.

pytestmark = pytest.mark.asyncio

ORG, BOB, CAROL, EVE = "org@example.com", "bob@example.com", "carol@example.com", "eve@example.com"


@pytest.fixture(autouse=True)
async def _fresh():
    original = settings.APP_ENV
    settings.APP_ENV = "development"
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for model in (Notification, ScheduledMeetingInvitee, ScheduledMeeting):
            await conn.execute(delete(model))
    yield
    settings.APP_ENV = original


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _h(email: str) -> dict:
    return {"x-dev-email": email}


async def _book(c, *, minutes=3, room="floor-2/alpha", private=False, invitees=(BOB, CAROL), title="Design Sync"):
    start = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    res = await c.post("/scheduled-meetings", headers=_h(ORG), json={
        "title": title, "roomId": room, "startsAt": start.isoformat(),
        "endsAt": (start + timedelta(minutes=30)).isoformat(), "isPrivate": private, "inviteeEmails": list(invitees),
    })
    assert res.status_code == 201, res.text
    return res.json()


async def _bell(email: str, type_: str | None = None) -> list[Notification]:
    async with async_session_maker() as db:
        q = select(Notification).where(Notification.recipient_email == email)
        if type_:
            q = q.where(Notification.type == type_)
        return list((await db.execute(q)).scalars())


async def test_invitees_are_notified_with_a_meeting_link_and_the_organizer_is_not():
    async with _client() as c:
        m = await _book(c)
    bob = await _bell(BOB, "meeting_invited")
    assert len(bob) == 1 and bob[0].nav_kind == "meeting" and bob[0].nav_payload == {"meetingId": m["id"]}
    assert "Design Sync" in bob[0].title and "Alpha" in bob[0].body
    assert await _bell(ORG, "meeting_invited") == []
    assert await _bell(EVE) == []


async def test_an_edit_tells_existing_invitees_and_invites_newcomers():
    async with _client() as c:
        m = await _book(c, minutes=60)
        await c.patch(f"/scheduled-meetings/{m['id']}", headers=_h(ORG), json={"roomId": "floor-2/bravo", "inviteeEmails": [BOB, EVE]})
        # a change that moves nothing a person would act on says nothing
        await c.patch(f"/scheduled-meetings/{m['id']}", headers=_h(ORG), json={"isPrivate": True})
    assert len(await _bell(BOB, "meeting_updated")) == 1
    assert "Bravo" in (await _bell(BOB, "meeting_updated"))[0].body
    assert len(await _bell(EVE, "meeting_invited")) == 1
    assert await _bell(EVE, "meeting_updated") == []
    assert await _bell(CAROL, "meeting_updated") == []  # removed, not updated


async def test_cancelling_notifies_invitees_once():
    async with _client() as c:
        m = await _book(c, minutes=60)
        await c.delete(f"/scheduled-meetings/{m['id']}", headers=_h(ORG))
        await c.delete(f"/scheduled-meetings/{m['id']}", headers=_h(ORG))
    assert len(await _bell(BOB, "meeting_cancelled")) == 1
    assert await _bell(ORG, "meeting_cancelled") == []


async def test_the_reminder_goes_to_attendees_once_and_never_to_decliners_or_cancelled_meetings():
    async with _client() as c:
        m = await _book(c, minutes=3)
        await c.patch(f"/scheduled-meetings/{m['id']}/response", headers=_h(CAROL), json={"response": "declined"})
        gone = await _book(c, minutes=4, room="floor-2/charlie", invitees=(BOB,), title="Gone")
        await c.delete(f"/scheduled-meetings/{gone['id']}", headers=_h(ORG))
        await _book(c, minutes=30, room="floor-2/delta", invitees=(BOB,), title="Later")  # outside the window
    assert await meeting_notifications.sweep_once() == 2  # org + bob, for Design Sync only
    assert await meeting_notifications.sweep_once() == 0  # a repeat sweep (or a restart) sends nothing new
    bob = await _bell(BOB, "meeting_reminder")
    assert [n.nav_payload["meetingId"] for n in bob] == [m["id"]]
    assert len(await _bell(ORG, "meeting_reminder")) == 1
    assert await _bell(CAROL, "meeting_reminder") == []


async def test_a_meeting_moved_to_a_new_time_reminds_again_for_the_new_time():
    async with _client() as c:
        m = await _book(c, minutes=3, invitees=(BOB,))
        assert await meeting_notifications.sweep_once() == 2
        start = datetime.now(timezone.utc) + timedelta(minutes=4)
        await c.patch(f"/scheduled-meetings/{m['id']}", headers=_h(ORG),
                      json={"startsAt": start.isoformat(), "endsAt": (start + timedelta(minutes=30)).isoformat()})
    assert await meeting_notifications.sweep_once() == 2
    assert len(await _bell(BOB, "meeting_reminder")) == 2


async def test_private_meeting_notifications_reach_only_its_invitees():
    async with _client() as c:
        await _book(c, minutes=3, private=True, invitees=(BOB,), title="Salary Review")
    await meeting_notifications.sweep_once()
    assert await _bell(EVE) == [] and await _bell(CAROL) == []
    assert {n.type for n in await _bell(BOB)} == {"meeting_invited", "meeting_reminder"}
