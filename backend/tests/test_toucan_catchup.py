from __future__ import annotations

# A5 — Return / Catch-Up. The per-conversation breakdown behind the digest, its endpoint, and
# the walls around it: the same server-derived window as everything else, viewer scoping through
# participation, no read cursor, no text, one row per conversation, nothing written.

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.activity_event import ActivityEvent
from app.models.conversation import Conversation, ConversationParticipant
from app.models.hub import HubItem, HubItemState
from app.models.message import Message
from app.models.toucan import (
    ToucanAttentionCursor,
    ToucanConversation,
    ToucanDelegation,
    ToucanMessage,
    ToucanUrgentFlag,
)
from app.realtime.state import call_registry, dnd_registry, offline_lineup, room_presence, spatial_sessions
from app.repositories import chat as chat_repo
from app.repositories import toucan_activity as activity_repo
from app.repositories import toucan_delegation as delegation_repo
from app.repositories import toucan_urgency as urgency_repo
from app.services.chat_send import TOUCAN_CHAT_SENDER
from app.services.position_registry import position_registry
from app.services.toucan.activity import AttentionSnapshot
from app.services.toucan.context import build_office_context_from
from app.services.toucan.delegation import SCOPE_DM_AND_GROUPS
from app.services.toucan.office_assistant import answer_question, is_activity_question

pytestmark = pytest.mark.asyncio

ANGELO = "angelo@example.com"
MICAH = "micah@example.com"
BON = "bon@example.com"
ALEX = "alex@example.com"

_ALL_TABLES = (
    ToucanUrgentFlag,
    ToucanDelegation,
    ActivityEvent,
    ToucanAttentionCursor,
    ToucanMessage,
    ToucanConversation,
    HubItemState,
    HubItem,
    Message,
    ConversationParticipant,
    Conversation,
)


@pytest.fixture(autouse=True)
async def _fresh_state(isolated_app_db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "development")
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for model in _ALL_TABLES:
            await conn.execute(model.__table__.delete())

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


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _h(email: str) -> dict:
    return {"x-dev-email": email}


def _ago(**kwargs) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


async def _cursor(email: str, *, away_since: datetime | None):
    async with app_db.async_session_maker() as session:
        session.add(
            ToucanAttentionCursor(email=email, last_seen_at=datetime.now(timezone.utc), away_since=away_since)
        )
        await session.commit()


async def _dm(sender: str, recipient: str, text: str, *, at: datetime | None = None, mentions=None) -> str:
    async with app_db.async_session_maker() as session:
        conversation = await chat_repo.upsert_conversation(session, sender, recipient)
        message = await chat_repo.insert_message(session, conversation["id"], sender, text, mentioned_emails=mentions)
        if at is not None:
            message.sent_at = at
        await session.commit()
        return conversation["id"]


async def _group(creator: str, members: list[str], title: str | None) -> str:
    async with app_db.async_session_maker() as session:
        return (await chat_repo.create_group_conversation(session, creator, members, title))["id"]


async def _post(conversation_id: str, sender: str, text: str, *, at: datetime | None = None, mentions=None):
    async with app_db.async_session_maker() as session:
        message = await chat_repo.insert_message(session, conversation_id, sender, text, mentioned_emails=mentions)
        if at is not None:
            message.sent_at = at
        await session.commit()


async def _flag(owner: str, conversation_id: str, requester: str) -> str:
    async with app_db.async_session_maker() as session:
        delegation, _ = await delegation_repo.start_delegation(
            session, owner_email=owner, duration_minutes=120, scope=SCOPE_DM_AND_GROUPS
        )
        flag, _ = await urgency_repo.record_urgent_flag(
            session, delegation=delegation, conversation_id=conversation_id, requester_email=requester
        )
        return flag.id


async def _catchup(email: str) -> dict:
    async with await _client() as client:
        response = await client.get("/toucan/catchup", headers=_h(email))
    assert response.status_code == 200, response.text
    return response.json()


# --- the window ------------------------------------------------------------------------------


async def test_the_endpoint_uses_the_attention_cursor_window_and_nothing_else():
    """The same `since` the digest is worded from: away_since, reason last_active. Messages
    before it are invisible however recent-looking; a query parameter cannot widen it."""
    boundary = _ago(hours=3)
    await _cursor(BON, away_since=boundary)
    old = await _dm(MICAH, BON, "before you left", at=_ago(hours=5))
    fresh = await _dm(ANGELO, BON, "while you were out", at=_ago(hours=1))

    body = await _catchup(BON)
    assert body["activity"]["sinceReason"] == "last_active"
    reported = datetime.fromisoformat(body["activity"]["since"].replace("Z", "+00:00"))
    assert abs((reported - boundary).total_seconds()) < 0.001
    assert [row["conversationId"] for row in body["conversations"]] == [fresh]
    assert old not in {row["conversationId"] for row in body["conversations"]}

    async with await _client() as client:
        widened = await client.get(
            "/toucan/catchup", headers=_h(BON), params={"since": _ago(days=30).isoformat()}
        )
    assert [row["conversationId"] for row in widened.json()["conversations"]] == [fresh]


