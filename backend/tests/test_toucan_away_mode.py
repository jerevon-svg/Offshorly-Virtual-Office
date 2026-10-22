from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.attendance import EmployeeAttendance
from app.models.toucan import ToucanConversation, ToucanDelegation, ToucanMessage
from app.repositories import toucan_delegation as repo
from app.services.chat_delegation import shareable_return_label
from app.services.toucan import delegation as words
from app.services.toucan.delegation import (
    DelegationClockRequest,
    StartDelegationAction,
    parse_delegation_request,
    parse_return_command,
    parse_stop_delegation,
)
from app.services.toucan.pending_actions import pending_actions

# AWAY MODE V1 — "Hey Toucan, handle my messages, I'll be out for a few hours" … "I'm back".
#
# What this file pins: the natural phrasings are recognised but stay EXPLICIT and self-scoped;
# vague durations never become a guessed time; a return time is shared only when the owner gave a
# clock time; "I'm back" ends ANY delegation; a successful attendance checkout ends it too.

pytestmark = pytest.mark.asyncio

VIEWER = "bon@example.com"
OTHER = "micah@example.com"
UNTIL_RETURN = StartDelegationAction(duration_minutes=None, end_condition=words.END_UNTIL_RETURN)


# --- recognition (pure) ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "question, expected",
    [
        ("Hey Toucan, handle my messages. I'll be out for a few hours and come back later.", UNTIL_RETURN),
        ("Hey Toucan, handle my messages. I'll be out for a few hours.", UNTIL_RETURN),
        ("Hey Toucan, I'll be away until 7 PM. Handle my messages.", DelegationClockRequest(hour=19, minute=0)),
        ("Hey Toucan, handle my messages. I'll be back at 7 PM.", DelegationClockRequest(hour=19, minute=0)),
        ("I'll be away until 7 p.m. Handle my messages.", DelegationClockRequest(hour=19, minute=0)),
        ("Toucan, cover my messages while I'm away.", UNTIL_RETURN),
        ("Handle my messages until I'm back.", UNTIL_RETURN),
        ("I'll be out for a while, please handle my messages.", UNTIL_RETURN),
        ("can you handle my messages while I'm out?", UNTIL_RETURN),
        ("I'm heading out for 3 hours, cover my messages", StartDelegationAction(duration_minutes=180)),
        ("Hey Toucan, handle my messages for 2 hours", StartDelegationAction(duration_minutes=120)),
    ],
)
async def test_natural_phrasings_become_the_same_explicit_proposals(question, expected):
    assert parse_delegation_request(question) == expected


@pytest.mark.parametrize(
    "question",
    [
        "I'm away",
        "Hey Toucan, I'll be out for a few hours.",  # no request to handle anything
        "handle my messages",  # no away context, no time — unchanged A2.1 contract
        "how do I handle my messages while I'm away?",  # a question about it, not a command
        "is Toucan handling my messages?",
        "don't handle my messages",
        "handle Micah's messages for 2 hours",  # third party: unrepresentable
        "Hey Toucan, handle Micah's messages. He's out until 7 PM.",
        "handle my messages and tell Micah I quit",  # an extra instruction voids the request
        "Handle my messages. Tell Micah the build is done.",
        "handle my messages. I'll be back at 3",  # no AM/PM — refused, never guessed
        "Handle my messages until 7 PM. I'll be back at 8 PM.",  # two different times — refused
        "what happens when I'm away?",
    ],
)
async def test_casual_or_ambiguous_statements_never_become_a_delegation(question):
    assert parse_delegation_request(question) is None


@pytest.mark.parametrize(
    "question", ["I'm back", "Hey Toucan, I'm back.", "Toucan, I'm here again.", "I'm back now, thanks", "I've returned"]
)
async def test_return_phrasings_are_recognised(question):
    assert parse_return_command(question) is True


@pytest.mark.parametrize("question", ["is Micah back?", "when I'm back remind me to call Jan", "I'm away", "back up the files"])
async def test_return_recognition_does_not_misfire(question):
    assert parse_return_command(question) is False


@pytest.mark.parametrize("question", ["Stop handling my messages.", "Hey Toucan, stop handling my messages", "turn off away mode"])
async def test_stop_phrasings_still_work_and_accept_a_wake_word(question):
    assert parse_stop_delegation(question) is True


