from __future__ import annotations

import ast
import pathlib
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.toucan import ToucanConversation, ToucanDelegation, ToucanMessage
from app.repositories import toucan_delegation as repo
from app.services.toucan import delegation as words
from app.services.toucan.actions import (
    ACTION_UNAVAILABLE_DETAIL,
    ALLOWED_ACTIONS,
    parse_action_request,
    validate_ai_proposal,
)
from app.services.toucan.delegation import (
    DELEGATION_MAX_MINUTES,
    StartDelegationAction,
    parse_delegation_request,
    parse_stop_delegation,
)
from app.services.toucan.pending_actions import pending_actions

# A2.1 — EXPLICIT TEMPORARY DELEGATION: parsing, durable state, and the confirm gate.
#
# The load-bearing promises: nothing but an explicit "handle my messages for <duration>" is even
# proposed; nothing is active until Confirm; one active delegation per owner; expiry is lazy and
# durable; another owner can neither see nor cancel it.

pytestmark = pytest.mark.asyncio

VIEWER = "bon@example.com"
OTHER = "micah@example.com"
NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)


# --- parsing (pure) -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("question", "minutes"),
    [
        ("Handle my messages for 2 hours.", 120),
        ("While I’m away, handle my messages for 30 minutes.", 30),
        ("While I'm out, please handle my DMs for 45 mins", 45),
        ("Assist with my messages for 1 hour.", 60),
        ("cover my inbox for an hour", 60),
        ("handle my messages for the next half an hour", 30),
        ("for 3 hours, handle my messages", 180),
        ("take care of my direct messages for me for two hours", 120),
    ],
)
async def test_parser_accepts_explicit_duration_phrasings(question, minutes):
    assert parse_delegation_request(question) == StartDelegationAction(duration_minutes=minutes)
    # Reachable through the shared action parser too, and never mistaken for a send/status.
    assert parse_action_request(question) == StartDelegationAction(duration_minutes=minutes)


@pytest.mark.parametrize(
    "question",
    [
        "I'm away.",
        "I’ll be back later.",
        "I'm busy",
        "I'm heading out for two hours",
        "handle my messages",  # no duration
        "handle my messages until 3",  # clock time with no AM/PM — refused as ambiguous
        "handle my messages until tomorrow",
        "handle Micah's messages for 2 hours",  # other-scoped: unrepresentable
        "tell Micah I'm away for 2 hours",  # a send, not a delegation
        "set me to busy for 2 hours",  # a status, not a delegation
        "handle my messages for 0 minutes",
    ],
)
async def test_parser_never_infers_delegation(question):
    assert parse_delegation_request(question) is None
    assert not isinstance(parse_action_request(question), StartDelegationAction)


async def test_duration_is_clamped_to_the_hard_cap_and_floor():
    assert parse_delegation_request("handle my messages for 900 hours").duration_minutes == DELEGATION_MAX_MINUTES
    assert parse_delegation_request("handle my messages for 1 minute").duration_minutes == words.DELEGATION_MIN_MINUTES


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("stop handling my messages", True),
        ("I’m back, stop handling my messages.", True),
        ("cancel delegation", True),
        ("end my delegation", True),
        ("stop covering my inbox for me", True),
        ("stop", False),
        ("stop the call", False),
        ("I'm back", False),
    ],
)
async def test_stop_phrasings_are_explicit_too(question, expected):
    assert parse_stop_delegation(question) is expected


async def test_the_ai_door_does_not_admit_delegation():
    """A2.1 delegation is typed-only: a model-emitted start_delegation is dropped, not proposed."""
    assert "start_delegation" in ALLOWED_ACTIONS
    assert validate_ai_proposal("start_delegation", {"duration_minutes": 120}) is None


async def test_reply_wording_identifies_toucan_and_promises_nothing():
    first = words.first_reply_text("bon@example.com")
    follow = words.follow_up_reply_text("micah.reyes@example.com")
    assert first.startswith("Toucan — assisting Bon:")
    assert "Bon is currently unavailable" in first and "Is this urgent?" in first
    assert follow.startswith("Toucan — assisting Micah Reyes:")
    for text in (first, follow, words.confirmation_text(StartDelegationAction(120))):
        lowered = text.lower()
        assert "@toucan" not in lowered  # can never re-invoke A1.4
        for forbidden in ("will respond", "will reply by", "approved", "deadline", "because", "at 3"):
            assert forbidden not in lowered
    assert "group @mentions" in words.confirmation_text(StartDelegationAction(120))
    assert "won't watch general group chatter" in words.confirmation_text(StartDelegationAction(120))
    assert words.proposal_summary(StartDelegationAction(90)) == (
        "Let Toucan handle your messages for 1 hour 30 minutes (direct messages + group @mentions)"
    )
    assert words.proposal_summary(StartDelegationAction(90, scope="dm")) == (
        "Let Toucan handle your messages for 1 hour 30 minutes (direct messages only)"
    )


# --- repository ---------------------------------------------------------------------------------


async def test_start_get_and_lazy_expiry(db_session):
    row, replaced = await repo.start_delegation(db_session, owner_email="Bon@Example.com", duration_minutes=120, now=NOW)
    assert replaced is False
    assert row.owner_email == VIEWER and row.status == "active" and row.scope == "dm"
    assert row.end_condition == "at_time" and row.reply_count == 0
    assert repo._as_aware_utc(row.expires_at) == NOW + timedelta(hours=2)
    assert repo._as_aware_utc(row.hard_cap_at) == NOW + timedelta(minutes=DELEGATION_MAX_MINUTES)

    assert (await repo.get_active_delegation(db_session, owner_email=VIEWER, now=NOW + timedelta(minutes=119))).id == row.id
    # One second past expiry: reported absent AND durably marked ended/expired.
    assert await repo.get_active_delegation(db_session, owner_email=VIEWER, now=NOW + timedelta(hours=2)) is None
    await db_session.refresh(row)
    assert row.status == "ended" and row.ended_reason == "expired"
    assert repo._as_aware_utc(row.ended_at) == NOW + timedelta(hours=2)
    # Ended rows are kept for audit.
    assert [d.id for d in await repo.list_delegations(db_session, owner_email=VIEWER)] == [row.id]