async def test_no_history_returns_no_rows_and_tracking_started_is_labelled():
    fresh = await _dm(MICAH, ANGELO, "hello")  # no cursor row for Angelo at all
    body = await _catchup(ANGELO)
    assert body["activity"]["sinceReason"] == "no_history"
    assert body["conversations"] == [] and body["coveredCount"] == 0

    await _cursor(ANGELO, away_since=None)  # seen, never observed absent
    async with app_db.async_session_maker() as session:
        row = (await session.execute(__import__("sqlalchemy").select(ToucanAttentionCursor))).scalar_one()
        row.created_at = _ago(hours=1)
        await session.commit()
    await _post(fresh, MICAH, "again")
    body = await _catchup(ANGELO)
    assert body["activity"]["sinceReason"] == "tracking_started"
    assert [row["conversationId"] for row in body["conversations"]] == [fresh]


# --- scoping and counting --------------------------------------------------------------------


async def test_only_conversations_the_viewer_participates_in_are_returned():
    await _cursor(ANGELO, away_since=_ago(days=1))
    await _dm(BON, MICAH, "not angelo's", mentions=[MICAH])
    group = await _group(BON, [MICAH], "Design")
    await _post(group, MICAH, "still not angelo's")
    mine = await _dm(BON, ANGELO, "for angelo")

    body = await _catchup(ANGELO)
    assert [row["conversationId"] for row in body["conversations"]] == [mine]


async def test_own_messages_do_not_count_and_a_conversation_with_only_own_messages_is_not_a_row():
    await _cursor(ANGELO, away_since=_ago(days=1))
    quiet = await _dm(ANGELO, BON, "i said this myself")
    busy = await _dm(MICAH, ANGELO, "one")
    await _post(busy, ANGELO, "my reply")
    await _post(busy, MICAH, "two", mentions=[ANGELO])

    body = await _catchup(ANGELO)
    rows = {row["conversationId"]: row for row in body["conversations"]}
    assert quiet not in rows
    assert rows[busy]["newCount"] == 2 and rows[busy]["mentionCount"] == 1
    # Consistent with the snapshot's own window semantics.
    assert body["activity"]["chatCount"] == 2 and body["activity"]["mentionCount"] == 1


async def test_labels_are_the_peer_name_for_dms_and_the_title_for_groups_and_carry_no_text():
    await _cursor(ANGELO, away_since=_ago(days=1))
    dm = await _dm("micah.reyes@example.com", ANGELO, "secret body text")
    titled = await _group(BON, [ANGELO], "Launch Room")
    await _post(titled, BON, "another secret")
    untitled = await _group(MICAH, [ANGELO], None)
    await _post(untitled, MICAH, "third secret")

    body = await _catchup(ANGELO)
    by_id = {row["conversationId"]: row for row in body["conversations"]}
    assert by_id[dm]["type"] == "dm" and by_id[dm]["label"] == "Micah Reyes"
    assert by_id[titled]["type"] == "group" and by_id[titled]["label"] == "Launch Room"
    assert by_id[untitled]["label"] == "Group chat"
    assert "secret" not in str(body)
    for row in body["conversations"]:
        assert set(row) == {
            "conversationId", "type", "label", "newCount", "mentionCount", "urgent",
            "urgentFlagId", "urgentRequesterLabel", "toucanCovered", "lastRelevantAt",
        }


# --- urgent merge, coverage, order, dedup ---------------------------------------------------


async def test_an_unseen_urgent_flag_merges_into_the_same_row_and_a_seen_one_does_not():
    await _cursor(BON, away_since=_ago(days=1))
    conv = await _dm(MICAH, BON, "please look", mentions=[BON])
    flag_id = await _flag(BON, conv, MICAH)

    body = await _catchup(BON)
    assert len(body["conversations"]) == 1  # one row, not a flag row plus a message row
    row = body["conversations"][0]
    assert row["urgent"] is True and row["urgentFlagId"] == flag_id
    assert row["urgentRequesterLabel"] == "Micah" and row["mentionCount"] == 1
    assert body["delegatedUrgentCount"] == 1

    async with await _client() as client:
        await client.post("/toucan/delegation/urgent/seen", headers=_h(BON), json={"flagIds": [flag_id]})
    row = (await _catchup(BON))["conversations"][0]
    assert row["urgent"] is False and row["urgentFlagId"] is None and row["mentionCount"] == 1


async def test_a_flag_on_a_conversation_with_no_window_messages_still_gets_a_row_only_if_the_viewer_is_in_it():
    await _cursor(BON, away_since=_ago(minutes=30))
    flagged = await _dm(MICAH, BON, "flagged earlier", at=_ago(hours=2))  # outside the window
    await _flag(BON, flagged, MICAH)
    foreign = await _dm(MICAH, ANGELO, "not bon's")
    await _flag(BON, foreign, MICAH)  # a stray flag on a conversation Bon is not part of

    body = await _catchup(BON)
    assert [row["conversationId"] for row in body["conversations"]] == [flagged]
    assert body["conversations"][0]["newCount"] == 0 and body["conversations"][0]["urgent"] is True