async def test_confirmation_states_the_return_time_only_for_an_explicit_clock_time():
    clock = StartDelegationAction(
        duration_minutes=None, ends_at=datetime(2030, 1, 1, 11, tzinfo=timezone.utc), end_label="7:00 PM today",
        return_label="7:00 PM",
    )
    assert "expect to return around 7:00 PM" in words.confirmation_text(clock)
    assert "return around" not in words.confirmation_text(StartDelegationAction(duration_minutes=180))
    until = words.confirmation_text(UNTIL_RETURN)
    assert "until you return" in until and "24 hours" in until and "return around" not in until


async def test_reply_wording_with_and_without_a_return_time():
    assert words.first_reply_text("jerevon@example.com", "7:00 PM") == (
        "Toucan — assisting Jerevon: Jerevon is currently away and expects to return around 7:00 PM. "
        "They'll see your message when they're back. Is this urgent?"
    )
    assert "around" not in words.first_reply_text("jerevon@example.com")
    assert "expected back around 7:00 PM" in words.follow_up_reply_text("jerevon@example.com", "7:00 PM")
    # A combined reply for several owners never states anyone's time.
    assert "around" not in words.combined_first_reply_text(["a@x.com", "b@x.com"], "7:00 PM")


async def test_a_return_time_is_shared_only_while_it_is_ahead_and_only_for_a_clock_row():
    now = datetime(2026, 10, 22, 6, tzinfo=timezone.utc)
    row = SimpleNamespace(note="7:00 PM", end_condition="at_time", expires_at=now + timedelta(hours=5))
    assert shareable_return_label(row, now) == "7:00 PM"
    assert shareable_return_label(SimpleNamespace(**{**row.__dict__, "expires_at": now - timedelta(minutes=1)}), now) is None
    assert shareable_return_label(SimpleNamespace(**{**row.__dict__, "note": None}), now) is None
    assert shareable_return_label(SimpleNamespace(note="7:00 PM", end_condition="until_return", expires_at=None), now) is None


# --- the routes ----------------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _fresh_state(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table in (ToucanMessage, ToucanConversation, ToucanDelegation, EmployeeAttendance):
            await conn.execute(table.__table__.delete())
    pending_actions.reset()
    yield
    pending_actions.reset()


@pytest.fixture
def emitted(monkeypatch):
    from app.services import delegation_events

    seen: list[tuple[str, dict, str | None]] = []

    async def fake_emit(event, payload, room=None, **kwargs):
        seen.append((event, payload, room))

    monkeypatch.setattr(delegation_events.sio, "emit", fake_emit)
    return seen


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _h(email: str = VIEWER) -> dict:
    return {"x-dev-email": email}


async def _ask(client, question: str, email: str = VIEWER, tz: str | None = None) -> dict:
    payload = {"question": question}
    if tz:
        payload["clientTimezone"] = tz
    res = await client.post("/toucan/ask", headers=_h(email), json=payload)
    assert res.status_code == 200, res.text
    return res.json()


async def _rows() -> list[ToucanDelegation]:
    from sqlalchemy import select

    async with app_db.async_session_maker() as session:
        return list((await session.execute(select(ToucanDelegation))).scalars().all())


def _zone_where_late_evening_is_ahead() -> str:
    from zoneinfo import ZoneInfo

    now = datetime.now(timezone.utc)
    return min(
        ("Pacific/Honolulu", "America/Los_Angeles", "Europe/London", "Asia/Manila", "Pacific/Auckland"),
        key=lambda z: now.astimezone(ZoneInfo(z)).hour,
    )


async def test_vague_away_request_proposes_until_return_and_activates_only_on_confirm():
    async with _client() as client:
        body = await _ask(client, "Hey Toucan, handle my messages. I'll be out for a few hours and come back later.")
        action = body["action"]
        assert action["action"] == "start_delegation" and action["endCondition"] == "until_return"
        assert await _rows() == []  # a proposal only
        res = await client.post(f"/toucan/actions/{action['id']}/confirm", headers=_h())
        assert res.status_code == 200, res.text
        delegation = res.json()["delegation"]
    assert delegation["endCondition"] == "until_return" and delegation["expiresAt"] is None
    assert delegation["returnLabel"] is None  # nothing to announce: no time was given
    assert [r.note for r in await _rows()] == [None]