async def test_hard_cap_bounds_the_stored_window(db_session):
    row, _ = await repo.start_delegation(db_session, owner_email=VIEWER, duration_minutes=10**6, now=NOW)
    assert repo._as_aware_utc(row.expires_at) == NOW + timedelta(minutes=DELEGATION_MAX_MINUTES)
    assert await repo.get_active_delegation(db_session, owner_email=VIEWER, now=row.hard_cap_at) is None


async def test_one_active_per_owner_and_replacement(db_session):
    first, _ = await repo.start_delegation(db_session, owner_email=VIEWER, duration_minutes=60, now=NOW)
    second, replaced = await repo.start_delegation(db_session, owner_email=VIEWER, duration_minutes=30, now=NOW + timedelta(minutes=5))
    assert replaced is True and second.id != first.id
    await db_session.refresh(first)
    assert first.status == "ended" and first.ended_reason == "replaced"
    active = await repo.get_active_delegation(db_session, owner_email=VIEWER, now=NOW + timedelta(minutes=6))
    assert active.id == second.id
    assert len(await repo.list_delegations(db_session, owner_email=VIEWER)) == 2


async def test_cancel_ends_with_reason_and_keeps_the_row(db_session):
    row, _ = await repo.start_delegation(db_session, owner_email=VIEWER, duration_minutes=60, now=NOW)
    ended = await repo.end_delegation(db_session, owner_email=VIEWER, now=NOW + timedelta(minutes=1))
    assert ended.id == row.id and ended.status == "ended" and ended.ended_reason == "cancelled"
    assert await repo.end_delegation(db_session, owner_email=VIEWER, now=NOW + timedelta(minutes=2)) is None
    assert await repo.get_active_delegation(db_session, owner_email=VIEWER, now=NOW + timedelta(minutes=2)) is None
    assert len(await repo.list_delegations(db_session, owner_email=VIEWER)) == 1


async def test_owner_scoping(db_session):
    await repo.start_delegation(db_session, owner_email=VIEWER, duration_minutes=60, now=NOW)
    assert await repo.get_active_delegation(db_session, owner_email=OTHER, now=NOW) is None
    assert await repo.end_delegation(db_session, owner_email=OTHER, now=NOW) is None
    assert await repo.list_delegations(db_session, owner_email=OTHER) == []
    live = await repo.active_delegations_for_owners(db_session, [OTHER, VIEWER, ""], now=NOW)
    assert [d.owner_email for d in live] == [VIEWER]


# --- confirmation flow over the router ---------------------------------------------------------


