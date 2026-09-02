from __future__ import annotations

import httpx
import pytest

from app.config import settings
from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.services.position_registry import position_registry
from app.services.toucan.context import build_office_context
from app.services.toucan.office_assistant import answer_question
from app.services.toucan.roster import ROSTER_PATH, RosterPerson, fetch_roster

# Coverage for the Atlas roster reader: the allowlist, the forwarded credential, and every
# failure path degrading to "no roster" rather than to an error or an invented employee.

pytestmark = pytest.mark.asyncio

A = "angelo@example.com"
VIEWER = "bon@example.com"
TOKEN = "caller-bearer-token"

# A FloorPerson row exactly as Atlas sends it, unsafe fields and all.
ATLAS_ROW = {
    "user_email": "Angelo@Example.com",
    "display_name": "Angelo Reyes",
    "status": "ONLINE",
    "department_name": "Engineering",
    "team_room_id": "atlas-room-7",
    "current_room_id": "atlas-room-7",
    "source": "cliq",
    "current_activity": "Reviewing the deploy",
    "job_title": "Engineer",
    "last_message": {"text": "the staging password is hunter2", "at": "2026-09-02T01:00:00Z"},
}


@pytest.fixture(autouse=True)
def _fresh_registries():
    def clear():
        offline_lineup._slot_by_email.clear()
        dnd_registry._dnd_emails.clear()
        room_presence._room_by_email.clear()
        spatial_sessions.reset()
        call_registry.reset()
        position_registry.reset()

    clear()
    yield
    clear()


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _ok(rows):
    def handler(request: httpx.Request) -> httpx.Response:
        handler.seen = request
        return httpx.Response(200, json=rows)

    handler.seen = None
    return handler


# --- allowlist ------------------------------------------------------------------------------


async def test_only_email_and_display_name_survive_the_atlas_row():
    handler = _ok([ATLAS_ROW])
    async with _client(handler) as client:
        roster = await fetch_roster(TOKEN, client=client)

    assert roster == (RosterPerson(email=A, display_name="Angelo Reyes"),)
    blob = repr(roster)
    for leaked in ("hunter2", "Reviewing the deploy", "ONLINE", "Engineering", "atlas-room-7", "cliq"):
        assert leaked not in blob


async def test_last_message_and_current_activity_never_reach_the_context():
    handler = _ok([ATLAS_ROW])
    async with _client(handler) as client:
        roster = await fetch_roster(TOKEN, client=client)
    from app.services.toucan.context import build_office_context_from

    ctx = build_office_context_from(VIEWER, roster=roster, roster_available=True)
    blob = repr(ctx)
    assert "last_message" not in blob and "hunter2" not in blob
    assert "current_activity" not in blob and "Reviewing the deploy" not in blob
    assert ctx.person(A) is not None


async def test_a_new_atlas_field_is_ignored_by_default():
    """Allowlist, not denylist: an unknown field cannot arrive here just because nobody removed it."""
    row = {**ATLAS_ROW, "cliq_dm_url": "https://cliq/x", "secret_note": "nope"}
    handler = _ok([row])
    async with _client(handler) as client:
        roster = await fetch_roster(TOKEN, client=client)
    assert "cliq" not in repr(roster) and "nope" not in repr(roster)


# --- credential forwarding ------------------------------------------------------------------


async def test_the_callers_bearer_token_is_forwarded_to_the_floor_endpoint():
    handler = _ok([ATLAS_ROW])
    async with _client(handler) as client:
        await fetch_roster(TOKEN, client=client)

    assert handler.seen is not None
    assert handler.seen.headers["Authorization"] == f"Bearer {TOKEN}"
    assert str(handler.seen.url) == f"{settings.ATLAS_API_URL.rstrip('/')}{ROSTER_PATH}"
    assert handler.seen.method == "GET"


async def test_no_token_means_no_roster_and_no_request():
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json=[ATLAS_ROW])

    async with _client(handler) as client:
        assert await fetch_roster(None, client=client) == ()
        assert await fetch_roster("", client=client) == ()
    assert called is False


# --- failure behaviour ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "handler",
    [
        lambda request: httpx.Response(500, text="Atlas exploded: token abc123 rejected"),
        lambda request: httpx.Response(401, json={"error": "bad token"}),
        lambda request: httpx.Response(200, text="not json"),
        lambda request: httpx.Response(200, json={"people": []}),
    ],
)
async def test_bad_atlas_responses_degrade_to_an_empty_roster(handler):
    async with _client(handler) as client:
        assert await fetch_roster(TOKEN, client=client) == ()


async def test_a_transport_failure_degrades_to_an_empty_roster():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Atlas unreachable")

    async with _client(handler) as client:
        assert await fetch_roster(TOKEN, client=client) == ()


async def test_malformed_rows_are_skipped_not_fabricated():
    handler = _ok([{"display_name": "No Email"}, "junk", None, {"user_email": "  "}, ATLAS_ROW])
    async with _client(handler) as client:
        roster = await fetch_roster(TOKEN, client=client)
    assert [p.email for p in roster] == [A]


async def test_duplicate_rows_collapse_on_email():
    handler = _ok([{"user_email": A, "display_name": None}, ATLAS_ROW])
    async with _client(handler) as client:
        roster = await fetch_roster(TOKEN, client=client)
    assert roster == (RosterPerson(email=A, display_name="Angelo Reyes"),)


async def test_toucan_still_answers_registry_questions_when_atlas_is_down(monkeypatch):
    """The degradation that matters: no roster must not mean no assistant."""

    async def _no_roster(bearer_token, *, client=None):
        return ()

    monkeypatch.setattr("app.services.toucan.context.fetch_roster", _no_roster)
    room_presence.enter(VIEWER, "ai-room")

    ctx = await build_office_context(VIEWER, bearer_token=TOKEN)
    assert ctx.roster_available is False
    assert answer_question("who is in this room", ctx).intent == "room_occupants"
    assert answer_question("who is here", ctx).intent == "present"
    # Nothing invented.
    assert {p.email for p in ctx.people} == {VIEWER}


async def test_a_roster_only_employee_answers_honestly_end_to_end(monkeypatch):
    async def _roster(bearer_token, *, client=None):
        return (RosterPerson(email=A, display_name="Angelo Reyes"),)

    monkeypatch.setattr("app.services.toucan.context.fetch_roster", _roster)
    ctx = await build_office_context(VIEWER, bearer_token=TOKEN)

    located = answer_question("where is Angelo", ctx)
    assert located.intent == "locate_person"
    assert "Angelo Reyes" in located.text
    assert "can't see where they are" in located.text

    available = answer_question("is Angelo available", ctx)
    assert "can't see their current status" in available.text
    # Existence must never be reported as presence.
    assert "Angelo" not in answer_question("who is here", ctx).text
    assert "Angelo" not in answer_question("who is online", ctx).text
