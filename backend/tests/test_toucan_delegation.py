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
        "Handle my messages until 3 PM",  # clock time — A2.3
        "handle my messages until tomorrow",
        "handle my messages until I return",  # until-return — A2.3
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
    assert "DMs only" in words.confirmation_text(StartDelegationAction(120))
    assert words.proposal_summary(StartDelegationAction(90)) == (
        "Let Toucan handle your direct messages for 1 hour 30 minutes (DMs only)"
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
    assert action["durationMinutes"] == 120 and action["scope"] == "dm"
    assert action["summary"] == "Let Toucan handle your direct messages for 2 hours (DMs only)"
    assert "DMs only" in body["text"] and "confirm below" in body["text"]
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
        assert result["durationMinutes"] == 120 and result["scope"] == "dm"
        delegation = result["delegation"]
        assert delegation["status"] == "active" and delegation["scope"] == "dm"
        assert delegation["endCondition"] == "at_time" and delegation["replyCount"] == 0
        starts = datetime.fromisoformat(delegation["startsAt"].replace("Z", "+00:00"))
        expires = datetime.fromisoformat(delegation["expiresAt"].replace("Z", "+00:00"))
        assert expires - starts == timedelta(hours=2)
        assert "handling your direct messages for the next 2 hours" in result["text"]

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
        for question in ("I'm away.", "Handle my messages until 3 PM", "handle my messages until I return"):
            body = await _ask(client, question)
            assert "action" not in body, question
    assert await _active_rows() == []


# --- privacy: structural ---------------------------------------------------------------------------

_BACKEND = pathlib.Path(__file__).resolve().parents[1]
_DELEGATION_MODULES = (
    _BACKEND / "app" / "services" / "chat_delegation.py",
    _BACKEND / "app" / "services" / "toucan" / "delegation.py",
    _BACKEND / "app" / "repositories" / "toucan_delegation.py",
)
_FORBIDDEN_IMPORT_PREFIXES = (
    "app.services.toucan_ai",
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
_FORBIDDEN_CALLS = ("list_recent_messages", "list_messages", "generate_conversation_reply", "generate_answer")


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
            assert root in {"re", "dataclasses", "__future__"}, root
    # The reply templates take an OWNER EMAIL and nothing else — there is no parameter through
    # which a message body could reach the wording.
    import inspect

    for fn in (words.first_reply_text, words.follow_up_reply_text):
        assert list(inspect.signature(fn).parameters) == ["owner_email"]