async def test_toucan_replies_mark_a_row_covered_and_count_conversations_once():
    await _cursor(BON, away_since=_ago(days=1))
    covered = await _dm(MICAH, BON, "is bon around")
    await _post(covered, TOUCAN_CHAT_SENDER, "Toucan — assisting Bon: not right now")
    await _post(covered, TOUCAN_CHAT_SENDER, "Toucan — assisting Bon: flagged")
    plain = await _dm(ANGELO, BON, "hi")

    body = await _catchup(BON)
    by_id = {row["conversationId"]: row for row in body["conversations"]}
    assert by_id[covered]["toucanCovered"] is True and by_id[plain]["toucanCovered"] is False
    assert body["coveredCount"] == 1


async def test_rows_are_ordered_urgent_then_mention_then_new_then_covered_then_newest():
    await _cursor(BON, away_since=_ago(days=1))
    newer_plain = await _dm(ALEX, BON, "a", at=_ago(minutes=5))
    older_plain = await _dm("zed@example.com", BON, "b", at=_ago(minutes=50))
    mentioned = await _dm(ANGELO, BON, "c", at=_ago(hours=6), mentions=[BON])
    urgent = await _dm(MICAH, BON, "d", at=_ago(hours=12))
    await _flag(BON, urgent, MICAH)
    covered_only = await _group(ALEX, [BON], "Ops")
    await _post(covered_only, TOUCAN_CHAT_SENDER, "Toucan — assisting Bon: away", at=_ago(minutes=1))

    body = await _catchup(BON)
    order = [row["conversationId"] for row in body["conversations"]]
    # The covered-only group has a new message too (Toucan's), so it sorts in the "new" tier by
    # recency; coverage alone breaks ties only among rows with equal counts.
    assert order == [urgent, mentioned, covered_only, newer_plain, older_plain]
    assert len(order) == len(set(order))


# --- read-only ------------------------------------------------------------------------------


async def test_catchup_writes_nothing():
    """Two calls, identical answers; no cursor moved, no flag seen, no participant row touched."""
    await _cursor(BON, away_since=_ago(days=1))
    conv = await _dm(MICAH, BON, "x")
    await _flag(BON, conv, MICAH)

    async def state():
        async with app_db.async_session_maker() as session:
            from sqlalchemy import select

            cursor = (await session.execute(select(ToucanAttentionCursor))).scalar_one()
            flags = (await session.execute(select(ToucanUrgentFlag))).scalars().all()
            parts = (await session.execute(select(ConversationParticipant))).scalars().all()
            return (
                cursor.away_since, cursor.last_seen_at,
                [f.seen_at for f in flags],
                [(p.participant_email, p.last_read_at, p.last_delivered_at) for p in parts],
            )

    before = await state()
    first = await _catchup(BON)
    second = await _catchup(BON)
    assert first["conversations"] == second["conversations"]
    assert await state() == before


# --- the digest text --------------------------------------------------------------------------


async def test_the_return_phrasings_are_activity_questions_and_the_digest_names_coverage():
    for question in (
        "What did I miss?",
        "Catch me up.",
        "Bring me up to speed",
        "Anything important while I was away?",
        "I'm back, what did I miss?",
        "Did anything important happen while I was gone?",
    ):
        assert is_activity_question(question), question

    await _cursor(BON, away_since=_ago(days=1))
    conv = await _dm(MICAH, BON, "is bon around")
    await _post(conv, TOUCAN_CHAT_SENDER, "Toucan — assisting Bon: away")
    async with app_db.async_session_maker() as session:
        snapshot = await activity_repo.attention_snapshot(session, viewer_email=BON)
        snapshot["covered_count"] = await activity_repo.covered_conversation_count(
            session, viewer_email=BON, since=snapshot["since"], toucan_sender=TOUCAN_CHAT_SENDER
        )
    ctx = build_office_context_from(BON)
    answer = answer_question("catch me up", ctx, activity=AttentionSnapshot.from_dict(snapshot))
    assert answer.supported and answer.intent == "away_summary"
    assert "Toucan replied for you in 1 conversation" in answer.text
    assert "is bon around" not in answer.text and "Micah" not in answer.text


async def test_ask_endpoint_answers_catch_me_up_deterministically_with_coverage():
    await _cursor(BON, away_since=_ago(days=1))
    conv = await _dm(MICAH, BON, "is bon around")
    await _post(conv, TOUCAN_CHAT_SENDER, "Toucan — assisting Bon: away")
    async with await _client() as client:
        response = await client.post("/toucan/ask", headers=_h(BON), json={"question": "Anything important while I was away?"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["supported"] is True and body["intent"] == "important_summary"