async def test_an_explicit_clock_time_is_stored_for_sharing_but_a_duration_is_not():
    zone = _zone_where_late_evening_is_ahead()
    async with _client() as client:
        body = await _ask(client, "Hey Toucan, handle my messages. I'll be back at 11:59 PM.", tz=zone)
        assert "return around 11:59 PM" in body["text"]
        res = await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        assert res.json()["delegation"]["returnLabel"] == "11:59 PM"
        got = await client.get("/toucan/delegation", headers=_h())
        assert got.json()["returnLabel"] == "11:59 PM"
        body = await _ask(client, "handle my messages for 3 hours")
        res = await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        assert res.json()["delegation"]["returnLabel"] is None


async def test_im_back_ends_a_timed_delegation_immediately_and_cannot_be_reactivated(emitted):
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 3 hours.")
        action_id = body["action"]["id"]
        await client.post(f"/toucan/actions/{action_id}/confirm", headers=_h())
        back = await _ask(client, "Hey Toucan, I'm back.")
        assert back["intent"] == "delegation_stop" and back["text"] == words.returned_text()
        assert (await client.get("/toucan/delegation", headers=_h())).json() is None
        # A stale client replaying the old confirmation cannot bring it back.
        replay = await client.post(f"/toucan/actions/{action_id}/confirm", headers=_h())
        assert replay.status_code != 200
        # Saying it again is harmless and creates nothing.
        again = await _ask(client, "I'm back")
        assert again["text"] == words.not_away_text()
    rows = await _rows()
    assert [(r.status, r.ended_reason) for r in rows] == [("ended", "returned")]
    assert [p["reason"] for e, p, _ in emitted if e == "delegation_ended"] == ["returned"]


async def test_another_persons_im_back_does_not_end_mine():
    async with _client() as client:
        body = await _ask(client, "Toucan, cover my messages while I'm away.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        await _ask(client, "I'm back", email=OTHER)
        assert (await client.get("/toucan/delegation", headers=_h())).json() is not None


async def test_a_successful_checkout_ends_the_delegation_once(emitted):
    from app.realtime.state import user_room

    async with _client() as client:
        await client.post("/attendance/check-in", headers=_h())
        body = await _ask(client, "Toucan, cover my messages while I'm away.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        res = await client.post("/attendance/check-out", headers=_h())
        assert res.status_code == 200 and res.json()["status"] == "CHECKED_OUT"
        assert (await client.get("/toucan/delegation", headers=_h())).json() is None
        # Idempotent: a repeated checkout neither fails nor emits again.
        assert (await client.post("/attendance/check-out", headers=_h())).status_code == 200
    assert [(r.status, r.ended_reason) for r in await _rows()] == [("ended", "checked_out")]
    ended = [(p["reason"], room) for e, p, room in emitted if e == "delegation_ended"]
    assert ended == [("checked_out", user_room(VIEWER))]


async def test_checkout_with_no_delegation_is_unchanged(emitted):
    async with _client() as client:
        await client.post("/attendance/check-in", headers=_h())
        res = await client.post("/attendance/check-out", headers=_h())
    assert res.status_code == 200 and res.json()["status"] == "CHECKED_OUT"
    assert [e for e, _, _ in emitted if e == "delegation_ended"] == []


async def test_a_failure_to_end_the_delegation_never_fails_the_checkout(monkeypatch):
    async def _boom(*a, **k):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(repo, "end_delegation", _boom)
    async with _client() as client:
        await client.post("/attendance/check-in", headers=_h())
        res = await client.post("/attendance/check-out", headers=_h())
    assert res.status_code == 200 and res.json()["status"] == "CHECKED_OUT"


async def test_go_offline_is_not_a_checkout():
    # Disconnecting, refreshing or a socket go_offline must leave the employee Away and delegated:
    # only the attendance route ends a delegation at checkout.
    import inspect

    from app.realtime import socket as realtime_socket

    assert "end_delegation" not in inspect.getsource(realtime_socket.go_offline)
