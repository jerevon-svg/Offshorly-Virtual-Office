from __future__ import annotations

import importlib.util
import pathlib
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.repositories import toucan_delegation as delegation_repo
from app.repositories import toucan_urgency as repo
from app.services.toucan.activity import AttentionSnapshot
from app.services.toucan.context import build_office_context_from
from app.services.toucan.delegation import SCOPE_DM_AND_GROUPS
from app.services.toucan.office_assistant import answer_question
from app.services.toucan.urgency import (
    URGENCY_AFFIRMATIVE,
    URGENCY_EXPLICIT,
    URGENCY_NEGATIVE,
    classify_urgency_reply,
    urgent_flagged_reply_text,
)

# A3 — URGENCY: the deterministic classifier, the idempotent flag store, the owner-scoped
# endpoints, the attention digest wording, and the migration chain. The socket-level behaviour
# (who earns a flag, the confirmation, the owner event, cooldown/cap) lives in
# test_toucan_urgency_socket.py.

pytestmark = pytest.mark.asyncio

BON = "bon@example.com"
MICAH = "micah@example.com"
ALEX = "alex@example.com"
NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)


# --- classifier (pure) --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "yes",
        "Yes!",
        "yes please",
        "yep",
        "Yeah.",
        "it is",
        "definitely",
        "@Toucan yes",
        "Yes, it is.",
    ],
)
async def test_bare_affirmatives_are_affirmative(text):
    assert classify_urgency_reply(text) == URGENCY_AFFIRMATIVE


@pytest.mark.parametrize(
    "text",
    [
        "URGENT: prod is down",
        "this is urgent",
        "need this asap",
        "It's an emergency",
        "time-sensitive, please",
        "@Bon urgent — the deploy failed",
        "yes, urgent",
        "It's urgent",
    ],
)
async def test_explicit_markers_are_explicit(text):
    assert classify_urgency_reply(text) == URGENCY_EXPLICIT


@pytest.mark.parametrize(
    "text",
    [
        "no",
        "Nope",
        "no, thanks",
        "not really",
        "it's fine",
        "no rush",
        "not urgent",
        "it isn't urgent",
        "this is not urgent at all",
        "non-urgent",
        "no hurry, whenever you can",
        "it can wait",
        "nothing urgent",
    ],
)
async def test_negatives_and_negated_markers_are_negative(text):
    assert classify_urgency_reply(text) == URGENCY_NEGATIVE


@pytest.mark.parametrize(
    "text",
    [
        "",
        None,
        "can you send me the deck?",
        "yes I saw the file, where is the other one?",
        "YES WE CAN ship on friday",
        "please review when you have a moment",
    ],
)
async def test_ordinary_messages_are_nothing(text):
    assert classify_urgency_reply(text) is None


async def test_confirmation_wording_names_the_owner_and_promises_nothing():
    single = urgent_flagged_reply_text([BON])
    assert single.startswith("Toucan — assisting Bon:")
    assert "flagged this as urgent for Bon" in single
    assert "as soon as they're back" in single
    for banned in ("will call", "within", "minutes", "approved", "@toucan"):
        assert banned not in single.lower()
    combined = urgent_flagged_reply_text([MICAH, BON])
    assert combined.startswith("Toucan — assisting Bon and Micah:")
    assert "for them" in combined


# --- durable flags ------------------------------------------------------------------------------