@pytest.fixture(autouse=True)
async def _fresh_state(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(ToucanMessage.__table__.delete())
        await conn.execute(ToucanConversation.__table__.delete())
        await conn.execute(ToucanDelegation.__table__.delete())
    pending_actions.reset()
    yield
    pending_actions.reset()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _h(email: str = VIEWER) -> dict:
    return {"x-dev-email": email}


async def _ask(client, question: str, email: str = VIEWER) -> dict:
    res = await client.post("/toucan/ask", headers=_h(email), json={"question": question})
    assert res.status_code == 200, res.text
    return res.json()


async def _active_rows() -> list[ToucanDelegation]:
    from sqlalchemy import select

    async with app_db.async_session_maker() as session:
        rows = (await session.execute(select(ToucanDelegation))).scalars().all()
    return list(rows)


async def test_ask_proposes_only_and_activates_nothing():
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 2 hours.")
    action = body["action"]
    assert action["action"] == "start_delegation"
    assert action["durationMinutes"] == 120 and action["scope"] == "dm_and_groups"
    assert action["summary"] == "Let Toucan handle your messages for 2 hours (direct messages + group @mentions)"
    assert "group @mentions" in body["text"] and "confirm below" in body["text"]
    assert body["intent"] == "action_proposal"
    assert await _active_rows() == []
    async with _client() as client:
        assert (await client.get("/toucan/delegation", headers=_h())).json() is None


async def test_cancel_creates_nothing():
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 2 hours.")
        res = await client.post(f"/toucan/actions/{body['action']['id']}/cancel", headers=_h())
    assert res.status_code == 200
    assert res.json()["outcome"] == "cancelled" and res.json()["delegation"] is None
    assert await _active_rows() == []


async def test_confirm_creates_the_delegation_and_replay_cannot_create_another():
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 2 hours.")
        action_id = body["action"]["id"]
        res = await client.post(f"/toucan/actions/{action_id}/confirm", headers=_h())
        assert res.status_code == 200, res.text
        result = res.json()
        assert result["outcome"] == "executed" and result["action"] == "start_delegation"
        assert result["durationMinutes"] == 120 and result["scope"] == "dm_and_groups"
        delegation = result["delegation"]
        assert delegation["status"] == "active" and delegation["scope"] == "dm_and_groups"
        assert delegation["endCondition"] == "at_time" and delegation["replyCount"] == 0
        starts = datetime.fromisoformat(delegation["startsAt"].replace("Z", "+00:00"))
        expires = datetime.fromisoformat(delegation["expiresAt"].replace("Z", "+00:00"))
        assert expires - starts == timedelta(hours=2)
        assert "handling your messages (direct messages + group @mentions) for the next 2 hours" in result["text"]

        # Replay: the one-time entry is gone, and no second row appears.
        replay = await client.post(f"/toucan/actions/{action_id}/confirm", headers=_h())
        assert replay.status_code == 404 and replay.json()["error"] == ACTION_UNAVAILABLE_DETAIL

        current = (await client.get("/toucan/delegation", headers=_h())).json()
        assert current["id"] == delegation["id"]
    rows = await _active_rows()
    assert len(rows) == 1 and rows[0].owner_email == VIEWER and rows[0].status == "active"


async def test_confirm_is_owner_bound_and_the_row_is_owner_scoped():
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 1 hour.")
        action_id = body["action"]["id"]
        # Someone else cannot confirm it — and it stays in place for the real owner.
        res = await client.post(f"/toucan/actions/{action_id}/confirm", headers=_h(OTHER))
        assert res.status_code == 404
        assert await _active_rows() == []
        res = await client.post(f"/toucan/actions/{action_id}/confirm", headers=_h())
        assert res.status_code == 200
        # The other person sees nothing and cannot cancel it.
        assert (await client.get("/toucan/delegation", headers=_h(OTHER))).json() is None
        assert (await client.delete("/toucan/delegation", headers=_h(OTHER))).status_code == 404
        assert (await client.get("/toucan/delegation", headers=_h())).json()["status"] == "active"


async def test_a_second_confirmed_delegation_replaces_the_first():
    async with _client() as client:
        first = await _ask(client, "Handle my messages for 1 hour.")
        await client.post(f"/toucan/actions/{first['action']['id']}/confirm", headers=_h())
        second = await _ask(client, "Handle my messages for 3 hours.")
        res = await client.post(f"/toucan/actions/{second['action']['id']}/confirm", headers=_h())
        assert "replaced the delegation you already had" in res.json()["text"]
        current = (await client.get("/toucan/delegation", headers=_h())).json()
    rows = await _active_rows()
    assert sorted(r.status for r in rows) == ["active", "ended"]
    assert next(r for r in rows if r.status == "ended").ended_reason == "replaced"
    assert current["id"] == next(r for r in rows if r.status == "active").id


async def test_manual_cancel_via_endpoint_and_via_stop_phrase():
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 1 hour.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        res = await client.delete("/toucan/delegation", headers=_h())
        assert res.status_code == 200
        assert res.json()["status"] == "ended" and res.json()["endedReason"] == "cancelled"
        assert res.json()["endedAt"] is not None
        assert (await client.get("/toucan/delegation", headers=_h())).json() is None
        assert (await client.delete("/toucan/delegation", headers=_h())).status_code == 404

        # The typed stop phrase executes immediately — no proposal, no confirm.
        body = await _ask(client, "Handle my messages for 1 hour.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        stopped = await _ask(client, "I'm back, stop handling my messages.")
        assert stopped["intent"] == "delegation_stop" and "action" not in stopped
        assert stopped["text"] == words.stopped_text()
        assert (await client.get("/toucan/delegation", headers=_h())).json() is None
        again = await _ask(client, "stop handling my messages")
        assert again["text"] == words.nothing_to_stop_text()
    rows = await _active_rows()
    assert len(rows) == 2 and all(r.status == "ended" and r.ended_reason == "cancelled" for r in rows)


async def test_vague_absence_never_proposes_or_activates():
    async with _client() as client:
        for question in ("I'm away.", "Handle my messages until 3 PM", "handle my messages until 3"):
            body = await _ask(client, question)
            assert "action" not in body, question
    assert await _active_rows() == []


# --- privacy: structural ---------------------------------------------------------------------------

_BACKEND = pathlib.Path(__file__).resolve().parents[1]
_DELEGATION_MODULES = (
    _BACKEND / "app" / "services" / "chat_delegation.py",
    _BACKEND / "app" / "services" / "toucan" / "delegation.py",
    _BACKEND / "app" / "repositories" / "toucan_delegation.py",
    _BACKEND / "app" / "services" / "delegation_lifecycle.py",
    _BACKEND / "app" / "services" / "delegation_events.py",
    _BACKEND / "app" / "services" / "toucan" / "delegation_grounding.py",
)
_FORBIDDEN_IMPORT_PREFIXES = (
    "app.services.toucan.context",
    "app.services.toucan.roster",
    "app.services.toucan.memory",
    "app.services.toucan.ai_context",
    "app.services.toucan.office_assistant",
    "app.repositories.toucan_memory",
    "app.repositories.toucan_resources",
    "app.repositories.toucan_activity",
    "app.repositories.hub",
    "app.repositories.feed",
    "app.auth",
    "httpx",
    "openai",
)
# A2.4: the delegated path may call generate_delegated_answer and list_recent_messages (the same
# bounded read A1.4.3 uses) — and nothing else from the provider or the chat repository's readers.
_FORBIDDEN_CALLS = (
    "list_messages", "list_conversations_for_user", "generate_conversation_reply", "generate_answer",
    "build_office_context", "select_relevant_memories", "list_memories", "fetch_roster",
)


async def test_delegation_modules_import_no_context_provider_memory_or_atlas():
    offenders = []
    for path in _DELEGATION_MODULES:
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            for name in names:
                if any(name == p or name.startswith(p + ".") for p in _FORBIDDEN_IMPORT_PREFIXES):
                    offenders.append(f"{path.name}: imports {name}")
            if isinstance(node, ast.Attribute) and node.attr in _FORBIDDEN_CALLS:
                offenders.append(f"{path.name}: calls {node.attr}")
            if isinstance(node, ast.Name) and node.id in _FORBIDDEN_CALLS:
                offenders.append(f"{path.name}: references {node.id}")
    assert offenders == []


async def test_the_pure_delegation_module_owns_no_storage_and_reads_no_text():
    tree = ast.parse((_BACKEND / "app" / "services" / "toucan" / "delegation.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            root = (node.names[0].name if isinstance(node, ast.Import) else node.module or "").split(".")[0]
            assert root in {"re", "dataclasses", "__future__", "datetime", "zoneinfo"}, root
    # The reply templates take an OWNER EMAIL and nothing else — there is no parameter through
    # which a message body could reach the wording.
    import inspect

    for fn in (words.first_reply_text, words.follow_up_reply_text):
        assert list(inspect.signature(fn).parameters) == ["owner_email"]
    for fn in (words.combined_first_reply_text, words.combined_follow_up_reply_text):
        assert list(inspect.signature(fn).parameters) == ["owner_emails"]


# --- A2.2: combined wording (pure) -------------------------------------------------------------------


async def test_combined_wording_is_deterministic_and_names_only_the_given_owners():
    owners = ["micah@example.com", "Bon@Example.com", "bon@example.com"]
    assert words.sorted_owners(owners) == ["bon@example.com", "micah@example.com"]
    assert words.assisting_label(owners) == "Bon and Micah"
    assert words.assisting_label(["jan@x.com", "micah@x.com", "bon@x.com"]) == "Bon, Jan and Micah"
    text = words.combined_first_reply_text(owners)
    assert text == (
        "Toucan — assisting Bon and Micah: They're currently unavailable and will see your message "
        "when they return. Is this urgent?"
    )
    assert words.combined_follow_up_reply_text(owners) == (
        "Toucan — assisting Bon and Micah: They're still unavailable and will see this when they return."
    )
    # One owner keeps the A2.1 wording byte for byte.
    assert words.combined_first_reply_text(["bon@example.com"]) == words.first_reply_text("bon@example.com")
    assert words.combined_follow_up_reply_text(["bon@example.com"]) == words.follow_up_reply_text("bon@example.com")
    for t in (text, words.combined_follow_up_reply_text(owners)):
        assert "@toucan" not in t.lower() and "because" not in t.lower()


# --- A2.2: delegation_ended reaches the owner only ------------------------------------------------------


@pytest.fixture
def emitted(monkeypatch):
    from app.services import delegation_events

    seen: list[tuple[str, dict, str | None]] = []

    async def fake_emit(event, payload, room=None, **kwargs):
        seen.append((event, payload, room))

    monkeypatch.setattr(delegation_events.sio, "emit", fake_emit)
    return seen


async def test_delete_and_stop_phrase_emit_delegation_ended_to_the_owner_room_only(emitted):
    from app.realtime.state import user_room

    async with _client() as client:
        body = await _ask(client, "Handle my messages for 1 hour.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        assert emitted == []  # starting emits nothing
        res = await client.delete("/toucan/delegation", headers=_h())
        assert res.status_code == 200
    assert emitted == [("delegation_ended", {"delegationId": res.json()["id"], "reason": "cancelled"}, user_room(VIEWER))]
    emitted.clear()
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 1 hour.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        await _ask(client, "stop handling my messages")
    assert [(e, p["reason"], r) for e, p, r in emitted] == [("delegation_ended", "cancelled", user_room(VIEWER))]
    # Another user's DELETE neither ends nor emits anything.
    emitted.clear()
    async with _client() as client:
        body = await _ask(client, "Handle my messages for 1 hour.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        assert (await client.delete("/toucan/delegation", headers=_h(OTHER))).status_code == 404
    assert emitted == []


async def test_replacement_and_lazy_expiry_emit_delegation_ended(emitted):
    from app.realtime.state import user_room

    async with _client() as client:
        first = await _ask(client, "Handle my messages for 1 hour.")
        await client.post(f"/toucan/actions/{first['action']['id']}/confirm", headers=_h())
        second = await _ask(client, "Handle my messages for 2 hours.")
        await client.post(f"/toucan/actions/{second['action']['id']}/confirm", headers=_h())
    assert [(p["reason"], r) for _, p, r in emitted] == [("replaced", user_room(VIEWER))]
    emitted.clear()

    # An already-stale row, discovered by the owner's own GET: ended as expired, and told so.
    async with app_db.async_session_maker() as session:
        row, _ = await repo.start_delegation(
            session, owner_email=OTHER, duration_minutes=30, now=datetime.now(timezone.utc) - timedelta(hours=2)
        )
    async with _client() as client:
        assert (await client.get("/toucan/delegation", headers=_h(OTHER))).json() is None
    assert emitted == [("delegation_ended", {"delegationId": row.id, "reason": "expired"}, user_room(OTHER))]


# =====================================================================================================
# A2.3 — clock-time, until-return, hard cap, sweep, return detection (pure + repository + router)
# =====================================================================================================

from app.services import delegation_lifecycle as lifecycle
from app.services.toucan.delegation import (
    END_AT_TIME,
    END_UNTIL_RETURN,
    ClockProblem,
    DelegationClockRequest,
    resolve_clock_request,
)

MANILA_NOON_UTC = datetime(2026, 9, 4, 4, 0, tzinfo=timezone.utc)  # 12:00 Asia/Manila (UTC+8)


@pytest.mark.parametrize(
    ("question", "hour", "minute"),
    [
        ("Handle my messages until 3 PM.", 15, 0),
        ("Handle my messages until 3:30 PM.", 15, 30),
        ("While I’m away, handle my messages until 5 PM.", 17, 0),
        ("Cover my messages until 14:30.", 14, 30),
        ("handle my messages until 12 pm", 12, 0),
        ("handle my messages until 12:15 am", 0, 15),
        ("handle my dms until 09:15", 9, 15),
        ("handle my messages until 3 p.m. today", 15, 0),
    ],
)
async def test_clock_phrases_parse_to_an_unresolved_request(question, hour, minute):
    assert parse_delegation_request(question) == DelegationClockRequest(hour=hour, minute=minute)
    assert parse_action_request(question) == DelegationClockRequest(hour=hour, minute=minute)


@pytest.mark.parametrize(
    "question",
    [
        "handle my messages until 3",  # no AM/PM, could be either half of the day
        "handle my messages until 3:30",
        "handle my messages until 25:00",
        "handle my messages until 13 pm",
        "handle my messages until tomorrow",
        "handle my messages until 3 PM tomorrow",
        "I'll be back at 3 PM",
    ],
)
async def test_ambiguous_or_malformed_clock_phrases_are_refused(question):
    assert parse_delegation_request(question) is None


@pytest.mark.parametrize(
    "question",
    [
        "Handle my messages until I return.",
        "Handle my messages until I’m back.",
        "handle my messages until I am back",
        "While I’m away, handle my messages until I come back.",
        "cover my inbox for me until I get back",
    ],
)
async def test_until_return_phrases_parse(question):
    action = parse_delegation_request(question)
    assert isinstance(action, StartDelegationAction) and action.is_until_return
    assert action.duration_minutes is None and action.ends_at is None


@pytest.mark.parametrize("question", ["I'm away.", "I'll be back.", "I'm busy", "until I return", "I'm back"])
async def test_vague_absence_never_becomes_until_return(question):
    assert parse_delegation_request(question) is None


async def test_clock_resolution_uses_the_client_zone_and_refuses_past_or_unknown():
    req = DelegationClockRequest(hour=15, minute=0)
    resolved = resolve_clock_request(req, client_timezone="Asia/Manila", now=MANILA_NOON_UTC)
    assert isinstance(resolved, StartDelegationAction)
    assert resolved.ends_at == datetime(2026, 9, 4, 7, 0, tzinfo=timezone.utc)  # 15:00 Manila
    assert resolved.end_label == "3:00 PM today" and resolved.end_condition == END_AT_TIME
    # Same wall-clock, different zone, different instant.
    london = resolve_clock_request(req, client_timezone="Europe/London", now=MANILA_NOON_UTC)
    assert london.ends_at == datetime(2026, 9, 4, 14, 0, tzinfo=timezone.utc)  # BST
    # 10:00 Manila is behind 12:00 Manila: refused, never rolled to tomorrow.
    passed = resolve_clock_request(DelegationClockRequest(10, 0), client_timezone="Asia/Manila", now=MANILA_NOON_UTC)
    assert passed == ClockProblem(kind="already_passed", label="10:00 AM today")
    for bad in (None, "", "Mars/Olympus", "../etc", "x" * 80, "UTC; drop"):
        assert resolve_clock_request(req, client_timezone=bad, now=MANILA_NOON_UTC) == ClockProblem(kind="no_timezone")
    assert "haven't set anything up" in words.clock_problem_text(passed)
    assert "10:00 AM today has already passed" in words.clock_problem_text(passed)
    assert "time zone" in words.clock_problem_text(ClockProblem(kind="no_timezone"))


async def test_wording_for_clock_and_until_return():
    clock = resolve_clock_request(DelegationClockRequest(15, 0), client_timezone="Asia/Manila", now=MANILA_NOON_UTC)
    assert words.proposal_summary(clock) == "Let Toucan handle your messages until 3:00 PM today (direct messages + group @mentions)"
    assert "until 3:00 PM today" in words.confirmation_text(clock) and "confirm below" in words.confirmation_text(clock)
    assert words.executed_text(clock).startswith("Done — I'm handling your messages (direct messages + group @mentions) until 3:00 PM today.")
    ret = StartDelegationAction(None, end_condition=END_UNTIL_RETURN)
    assert words.proposal_summary(ret) == "Let Toucan handle your messages until you return (direct messages + group @mentions, maximum 24 hours)"
    assert "until you return — for at most 24 hours" in words.confirmation_text(ret)
    assert "until you return (24 hours at most)" in words.executed_text(ret)


# --- repository: windows, cap, return, sweep -------------------------------------------------------------


async def test_clock_end_and_until_return_rows_and_the_cap(db_session):
    ends = NOW + timedelta(hours=3)
    row, _ = await repo.start_delegation(db_session, owner_email=VIEWER, ends_at=ends, now=NOW)
    assert row.end_condition == "at_time" and repo._as_aware_utc(row.expires_at) == ends
    assert repo._as_aware_utc(row.hard_cap_at) == NOW + timedelta(hours=24)
    # An end beyond the cap is clamped to the cap: earliest wins.
    far, _ = await repo.start_delegation(db_session, owner_email=VIEWER, ends_at=NOW + timedelta(hours=30), now=NOW)
    assert repo._as_aware_utc(far.expires_at) == NOW + timedelta(hours=24)
    # An end already behind now is refused, and nothing is created for it.
    with pytest.raises(ValueError):
        await repo.start_delegation(db_session, owner_email=OTHER, ends_at=NOW - timedelta(minutes=1), now=NOW)
    assert await repo.get_active_delegation(db_session, owner_email=OTHER, now=NOW) is None
    with pytest.raises(ValueError):
        await repo.start_delegation(db_session, owner_email=OTHER, now=NOW)  # at_time with no window

    ret, _ = await repo.start_delegation(db_session, owner_email=OTHER, end_condition=END_UNTIL_RETURN, now=NOW)
    assert ret.end_condition == "until_return" and ret.expires_at is None
    assert repo._as_aware_utc(ret.hard_cap_at) == NOW + timedelta(hours=24)
    # Boundary: alive one second before the cap, ended AS expired at the cap.
    assert (await repo.get_active_delegation(db_session, owner_email=OTHER, now=NOW + timedelta(hours=24) - timedelta(seconds=1))) is not None
    assert await repo.get_active_delegation(db_session, owner_email=OTHER, now=NOW + timedelta(hours=24)) is None
    await db_session.refresh(ret)
    assert ret.status == "ended" and ret.ended_reason == "expired"


async def test_end_until_return_for_owner_is_the_only_return_path_and_ignores_timed_rows(db_session):
    timed, _ = await repo.start_delegation(db_session, owner_email=VIEWER, duration_minutes=60, now=NOW)
    assert await repo.end_until_return_for_owner(db_session, owner_email=VIEWER, now=NOW + timedelta(minutes=1)) is None
    await db_session.refresh(timed)
    assert timed.status == "active"  # a timed window is not presence tracking
    ret, _ = await repo.start_delegation(db_session, owner_email=OTHER, end_condition=END_UNTIL_RETURN, now=NOW)
    ended = await repo.end_until_return_for_owner(db_session, owner_email=OTHER, now=NOW + timedelta(minutes=5))
    assert ended.id == ret.id and ended.status == "ended" and ended.ended_reason == "returned"
    assert repo._as_aware_utc(ended.ended_at) == NOW + timedelta(minutes=5)
    assert await repo.end_until_return_for_owner(db_session, owner_email=OTHER, now=NOW + timedelta(minutes=6)) is None


async def test_expire_stale_ends_each_row_once_and_leaves_future_rows(db_session):
    seen: list[str] = []

    async def hook(row):
        seen.append(row.id)

    old, _ = await repo.start_delegation(db_session, owner_email="a@example.com", duration_minutes=30, now=NOW)
    capped, _ = await repo.start_delegation(db_session, owner_email="b@example.com", end_condition=END_UNTIL_RETURN, now=NOW)
    # Starts a day later, so at the +25h sweep it is still well inside its own window.
    fresh, _ = await repo.start_delegation(db_session, owner_email="c@example.com", duration_minutes=600, now=NOW + timedelta(hours=24))
    assert await repo.expire_stale_delegations(db_session, now=NOW, on_ended=hook) == []
    ended = await repo.expire_stale_delegations(db_session, now=NOW + timedelta(hours=25), on_ended=hook)
    assert sorted(r.id for r in ended) == sorted([old.id, capped.id]) and sorted(seen) == sorted([old.id, capped.id])
    assert all(r.ended_reason == "expired" for r in ended)
    # A second sweep (or a lazy read) finds nothing left to end — and emits nothing again.
    assert await repo.expire_stale_delegations(db_session, now=NOW + timedelta(hours=26), on_ended=hook) == []
    assert len(seen) == 2
    await db_session.refresh(fresh)
    assert fresh.status == "active"
    # Empty table is fine too.
    for r in (fresh,):
        await repo.end_delegation(db_session, owner_email=r.owner_email, now=NOW + timedelta(hours=26))
    assert await repo.expire_stale_delegations(db_session, now=NOW + timedelta(days=3), on_ended=hook) == []


# --- router: clock time, until return, return-on-ask, sweep task --------------------------------------------


async def _ask_tz(client, question: str, tz: str | None, email: str = VIEWER) -> dict:
    body = {"question": question}
    if tz is not None:
        body["clientTimezone"] = tz
    res = await client.post("/toucan/ask", headers=_h(email), json=body)
    assert res.status_code == 200, res.text
    return res.json()


async def test_clock_time_is_proposed_with_the_resolved_end_and_created_only_on_confirm(emitted):
    # 23:59 local anywhere is still ahead today for at least one zone; pick a zone where the
    # wall-clock target is certainly in the future by asking for 23:59 in a zone where it's early.
    from zoneinfo import ZoneInfo

    now_utc = datetime.now(timezone.utc)
    # Choose the zone whose local hour is smallest right now, so 23:59 is comfortably ahead.
    zone = min(("Pacific/Honolulu", "America/Los_Angeles", "Europe/London", "Asia/Manila", "Pacific/Auckland"),
               key=lambda z: now_utc.astimezone(ZoneInfo(z)).hour)
    async with _client() as client:
        body = await _ask_tz(client, "Handle my messages until 11:59 PM.", zone)
        action = body["action"]
        assert action["action"] == "start_delegation" and action["endCondition"] == "at_time"
        assert action.get("durationMinutes") is None and action["scope"] == "dm_and_groups"
        assert action["summary"] == "Let Toucan handle your messages until 11:59 PM today (direct messages + group @mentions)"
        ends = datetime.fromisoformat(action["endsAt"].replace("Z", "+00:00"))
        assert ends.astimezone(ZoneInfo(zone)).strftime("%H:%M") == "23:59" and ends > now_utc
        assert await _active_rows() == []  # proposal only
        # Cancel creates nothing.
        await client.post(f"/toucan/actions/{action['id']}/cancel", headers=_h())
        assert await _active_rows() == []
        body = await _ask_tz(client, "Handle my messages until 11:59 PM.", zone)
        res = await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        assert res.status_code == 200, res.text
        result = res.json()
        assert result["endCondition"] == "at_time" and result["endsAt"] == body["action"]["endsAt"]
        assert result["delegation"]["expiresAt"] == body["action"]["endsAt"]
        assert "until 11:59 PM today" in result["text"]
    rows = await _active_rows()
    assert len(rows) == 1 and rows[0].end_condition == "at_time"
    assert emitted == []


async def test_clock_time_refuses_missing_bad_timezone_and_already_passed(emitted):
    from zoneinfo import ZoneInfo

    async with _client() as client:
        for tz in (None, "Mars/Olympus", "not a zone"):
            body = await _ask_tz(client, "Handle my messages until 3 PM.", tz)
            assert "action" not in body and body["intent"] == "delegation_clarify"
            assert "time zone" in body["text"]
        # A wall-clock one hour behind the caller's local now.
        zone = "Asia/Manila"
        local_now = datetime.now(ZoneInfo(zone))
        past = (local_now - timedelta(hours=1)).replace(minute=0)
        if past.hour < local_now.hour:  # skip only the midnight wrap
            phrase = f"Handle my messages until {past.hour % 12 or 12} {'PM' if past.hour >= 12 else 'AM'}."
            body = await _ask_tz(client, phrase, zone)
            assert "action" not in body and body["intent"] == "delegation_clarify"
            assert "has already passed" in body["text"] and "tomorrow" not in body["text"]
    assert await _active_rows() == []


async def test_until_return_is_proposed_and_confirmed_with_a_cap_and_no_expiry():
    async with _client() as client:
        body = await _ask(client, "Handle my messages until I return.")
        action = body["action"]
        assert action["endCondition"] == "until_return" and action.get("endsAt") is None and action.get("durationMinutes") is None
        assert action["summary"].endswith("(direct messages + group @mentions, maximum 24 hours)")
        assert "for at most 24 hours" in body["text"]
        assert await _active_rows() == []
        res = await client.post(f"/toucan/actions/{action['id']}/confirm", headers=_h())
        assert res.status_code == 200, res.text
        d = res.json()["delegation"]
        assert d["endCondition"] == "until_return" and d["expiresAt"] is None
        cap = datetime.fromisoformat(d["hardCapAt"].replace("Z", "+00:00"))
        start = datetime.fromisoformat(d["startsAt"].replace("Z", "+00:00"))
        assert cap - start == timedelta(hours=24)
        assert "until you return (24 hours at most)" in res.json()["text"]
        assert (await client.get("/toucan/delegation", headers=_h())).json()["endCondition"] == "until_return"


async def test_an_owner_toucan_question_ends_until_return_but_not_a_timed_delegation(emitted):
    from app.realtime.state import user_room

    async with _client() as client:
        body = await _ask(client, "Handle my messages until I return.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        # Another delegation request does NOT count as returning (the owner is arranging absence).
        again = await _ask(client, "Handle my messages until I return.")
        assert (await client.get("/toucan/delegation", headers=_h())).json()["status"] == "active"
        await client.post(f"/toucan/actions/{again['action']['id']}/cancel", headers=_h())
        assert emitted == []
        # Somebody ELSE asking Toucan changes nothing for this owner.
        await _ask(client, "who is online?", email=OTHER)
        assert (await client.get("/toucan/delegation", headers=_h())).json() is not None
        # The owner's own ordinary question ends it as returned, owner-only event.
        await _ask(client, "who is online?")
        assert (await client.get("/toucan/delegation", headers=_h())).json() is None
        assert [(p["reason"], r) for _, p, r in emitted] == [("returned", user_room(VIEWER))]
        rows = await _active_rows()
        assert rows[-1].ended_reason == "returned" and rows[-1].ended_at is not None
        emitted.clear()
        # A timed delegation is untouched by the owner's questions.
        body = await _ask(client, "Handle my messages for 2 hours.")
        await client.post(f"/toucan/actions/{body['action']['id']}/confirm", headers=_h())
        await _ask(client, "who is online?")
        assert (await client.get("/toucan/delegation", headers=_h())).json()["status"] == "active"
    assert emitted == []


async def test_sweep_ends_expired_and_capped_rows_and_the_task_starts_and_stops_cleanly(emitted, monkeypatch):
    from app.realtime.state import user_room

    past = datetime.now(timezone.utc) - timedelta(hours=25)
    async with app_db.async_session_maker() as session:
        old, _ = await repo.start_delegation(session, owner_email=VIEWER, duration_minutes=60, now=past)
        capped, _ = await repo.start_delegation(session, owner_email=OTHER, end_condition=END_UNTIL_RETURN, now=past)
        fresh, _ = await repo.start_delegation(session, owner_email="c@example.com", duration_minutes=600)
    # Nothing arrives, nobody reads — the sweep alone ends them.
    assert await lifecycle.sweep_once() == 2
    assert sorted((p["delegationId"], p["reason"], r) for _, p, r in emitted) == sorted(
        [(old.id, "expired", user_room(VIEWER)), (capped.id, "expired", user_room(OTHER))]
    )
    async with app_db.async_session_maker() as session:
        assert (await repo.get_active_delegation(session, owner_email="c@example.com")).id == fresh.id
    assert await lifecycle.sweep_once() == 0  # idempotent, no second emission
    assert len(emitted) == 2

    # The task: disabled at <= 0, runs at a tiny interval, and stop() cancels cleanly.
    sweeper = lifecycle.DelegationSweeper()
    sweeper.start(0)
    assert not sweeper.running
    calls: list[int] = []

    async def fake_sweep(now=None):
        calls.append(1)
        return 0

    monkeypatch.setattr(lifecycle, "sweep_once", fake_sweep)
    sweeper.start(0.01)
    assert sweeper.running
    sweeper.start(0.01)  # idempotent
    import asyncio

    await asyncio.sleep(0.08)
    await sweeper.stop()
    assert not sweeper.running and len(calls) >= 2
    await sweeper.stop()  # second stop is a no-op


# =====================================================================================================
# A2.4 — grounded delegated answers: the deterministic walls (pure) and the provider seam's shape
# =====================================================================================================

import json
from datetime import datetime as _dt
from types import SimpleNamespace

from app.services.toucan import delegation_grounding as grounding
from app.services.toucan_ai import provider


@pytest.mark.parametrize(
    "question",
    [
        "@Bon where is the presentation?",
        "What did Bon say about the demo?",
        "which link did bon share?",
        "when did Bon say the release was happening?",
        "did Bon mention the venue?",
        "Where's the shared folder?",
        "@Bon what did you say about the venue?",
        "which folder did you put the presentation in?",
    ],
)
async def test_retrieval_questions_are_recognised(question):
    assert grounding.is_retrieval_question(question)


@pytest.mark.parametrize(
    "question",
    [
        "@Bon can we move the deadline to Friday?",  # deadline change / commitment
        "do you approve the budget?",  # approval
        "Bon, will you take this task?",  # task acceptance
        "could you review my PR by tomorrow?",  # commitment
        "what do you think about the design?",  # opinion
        "which option do you prefer?",  # preference
        "how long will the migration take?",  # estimate
        "should we ship today?",  # decision
        "is it okay to extend the deadline?",  # permission + change
        "what is Bon's salary?",  # HR/private
        "where is the admin password?",  # security-sensitive
        "who owns this task?",  # ownership decision
        "where is the presentation",  # not even a question mark
        "the presentation is in Drive?",  # not retrieval-shaped
        "x" * 301 + "?",
        "",
    ],
)
async def test_unsafe_or_unshaped_questions_never_reach_the_provider(question):
    assert not grounding.is_retrieval_question(question)


def _row(i: str, sender: str, text: str, minute: int):
    return SimpleNamespace(id=i, sender_email=sender, text=text, sent_at=_dt(2026, 9, 4, 9, minute, tzinfo=timezone.utc))


BON, MICAH, TOUCAN = "bon@example.com", "micah@example.com", "toucan@virtual-office.local"
LIMITS = {"exclude_sender": TOUCAN, "max_messages": 20, "max_message_chars": 600, "max_total_chars": 4000}


async def test_evidence_window_is_bounded_labelled_and_excludes_toucan_and_the_question():
    rows = [
        _row("m1", MICAH, "where do we keep the deck?", 1),
        _row("m2", BON, "The presentation is in the shared Drive folder.", 2),
        _row("m3", TOUCAN, "Toucan — assisting Bon: …", 3),
        _row("m4", MICAH, "@Bon where is the presentation?", 4),
        _row("m5", MICAH, "   ", 5),
    ]
    window = grounding.build_evidence_window(rows, owner_email=BON, incoming_id="m4", **LIMITS)
    assert window == [
        {"id": "m1", "author": "Micah", "fromOwner": False, "text": "where do we keep the deck?"},
        {"id": "m2", "author": "Bon", "fromOwner": True, "text": "The presentation is in the shared Drive folder."},
    ]
    assert grounding.has_owner_evidence(window)
    # Bounds: count, per-text, and total (oldest dropped first).
    many = [_row(f"r{i}", BON if i % 2 else MICAH, "x" * 700, i) for i in range(30)]
    window = grounding.build_evidence_window(many, owner_email=BON, incoming_id=None, **LIMITS)
    assert len(window) <= 20 and all(len(str(t["text"])) <= 600 for t in window)
    assert sum(len(str(t["text"])) for t in window) <= 4000
    assert window[-1]["id"] == "r29"
    assert not grounding.has_owner_evidence(
        grounding.build_evidence_window([_row("a", MICAH, "Bon said it's in Drive", 1)], owner_email=BON, incoming_id=None, **LIMITS)
    )


async def test_answer_validation_requires_owner_evidence_inside_the_window_and_safe_wording():
    window = [
        {"id": "m1", "author": "Micah", "fromOwner": False, "text": "I think it's in Drive"},
        {"id": "m2", "author": "Bon", "fromOwner": True, "text": "The presentation is in the shared Drive folder."},
    ]
    ok = {"canAnswer": True, "answer": "Earlier in this conversation, Bon said the presentation is in the shared Drive folder.", "evidenceMessageIds": ["m2"]}
    assert grounding.validate_grounded_answer(ok, window, BON) == ok["answer"]
    # A repeated prefix is stripped rather than doubled.
    doubled = dict(ok, answer="Toucan — assisting Bon: Bon said it is in Drive.")
    assert grounding.validate_grounded_answer(doubled, window, BON) == "Bon said it is in Drive."
    rejected = [
        dict(ok, canAnswer=False),
        dict(ok, canAnswer="true"),
        dict(ok, answer=""),
        dict(ok, answer="   "),
        dict(ok, answer="x" * 401),
        dict(ok, answer="I put it in Drive."),  # first person as the owner
        dict(ok, answer="Bon approved moving the deadline."),  # decision marker
        dict(ok, evidenceMessageIds=[]),
        dict(ok, evidenceMessageIds=["m1"]),  # only another participant's words
        dict(ok, evidenceMessageIds=["m2", "zzz"]),  # an id outside the window
        dict(ok, evidenceMessageIds=["m2", 7]),
        dict(ok, evidenceMessageIds="m2"),
        {"answer": "x"},
        None,
        "yes",
        [],
    ]
    for bad in rejected:
        assert grounding.validate_grounded_answer(bad, window, BON) is None, bad
    assert grounding.grounded_reply_text(BON, "Bon said it is in Drive.") == "Toucan — assisting Bon: Bon said it is in Drive."


async def test_provider_output_parsing_fails_closed_and_the_payload_carries_only_the_window():
    assert provider.parse_delegated_output('{"canAnswer": true, "answer": "a", "evidenceMessageIds": ["m2"]}') == {
        "canAnswer": True, "answer": "a", "evidenceMessageIds": ["m2"]
    }
    assert provider.parse_delegated_output('```json\n{"canAnswer": false}\n```') == {"canAnswer": False, "answer": None, "evidenceMessageIds": None}
    for bad in ("", "not json", "[1,2]", '"str"', None, 42, "{'single': 'quotes'}"):
        assert provider.parse_delegated_output(bad) is None
    window = [{"id": "m2", "author": "Bon", "fromOwner": True, "text": "in Drive"}]
    messages = provider._build_delegated_messages("where is it?", "Bon", window)
    assert [m["role"] for m in messages] == ["system", "user"] and messages[1]["content"] == "where is it?"
    system = messages[0]["content"]
    assert "covering for Bon" in system and json.dumps(window, separators=(",", ":")) in system
    for absent in ("OFFICE CONTEXT", "MEMORIES", "roster", "room", "status", "tool"):
        assert absent not in system, absent
    # Disabled provider → None without a request.
    assert await provider.generate_delegated_answer("where is it?", "Bon", window) is None
