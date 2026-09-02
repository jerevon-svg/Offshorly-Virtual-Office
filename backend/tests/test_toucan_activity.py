from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.activity_event import EVENT_CALL_MISSED, ActivityEvent
from app.models.conversation import Conversation, ConversationParticipant
from app.models.hub import HubItem, HubItemState
from app.models.message import Message
from app.models.toucan import ToucanAttentionCursor, ToucanConversation, ToucanMessage
from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.repositories import chat as chat_repo
from app.repositories import hub as hub_repo
from app.repositories import toucan_activity as activity_repo
from app.services.position_registry import position_registry
from app.services.toucan.activity import AttentionSnapshot
from app.services.toucan.context import build_office_context_from
from app.services.toucan.office_assistant import (
    ACTIVITY_UNAVAILABLE_TEXT,
    NO_ACTIVITY_HISTORY_TEXT,
    answer_question,
    is_activity_question,
)

# Toucan T2 — durable "while you were away" metadata.
#
# The questions this file exists to answer, in order:
#   1. is every count scoped to the viewer, and only the viewer?
#   2. is each count actually correct — chat, mentions, missed calls, Hub?
#   3. does the Hub count obey the Hub's OWN audience rules rather than a copy of them?
#   4. does any of it survive a process restart, which is the whole point of T2?
#   5. does the absence window mean what it is documented to mean?
#   6. can a single character anybody wrote reach a Toucan activity answer or payload?

pytestmark = pytest.mark.asyncio

ANGELO = "angelo@example.com"
MICAH = "micah@example.com"
BON = "bon@example.com"