async def _fresh_schema(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _delegation(owner: str):
    async with app_db.async_session_maker() as session:
        row, _ = await delegation_repo.start_delegation(
            session, owner_email=owner, duration_minutes=120, scope=SCOPE_DM_AND_GROUPS
        )
    return row


async def test_recording_the_same_declaration_twice_is_one_flag(isolated_app_db):
    await _fresh_schema(isolated_app_db)
    d = await _delegation(BON)
    async with app_db.async_session_maker() as session:
        first, created = await repo.record_urgent_flag(
            session, delegation=d, conversation_id="conv-1", requester_email=MICAH, message_reference="m1", now=NOW
        )
        again, created_again = await repo.record_urgent_flag(
            session, delegation=d, conversation_id="conv-1", requester_email="Micah@Example.com", message_reference="m2"
        )
        other_conv, created_other = await repo.record_urgent_flag(
            session, delegation=d, conversation_id="conv-2", requester_email=MICAH
        )
        other_requester, created_alex = await repo.record_urgent_flag(
            session, delegation=d, conversation_id="conv-1", requester_email=ALEX
        )
    assert created and not created_again and created_other and created_alex
    assert again.id == first.id and again.message_reference == "m1"
    assert first.owner_email == BON and first.requester_email == MICAH and first.seen_at is None
    assert len({first.id, other_conv.id, other_requester.id}) == 3
    async with app_db.async_session_maker() as session:
        assert await repo.count_unseen_for_delegation(session, delegation_id=d.id, owner_email=BON) == 3
        assert await repo.count_unseen_for_owner(session, owner_email=BON) == 3
        assert await repo.count_unseen_for_owner(session, owner_email=MICAH) == 0


async def test_flags_are_owner_scoped_and_seen_marks_only_the_callers(isolated_app_db):
    await _fresh_schema(isolated_app_db)
    bon_d = await _delegation(BON)
    micah_d = await _delegation(MICAH)
    async with app_db.async_session_maker() as session:
        bon_flag, _ = await repo.record_urgent_flag(session, delegation=bon_d, conversation_id="c1", requester_email=ALEX, now=NOW)
        micah_flag, _ = await repo.record_urgent_flag(
            session, delegation=micah_d, conversation_id="c2", requester_email=ALEX, now=NOW + timedelta(minutes=1)
        )
        # Another owner's id is ignored, not an error.
        assert await repo.mark_seen(session, owner_email=BON, flag_ids=[micah_flag.id]) == 0
        assert [f.id for f in await repo.list_unseen(session, owner_email=MICAH)] == [micah_flag.id]
        # Marking one's own works once; a second call changes nothing.
        assert await repo.mark_seen(session, owner_email=BON, flag_ids=[bon_flag.id]) == 1
        assert await repo.mark_seen(session, owner_email=BON, flag_ids=[bon_flag.id]) == 0
        assert await repo.list_unseen(session, owner_email=BON) == []
        assert await repo.count_unseen_for_delegation(session, delegation_id=bon_d.id, owner_email=BON) == 0
        # "All" marks only the caller's rows.
        assert await repo.mark_seen(session, owner_email=MICAH, flag_ids=None) == 1
        assert await repo.mark_seen(session, owner_email=MICAH, flag_ids=[]) == 0


async def test_list_unseen_is_newest_first(isolated_app_db):
    await _fresh_schema(isolated_app_db)
    d = await _delegation(BON)
    async with app_db.async_session_maker() as session:
        older, _ = await repo.record_urgent_flag(session, delegation=d, conversation_id="c1", requester_email=ALEX, now=NOW)
        newer, _ = await repo.record_urgent_flag(
            session, delegation=d, conversation_id="c2", requester_email=MICAH, now=NOW + timedelta(minutes=5)
        )
        assert [f.id for f in await repo.list_unseen(session, owner_email=BON)] == [newer.id, older.id]


# --- endpoints ----------------------------------------------------------------------------------


def _h(email: str = BON) -> dict[str, str]:
    return {"x-dev-email": email}


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


async def test_urgent_endpoints_are_owner_scoped_and_count_rides_on_the_delegation(isolated_app_db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "development")
    await _fresh_schema(isolated_app_db)
    d = await _delegation(BON)
    async with app_db.async_session_maker() as session:
        flag, _ = await repo.record_urgent_flag(session, delegation=d, conversation_id="conv-9", requester_email=MICAH, now=NOW)
    async with await _client() as client:
        active = (await client.get("/toucan/delegation", headers=_h())).json()
        assert active["id"] == d.id and active["urgentCount"] == 1

        listed = (await client.get("/toucan/delegation/urgent", headers=_h())).json()
        assert listed == [
            {
                "id": flag.id,
                "delegationId": d.id,
                "conversationId": "conv-9",
                "requesterEmail": MICAH,
                "requesterLabel": "Micah",
                "flaggedAt": "2026-09-04T12:00:00.000Z",
                "seenAt": None,
            }
        ]
        # No text anywhere on the wire.
        assert "text" not in listed[0] and "message" not in listed[0]

        # Another owner sees nothing and cannot mark Bon's flag.
        assert (await client.get("/toucan/delegation/urgent", headers=_h(MICAH))).json() == []
        foreign = await client.post("/toucan/delegation/urgent/seen", headers=_h(MICAH), json={"flagIds": [flag.id]})
        assert foreign.status_code == 200 and foreign.json() == {"seenCount": 0}
        assert (await client.get("/toucan/delegation", headers=_h())).json()["urgentCount"] == 1

        # An identity smuggled into the body is refused.
        smuggled = await client.post(
            "/toucan/delegation/urgent/seen", headers=_h(MICAH), json={"flagIds": [flag.id], "email": BON}
        )
        assert smuggled.status_code == 422

        # The owner marks it seen; the counter and the list follow; a replay changes nothing.
        seen = await client.post("/toucan/delegation/urgent/seen", headers=_h(), json={"flagIds": [flag.id]})
        assert seen.json() == {"seenCount": 1}
        assert (await client.get("/toucan/delegation/urgent", headers=_h())).json() == []
        assert (await client.get("/toucan/delegation", headers=_h())).json()["urgentCount"] == 0
        replay = await client.post("/toucan/delegation/urgent/seen", headers=_h(), json={"flagIds": [flag.id]})
        assert replay.json() == {"seenCount": 0}


async def test_ask_carries_the_unseen_flag_count_and_the_activity_wire_is_unchanged(isolated_app_db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "development")
    await _fresh_schema(isolated_app_db)
    d = await _delegation(BON)
    async with app_db.async_session_maker() as session:
        await repo.record_urgent_flag(session, delegation=d, conversation_id="c1", requester_email=MICAH, now=NOW)
        await repo.record_urgent_flag(session, delegation=d, conversation_id="c2", requester_email=ALEX, now=NOW)
    async with await _client() as client:
        # The structured activity payload keeps its T2 shape exactly — no new wire field.
        activity = (await client.get("/toucan/activity", headers=_h())).json()
        assert "delegatedUrgentCount" not in activity
        # The flags survive the owner's own question (asking Toucan is a return signal for
        # until_return rows; this row is timed) and the answer names them — even before this
        # person has any presence history to measure a window against.
        res = await client.post("/toucan/ask", headers=_h(), json={"question": "Is there anything urgent?"})
        assert res.status_code == 200
        assert "2 messages were flagged as urgent while Toucan covered for you" in res.json()["text"]
        res = await client.post("/toucan/ask", headers=_h(MICAH), json={"question": "Is there anything urgent?"})
        assert "flagged as urgent" not in res.json()["text"]


# --- digest wording (pure) ----------------------------------------------------------------------


def _snap(reason: str = "last_active", **counts) -> AttentionSnapshot:
    now = datetime.now(timezone.utc)
    return AttentionSnapshot(since=now - timedelta(days=1), since_reason=reason, until=now, **counts)


async def test_important_answer_puts_declared_urgency_first_and_counts_it():
    ctx = build_office_context_from(BON)
    only_flags = answer_question("anything urgent?", ctx, activity=_snap(delegated_urgent_count=1))
    assert only_flags.intent == "important_summary"
    assert only_flags.text == (
        "1 thing worth checking since you were last active: 1 message was flagged as urgent while "
        "Toucan covered for you."
    )
    mixed = answer_question(
        "Is there anything important I need to check?",
        ctx,
        activity=_snap(chat_count=40, mention_count=3, missed_call_count=1, pressing_hub_count=1,
                       important_count=5, delegated_urgent_count=2),
    )
    assert mixed.text == (
        "7 things worth checking since you were last active: 2 messages were flagged as urgent "
        "while Toucan covered for you, you were mentioned 3 times, you missed 1 call and there is "
        "1 priority Hub item."
    )
    # Zero flags: the A2/T3 wording is untouched.
    none = answer_question("anything urgent?", ctx, activity=_snap())
    assert none.text.startswith("Nothing looks urgent since you were last active")


async def test_digest_leads_with_declared_urgency_and_is_not_empty_on_flags_alone():
    ctx = build_office_context_from(BON)
    digest = answer_question("what did I miss", ctx, activity=_snap(delegated_urgent_count=1, chat_count=2))
    assert digest.intent == "away_summary"
    lines = digest.text.splitlines()
    assert lines[1] == "• 1 message was flagged as urgent while Toucan covered for you"
    assert digest.text.endswith("Start with the message flagged as urgent.")
    assert not _snap(delegated_urgent_count=1).is_empty


# --- migration chain ----------------------------------------------------------------------------


async def test_a3_migration_descends_from_presence_and_is_the_single_head():
    backend = pathlib.Path(__file__).resolve().parents[1]
    path = backend / "alembic" / "versions" / "c3d4e5f6a7b8_add_toucan_urgent_flags.py"
    spec = importlib.util.spec_from_file_location("a3_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "c3d4e5f6a7b8" and module.down_revision == "b1c2d3e4f5a6"
    source = path.read_text()
    for banned in ("text", "body", "preview", "content"):
        assert f'"{banned}"' not in source, banned
    script = ScriptDirectory.from_config(Config(str(backend / "alembic.ini")))
    assert script.get_heads() == ["c3d4e5f6a7b8"]