_ALL_TABLES = (
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
async def _fresh_state(isolated_app_db):
    # `isolated_app_db` FIRST, and it is not optional: it repoints the application at a
    # throwaway database before anything below runs. Without it the truncations here would
    # execute against the developer's real virtual_office_fastapi.db (see tests/conftest.py).
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


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


def _ago(**kwargs) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


async def _cursor(email: str, *, away_since: datetime | None, last_seen_at: datetime | None = None):
    """Put a viewer's window where the test needs it, writing the row directly rather than
    replaying socket events — the window's PRODUCTION path is covered separately below."""
    async with app_db.async_session_maker() as session:
        session.add(
            ToucanAttentionCursor(
                email=email,
                last_seen_at=last_seen_at or datetime.now(timezone.utc),
                away_since=away_since,
            )
        )
        await session.commit()


async def _send(sender: str, recipient: str, text: str, *, mentions: list[str] | None = None) -> str:
    async with app_db.async_session_maker() as session:
        conversation = await chat_repo.upsert_conversation(session, sender, recipient)
        await chat_repo.insert_message(
            session, conversation["id"], sender, text, mentioned_emails=mentions
        )
        await session.commit()
        return conversation["id"]


async def _snapshot(email: str) -> AttentionSnapshot:
    async with app_db.async_session_maker() as session:
        return AttentionSnapshot.from_dict(
            await activity_repo.attention_snapshot(session, viewer_email=email)
        )


# --- viewer scoping ---------------------------------------------------------------------


async def test_a_viewer_only_ever_sees_their_own_activity():
    """The central claim. Micah's conversation with Bon, Micah's mentions and Micah's missed
    call must all be invisible to Angelo — not merely unlabelled, but absent from his counts."""
    await _cursor(ANGELO, away_since=_ago(days=2))
    await _cursor(MICAH, away_since=_ago(days=2))

    await _send(BON, MICAH, "a conversation angelo is not in", mentions=[MICAH])
    async with app_db.async_session_maker() as session:
        await activity_repo.record_missed_call(session, subject_email=MICAH, actor_email=BON)
        await session.commit()

    angelo = await _snapshot(ANGELO)
    assert (angelo.chat_count, angelo.mention_count, angelo.missed_call_count) == (0, 0, 0)

    micah = await _snapshot(MICAH)
    assert (micah.chat_count, micah.mention_count, micah.missed_call_count) == (1, 1, 1)


async def test_the_activity_endpoint_is_scoped_by_the_bearer_identity_alone():
    """No parameter exists through which a caller could name somebody else — and supplying one
    anyway changes nothing, because it is not read."""
    await _cursor(MICAH, away_since=_ago(days=2))
    await _send(BON, MICAH, "hello micah")

    async with await _client() as client:
        angelo = await client.get(
            "/toucan/activity?email=micah@example.com", headers=_headers(ANGELO)
        )
        micah = await client.get("/toucan/activity", headers=_headers(MICAH))

    assert angelo.status_code == 200
    assert angelo.json()["chatCount"] == 0
    assert micah.json()["chatCount"] == 1


async def test_the_activity_endpoint_requires_an_identity():
    async with await _client() as client:
        res = await client.get("/toucan/activity")
    assert res.status_code in (401, 403)


# --- the counts -------------------------------------------------------------------------


async def test_chat_count_covers_peer_messages_in_the_window_only():
    """Three exclusions in one test: the viewer's own messages, messages that predate the
    window, and messages in conversations the viewer is not a participant of."""
    await _cursor(ANGELO, away_since=_ago(hours=1))

    await _send(MICAH, ANGELO, "one")
    await _send(MICAH, ANGELO, "two")
    await _send(ANGELO, MICAH, "my own reply does not count")
    await _send(BON, MICAH, "not angelo's conversation")

    # A message stamped before the window opened is outside it.
    conversation_id = await _send(MICAH, ANGELO, "ancient history")
    async with app_db.async_session_maker() as session:
        rows = (
            await session.execute(
                select(Message).where(
                    Message.conversation_id == conversation_id,
                    Message.text == "ancient history",
                )
            )
        ).scalars().all()
        for row in rows:
            row.sent_at = _ago(days=3)
        await session.commit()

    snapshot = await _snapshot(ANGELO)
    assert snapshot.chat_count == 2


async def test_mention_count_is_the_subset_that_named_the_viewer():
    await _cursor(ANGELO, away_since=_ago(hours=1))
    await _send(MICAH, ANGELO, "plain message")
    await _send(MICAH, ANGELO, "tagged once", mentions=[ANGELO])
    await _send(MICAH, ANGELO, "tagged again", mentions=[ANGELO])
    # A tag aimed at somebody else in a conversation Angelo IS in still isn't his mention. The
    # repository validates membership at insert, so a non-participant tag is dropped entirely.
    await _send(MICAH, ANGELO, "tagged somebody else", mentions=[BON])

    snapshot = await _snapshot(ANGELO)
    assert snapshot.chat_count == 4
    assert snapshot.mention_count == 2


async def test_missed_call_count_reads_only_the_viewers_own_events():
    await _cursor(ANGELO, away_since=_ago(hours=1))
    async with app_db.async_session_maker() as session:
        await activity_repo.record_missed_call(
            session, subject_email=ANGELO, actor_email=MICAH, reference_id="inv-1"
        )
        await activity_repo.record_missed_call(session, subject_email=ANGELO, actor_email=BON)
        await activity_repo.record_missed_call(session, subject_email=BON, actor_email=ANGELO)
        await session.commit()

    assert (await _snapshot(ANGELO)).missed_call_count == 2
    assert (await _snapshot(BON)).missed_call_count == 0  # BON has no cursor -> no window


async def test_a_missed_call_event_stores_no_content():
    async with app_db.async_session_maker() as session:
        row = await activity_repo.record_missed_call(
            session, subject_email=ANGELO, actor_email=MICAH, reference_id="inv-9"
        )
        await session.commit()
    assert set(row) == {
        "id",
        "event_type",
        "subject_email",
        "actor_email",
        "reference_id",
        "created_at",
    }
    assert row["event_type"] == EVENT_CALL_MISSED
    # The columns that exist are the columns that can hold anything — there is no text column.
    assert {c.name for c in ActivityEvent.__table__.columns} == {
        "id",
        "event_type",
        "subject_email",
        "actor_email",
        "reference_id",
        "created_at",
        "updated_at",
    }


# --- Hub audience -----------------------------------------------------------------------


async def _hub_item(**kwargs):
    async with app_db.async_session_maker() as session:
        item = await hub_repo.create_item(session, **kwargs)
        await session.commit()
        return item


async def test_hub_count_respects_the_hubs_own_audience_rules():
    """An item addressed to Micah must not appear in Angelo's count, and an everyone-item must."""
    await _cursor(ANGELO, away_since=_ago(hours=2))
    now = datetime.now(timezone.utc)

    await _hub_item(
        type="announcement", title="for everyone", description="d", start_at=now - timedelta(minutes=30)
    )
    await _hub_item(
        type="announcement",
        title="for micah only",
        description="d",
        start_at=now - timedelta(minutes=30),
        audience_email=MICAH,
    )

    assert (await _snapshot(ANGELO)).hub_count == 1


async def test_hub_count_excludes_items_outside_the_window_or_already_opened():
    await _cursor(ANGELO, away_since=_ago(hours=2))
    now = datetime.now(timezone.utc)

    await _hub_item(
        type="announcement", title="new", description="d", start_at=now - timedelta(minutes=10)
    )
    await _hub_item(
        type="announcement", title="predates the window", description="d", start_at=now - timedelta(days=3)
    )
    already_seen = await _hub_item(
        type="announcement", title="already seen", description="d", start_at=now - timedelta(minutes=10)
    )
    async with app_db.async_session_maker() as session:
        await hub_repo.upsert_state(
            session, hub_item_id=already_seen["id"], employee_email=ANGELO, status="seen"
        )

    assert (await _snapshot(ANGELO)).hub_count == 1


async def test_important_count_rolls_up_attention_items_and_excludes_plain_chat_volume():
    await _cursor(ANGELO, away_since=_ago(hours=2))
    now = datetime.now(timezone.utc)

    for i in range(5):
        await _send(MICAH, ANGELO, f"ordinary chatter {i}")
    await _send(MICAH, ANGELO, "look at this", mentions=[ANGELO])
    async with app_db.async_session_maker() as session:
        await activity_repo.record_missed_call(session, subject_email=ANGELO, actor_email=BON)
        await session.commit()
    await _hub_item(
        type="announcement",
        title="required",
        description="d",
        start_at=now - timedelta(minutes=5),
        priority="required",
    )
    await _hub_item(
        type="announcement",
        title="ordinary",
        description="d",
        start_at=now - timedelta(minutes=5),
        priority="normal",
    )

    snapshot = await _snapshot(ANGELO)
    assert snapshot.chat_count == 6
    assert snapshot.hub_count == 2
    assert snapshot.pressing_hub_count == 1
    # 1 mention + 1 missed call + 1 required Hub item. The five ordinary messages and the
    # normal-priority item are deliberately not "important".
    assert snapshot.important_count == 3


# --- durability -------------------------------------------------------------------------


async def test_every_count_survives_a_backend_restart():
    """T2's reason for existing. The in-memory registries are wiped — as a process restart would
    wipe them — and every number must still be there, because every number came from a table."""
    await _cursor(ANGELO, away_since=_ago(days=2))
    await _send(MICAH, ANGELO, "still here after a restart", mentions=[ANGELO])
    async with app_db.async_session_maker() as session:
        await activity_repo.record_missed_call(session, subject_email=ANGELO, actor_email=MICAH)
        await session.commit()
    await _hub_item(
        type="announcement",
        title="fresh",
        description="d",
        start_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    before = await _snapshot(ANGELO)

    # Simulate the restart: every ephemeral store this backend has, emptied.
    offline_lineup._slot_by_email.clear()
    dnd_registry._dnd_emails.clear()
    room_presence._room_by_email.clear()
    spatial_sessions.reset()
    call_registry.reset()
    position_registry.reset()

    after = await _snapshot(ANGELO)
    assert (after.chat_count, after.mention_count, after.missed_call_count, after.hub_count) == (
        1,
        1,
        1,
        1,
    )
    assert (before.chat_count, before.mention_count) == (after.chat_count, after.mention_count)


# --- the absence window -----------------------------------------------------------------


async def test_a_first_sighting_records_no_absence():
    async with app_db.async_session_maker() as session:
        row = await activity_repo.record_arrival(session, email=ANGELO)
        await session.commit()
    assert row["away_since"] is None

    snapshot = await _snapshot(ANGELO)
    assert snapshot.since_reason == "tracking_started"
    assert not snapshot.window_is_a_real_absence


async def test_a_real_gap_freezes_the_absence_boundary():
    """The load-bearing behaviour: coming back after a long time must remember WHEN you left,
    not overwrite it with the moment you returned."""
    left_at = _ago(days=2)
    async with app_db.async_session_maker() as session:
        await activity_repo.record_departure(session, email=ANGELO, now=left_at)
        await session.commit()

    returned_at = datetime.now(timezone.utc)
    async with app_db.async_session_maker() as session:
        row = await activity_repo.record_arrival(session, email=ANGELO, now=returned_at)
        await session.commit()

    assert row["away_since"] == left_at
    assert row["last_seen_at"] == returned_at

    async with app_db.async_session_maker() as session:
        since, reason = await activity_repo.attention_window(session, viewer_email=ANGELO)
    assert since == left_at
    assert reason == "last_active"


async def test_the_window_starts_at_the_departure_not_at_the_session_that_preceded_it():
    """THE REGRESSION THIS EXISTS FOR. Connect at 09:00, leave at 17:00 with no explicit
    checkout, come back the next morning: the absence began at 17:00. Measuring from 09:00
    would report a whole working day's chat as "missed"."""
    monday_0900 = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
    monday_1700 = datetime(2026, 9, 1, 17, 0, tzinfo=timezone.utc)
    tuesday_0900 = datetime(2026, 9, 2, 9, 0, tzinfo=timezone.utc)

    async with app_db.async_session_maker() as session:
        await activity_repo.record_arrival(session, email=ANGELO, now=monday_0900)
        # The last socket goes away when the browser closes — no explicit checkout.
        await activity_repo.record_departure(session, email=ANGELO, now=monday_1700)
        row = await activity_repo.record_arrival(session, email=ANGELO, now=tuesday_0900)
        await session.commit()

    assert row["away_since"] == monday_1700
    assert row["away_since"] != monday_0900


async def test_a_departure_never_freezes_an_absence_by_itself():
    """A long SESSION is not a long ABSENCE. Eight hours present and eight hours away look
    identical to the arithmetic, so only an arrival is allowed to run it."""
    async with app_db.async_session_maker() as session:
        await activity_repo.record_arrival(session, email=ANGELO, now=_ago(hours=8))
        row = await activity_repo.record_departure(session, email=ANGELO)
        await session.commit()
    assert row["away_since"] is None


async def test_an_explicit_checkout_and_check_in_behaves_the_same_way():
    """go_offline is a departure and come_online is an arrival, so the same two rules apply:
    a short checkout is no absence, a long one is, and it is measured from the checkout."""
    checked_out_at = _ago(hours=3)
    async with app_db.async_session_maker() as session:
        await activity_repo.record_arrival(session, email=ANGELO, now=_ago(hours=6))
        await activity_repo.record_departure(session, email=ANGELO, now=checked_out_at)
        row = await activity_repo.record_arrival(session, email=ANGELO)
        await session.commit()
    assert row["away_since"] == checked_out_at

    async with app_db.async_session_maker() as session:
        brief_out = datetime.now(timezone.utc)
        await activity_repo.record_departure(session, email=MICAH, now=brief_out - timedelta(hours=1))
        await activity_repo.record_arrival(session, email=MICAH, now=brief_out)
        row = await activity_repo.record_departure(session, email=MICAH, now=brief_out + timedelta(seconds=30))
        after = await activity_repo.record_arrival(session, email=MICAH, now=brief_out + timedelta(seconds=60))
        await session.commit()
    # The 30-second checkout did not move the boundary off the earlier, real absence.
    assert after["away_since"] == brief_out - timedelta(hours=1)


async def test_a_refresh_does_not_reset_the_window():
    """A refresh is a departure immediately followed by an arrival. It must record no absence,
    and — crucially — must not overwrite the real boundary that is already frozen."""
    left_at = _ago(days=1)
    returned_at = datetime.now(timezone.utc)
    async with app_db.async_session_maker() as session:
        await activity_repo.record_departure(session, email=ANGELO, now=left_at)
        await activity_repo.record_arrival(session, email=ANGELO, now=returned_at)
        await session.commit()

    async with app_db.async_session_maker() as session:
        for offset in (1, 2, 3):
            await activity_repo.record_departure(
                session, email=ANGELO, now=returned_at + timedelta(seconds=offset * 2)
            )
            row = await activity_repo.record_arrival(
                session, email=ANGELO, now=returned_at + timedelta(seconds=offset * 2 + 1)
            )
        await session.commit()

    assert row["away_since"] == left_at  # unchanged by three refreshes


async def test_extra_sockets_connecting_do_not_move_the_boundary():
    """The ~10 sockets one browser opens all arrive within milliseconds. The first resolves the
    absence; the rest must be no-ops."""
    left_at = _ago(days=1)
    returned_at = datetime.now(timezone.utc)
    async with app_db.async_session_maker() as session:
        await activity_repo.record_departure(session, email=ANGELO, now=left_at)
        for offset in range(10):
            row = await activity_repo.record_arrival(
                session, email=ANGELO, now=returned_at + timedelta(milliseconds=offset)
            )
        await session.commit()
    assert row["away_since"] == left_at


async def test_a_gap_shorter_than_the_threshold_is_not_an_absence():
    first = _ago(days=1)
    async with app_db.async_session_maker() as session:
        await activity_repo.record_departure(session, email=ANGELO, now=first)
        row = await activity_repo.record_arrival(
            session,
            email=ANGELO,
            now=first + timedelta(seconds=activity_repo.ABSENCE_GAP_SECONDS - 1),
        )
        await session.commit()
    assert row["away_since"] is None


async def test_a_gap_at_exactly_the_threshold_is_an_absence():
    first = _ago(days=1)
    async with app_db.async_session_maker() as session:
        await activity_repo.record_departure(session, email=ANGELO, now=first)
        row = await activity_repo.record_arrival(
            session,
            email=ANGELO,
            now=first + timedelta(seconds=activity_repo.ABSENCE_GAP_SECONDS),
        )
        await session.commit()
    assert row["away_since"] == first


async def test_a_viewer_never_seen_gets_an_honest_empty_window():
    """No cursor means nothing was being watched. The window collapses to "now" so every count
    is truthfully zero rather than sweeping up history from before tracking began."""
    await _send(MICAH, ANGELO, "sent before angelo was ever seen")
    snapshot = await _snapshot(ANGELO)
    assert snapshot.since_reason == "no_history"
    assert snapshot.has_no_history
    assert snapshot.chat_count == 0


async def test_the_window_cannot_be_widened_by_the_caller():
    """There is no `since` parameter, and inventing one changes nothing."""
    await _cursor(ANGELO, away_since=_ago(minutes=5))
    conversation_id = await _send(MICAH, ANGELO, "old news")
    async with app_db.async_session_maker() as session:
        row = (
            await session.execute(
                select(Message).where(Message.conversation_id == conversation_id)
            )
        ).scalars().one()
        row.sent_at = _ago(days=30)
        await session.commit()

    async with await _client() as client:
        res = await client.get(
            "/toucan/activity?since=2000-01-01T00:00:00Z", headers=_headers(ANGELO)
        )
    assert res.json()["chatCount"] == 0


# --- deterministic answers --------------------------------------------------------------


def _ctx(email: str = ANGELO):
    return build_office_context_from(email)


def _snap(**kwargs) -> AttentionSnapshot:
    now = datetime.now(timezone.utc)
    return AttentionSnapshot(
        since=now - timedelta(days=1), since_reason="last_active", until=now, **kwargs
    )


async def test_the_away_summary_is_a_prioritised_digest():
    """T3 REPLACED THE WORDING OF THIS INTENT, and this test is the record of that.

    It used to assert a flat sentence in snapshot-field order ("You received 12 chat messages,
    were mentioned 3 times, ..."). That sentence answered "how much" when the question asked
    "what now", so the same six numbers are now re-ordered worst-first and given a lead. The
    intent name and the response contract are unchanged — only the prose is."""
    answer = answer_question(
        "What happened while I was gone?",
        _ctx(),
        activity=_snap(chat_count=15, mention_count=3, missed_call_count=1, hub_count=2,
                       pressing_hub_count=2, important_count=6),
    )
    assert answer.intent == "away_summary"
    assert answer.supported is True
    assert answer.text == (
        "While you were away:\n"
        "\u2022 3 mentions need your attention\n"
        "\u2022 1 missed call\n"
        "\u2022 2 priority Hub items\n"
        "\u2022 12 other chat messages\n"
        "\n"
        "Start with the mentions."
    )


async def test_each_narrow_question_gets_its_own_number():
    snapshot = _snap(chat_count=12, mention_count=3, missed_call_count=1, hub_count=2)
    cases = {
        "how many chats did i miss": ("missed_chats", "You received 12 chat messages"),
        "how many times was I mentioned?": ("missed_mentions", "You were mentioned 3 times"),
        "did I miss any calls?": ("missed_calls", "You missed 1 call"),
    }
    for question, (intent, opening) in cases.items():
        answer = answer_question(question, _ctx(), activity=snapshot)
        assert answer.intent == intent, question
        assert answer.text.startswith(opening), question


async def test_the_important_question_rolls_up_and_then_itemises():
    answer = answer_question(
        "Is there anything important I need to check?",
        _ctx(),
        activity=_snap(chat_count=40, mention_count=3, missed_call_count=1, pressing_hub_count=1,
                       important_count=5),
    )
    assert answer.intent == "important_summary"
    assert answer.text == (
        "5 things worth checking since you were last active: you were mentioned 3 times, "
        "you missed 1 call and there is 1 priority Hub item."
    )
    # 40 ordinary messages are not "important" and must not appear in the triage answer.
    assert "40" not in answer.text


async def test_an_empty_window_says_so_without_listing_zeroes():
    answer = answer_question("what did I miss", _ctx(), activity=_snap())
    assert answer.supported is True
    assert "0" not in answer.text
    assert answer.text.startswith("Nothing came in since you were last active")


async def test_answers_never_claim_an_absence_that_was_not_observed():
    tracking = AttentionSnapshot(
        since=datetime.now(timezone.utc),
        since_reason="tracking_started",
        until=datetime.now(timezone.utc),
        chat_count=2,
    )
    text = answer_question("what did I miss", _ctx(), activity=tracking).text
    # Case-insensitive since T3: the broad question now opens with the window as a HEADER
    # ("Since I started keeping track:") rather than closing with it as a clause. The claim
    # under test is unchanged — it must name the tracking window and must not imply an absence.
    assert "since i started keeping track" in text.lower()
    assert "away" not in text

    none_yet = AttentionSnapshot(
        since=datetime.now(timezone.utc),
        since_reason="no_history",
        until=datetime.now(timezone.utc),
    )
    assert answer_question("what did I miss", _ctx(), activity=none_yet).text == (
        NO_ACTIVITY_HISTORY_TEXT
    )


async def test_a_missing_snapshot_never_becomes_a_fabricated_zero():
    answer = answer_question("what did I miss", _ctx(), activity=None)
    assert answer.text == ACTIVITY_UNAVAILABLE_TEXT
    assert "0" not in answer.text
    assert "nothing" not in answer.text.lower()


async def test_activity_questions_are_answered_deterministically():
    snapshot = _snap(chat_count=3, mention_count=1)
    first = answer_question("what did I miss", _ctx(), activity=snapshot)
    second = answer_question("what did I miss", _ctx(), activity=snapshot)
    assert first == second


async def test_only_activity_phrasings_cost_a_database_round_trip():
    for question in (
        "what happened while I was gone",
        "what did I miss",
        "how many times was I mentioned",
        "did I miss any calls",
        "is there anything important I need to check",
    ):
        assert is_activity_question(question), question
    for question in ("who is online", "where is micah", "is micah available", "", "micah"):
        assert not is_activity_question(question), question


# --- privacy ----------------------------------------------------------------------------


async def test_no_message_body_reaches_an_activity_answer_or_payload():
    """The dynamic counterpart to tests/test_toucan_privacy.py's static sweep, aimed squarely
    at T2: real private text sitting in a real conversation, counted, and never echoed."""
    secret = "SECRET-T2-BODY-do-not-leak"
    await _cursor(ANGELO, away_since=_ago(hours=1))
    await _send(MICAH, ANGELO, secret, mentions=[ANGELO])

    async with await _client() as client:
        activity = await client.get("/toucan/activity", headers=_headers(ANGELO))
        answers = [
            await client.post("/toucan/ask", json={"question": q}, headers=_headers(ANGELO))
            for q in (
                "what happened while I was gone",
                "how many times was I mentioned",
                "is there anything important I need to check",
            )
        ]

    assert activity.json()["chatCount"] == 1
    assert secret not in activity.text
    for res in answers:
        assert res.status_code == 200
        assert secret not in res.text


async def test_the_activity_payload_has_no_channel_for_content():
    """Nine scalars wide. No conversation id, no title, no sender, nowhere for a body to ride."""
    await _cursor(ANGELO, away_since=_ago(hours=1))
    await _send(MICAH, ANGELO, "hello", mentions=[ANGELO])

    async with await _client() as client:
        body = (await client.get("/toucan/activity", headers=_headers(ANGELO))).json()

    assert set(body) == {
        "since",
        "sinceReason",
        "until",
        "chatCount",
        "mentionCount",
        "missedCallCount",
        "hubCount",
        "pressingHubCount",
        "importantCount",
    }
    for key, value in body.items():
        if key.endswith("Count"):
            assert isinstance(value, int), key


async def test_the_ask_response_shape_is_unchanged_by_t2():
    """T1's contract holds: four fields, and the activity numbers reach the user only as a
    worded sentence — there is no new field for a client to read counts out of."""
    await _cursor(ANGELO, away_since=_ago(hours=1))
    async with await _client() as client:
        body = (
            await client.post(
                "/toucan/ask",
                json={"question": "what did I miss"},
                headers=_headers(ANGELO),
            )
        ).json()
    assert set(body) == {"text", "intent", "supported", "conversationId"}
    assert body["intent"] == "away_summary"


async def test_an_activity_exchange_is_persisted_like_any_other():
    """T1's transcript keeps working, and stores only the question and the worded answer."""
    await _cursor(ANGELO, away_since=_ago(hours=1))
    await _send(MICAH, ANGELO, "a body that must not be written down")

    async with await _client() as client:
        asked = await client.post(
            "/toucan/ask", json={"question": "what did I miss"}, headers=_headers(ANGELO)
        )
        latest = await client.get("/toucan/conversations/latest", headers=_headers(ANGELO))

    assert asked.status_code == 200
    roles = [m["role"] for m in latest.json()["messages"]]
    assert roles == ["user", "assistant"]
    assert "a body that must not be written down" not in latest.text


# --- isolation guard ----------------------------------------------------------------------


async def test_the_toucan_tests_never_touch_a_real_database():
    """THE REGRESSION GUARD FOR A HAZARD THAT ALREADY BIT ONCE.

    Every fixture in the Toucan test surface truncates tables. Before tests/conftest.py's
    `isolated_app_db`, those truncations ran against whatever backend/.env pointed at — the
    developer's own virtual_office_fastapi.db — and a single `pytest` run destroyed real local
    Toucan history, chat conversations and Hub items.

    This asserts the sandbox is actually engaged rather than merely requested: the app's engine
    must be the throwaway one, and socket.py's by-value `async_session_maker` binding (the one
    that is easiest to forget, because patching app.database alone does not reach it) must have
    been redirected too."""
    from app.realtime import socket as socket_module

    url = str(app_db.engine.url)
    assert "isolated_test.db" in url, url
    for real in ("virtual_office", "dev_hub_playground"):
        assert real not in url, f"the app is pointed at a real database: {url}"

    # socket.py writes through its own binding, not through get_db — it must land in the sandbox.
    assert str(socket_module.async_session_maker.kw["bind"].url) == url
