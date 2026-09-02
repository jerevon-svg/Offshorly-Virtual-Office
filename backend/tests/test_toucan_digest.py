from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import delete

from app import database as app_db
from app.main import fastapi_app
from app.models.activity_event import ActivityEvent
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
from app.services.position_registry import position_registry
from app.services.toucan.activity import AttentionSnapshot
from app.services.toucan.context import build_office_context_from
from app.services.toucan.office_assistant import (
    NO_ACTIVITY_HISTORY_TEXT,
    answer_question,
    is_activity_question,
)

# Toucan T3 — THE ATTENTION DIGEST.
#
# T2 answered "how much happened". T3 answers "what should I do about it", out of exactly the
# same six integers — no new column, no new query, no new event. The questions this file exists
# to answer:
#
#   1. does the digest order categories by how strongly they are aimed at the reader?
#   2. does each shape of activity (mixed / chat-only / Hub-only / empty) read correctly?
#   3. is every `since_reason` still described honestly, including the first-use case?
#   4. do T2's NARROW questions still get their narrow one-number answers?
#   5. can a single character anybody wrote reach a digest — through the wording, or the wire?
#
# Every test here uses the isolated app database from tests/conftest.py. Nothing in this file
# can reach virtual_office_fastapi.db or dev_hub_playground.db (see the isolation guard at the
# bottom, which asserts that rather than assuming it).

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

BULLET = "• "


@pytest.fixture(autouse=True)
async def _clean(isolated_app_db):
    """Takes `isolated_app_db` for its redirection side effect: the truncation below must never
    be able to reach a real developer database (see tests/conftest.py)."""

    def clear_registries():
        offline_lineup._slot_by_email.clear()
        dnd_registry._dnd_emails.clear()
        room_presence._room_by_email.clear()
        spatial_sessions.reset()
        call_registry.reset()
        position_registry.reset()

    async with app_db.async_session_maker() as session:
        for table in _ALL_TABLES:
            await session.execute(delete(table))
        await session.commit()
    clear_registries()
    yield
    clear_registries()


def _ctx(email: str = ANGELO):
    return build_office_context_from(email)


def _snap(reason: str = "last_active", **counts) -> AttentionSnapshot:
    now = datetime.now(timezone.utc)
    return AttentionSnapshot(
        since=now - timedelta(days=1), since_reason=reason, until=now, **counts
    )


def _digest(snapshot: AttentionSnapshot, question: str = "what did I miss") -> str:
    answer = answer_question(question, _ctx(), activity=snapshot)
    assert answer.intent == "away_summary", question
    assert answer.supported is True, question
    return answer.text


def _bullets(text: str) -> list[str]:
    return [line[len(BULLET):] for line in text.splitlines() if line.startswith(BULLET)]


# --- priority ordering ----------------------------------------------------------------------


async def test_the_digest_orders_categories_worst_first():
    """THE CORE T3 CONTRACT. Every category present at once, and the order is fixed: mentions,
    missed calls, priority Hub, ordinary chat, ordinary Hub."""
    text = _digest(
        _snap(chat_count=15, mention_count=3, missed_call_count=2, hub_count=5,
              pressing_hub_count=2, important_count=7)
    )
    assert _bullets(text) == [
        "3 mentions need your attention",
        "2 missed calls",
        "2 priority Hub items",
        "12 other chat messages",
        "3 other Hub items",
    ]


async def test_the_digest_never_double_counts_a_mention_or_a_priority_hub_item():
    """`mention_count` is a SUBSET of `chat_count` and `pressing_hub_count` of `hub_count` (see
    repositories/toucan_activity.py). The digest must subtract before it prints, or three
    mentions and nothing else would be reported as three mentions plus three chat messages."""
    text = _digest(_snap(chat_count=3, mention_count=3, hub_count=2, pressing_hub_count=2))
    assert _bullets(text) == [
        "3 mentions need your attention",
        "2 priority Hub items",
    ]
    assert "chat message" not in text


async def test_a_subset_count_can_never_produce_a_negative_bullet():
    """Defensive: if the two counts ever disagree, the digest under-reports rather than printing
    "-2 other chat messages"."""
    text = _digest(_snap(chat_count=1, mention_count=4, hub_count=1, pressing_hub_count=3))
    assert "-" not in text
    assert _bullets(text) == [
        "4 mentions need your attention",
        "3 priority Hub items",
    ]


async def test_the_lead_names_the_highest_priority_category_present():
    cases = [
        (_snap(chat_count=9, mention_count=1, missed_call_count=2, pressing_hub_count=1,
               hub_count=1),
         "Start with the mention."),
        (_snap(chat_count=9, missed_call_count=2, pressing_hub_count=1, hub_count=1),
         "Start with the missed calls."),
        (_snap(chat_count=9, pressing_hub_count=1, hub_count=1),
         "Start with the priority Hub item."),
        (_snap(chat_count=9, hub_count=2), "None of it is flagged for you specifically."),
    ]
    for snapshot, expected in cases:
        assert _digest(snapshot).endswith(expected), expected


async def test_every_digest_phrasing_reaches_the_same_digest():
    """The T3 vocabulary. Each of these used to fall through to FALLBACK_TEXT or, for the older
    forms, to a flat sentence; all of them are now the one prioritised answer."""
    snapshot = _snap(chat_count=4, mention_count=1, missed_call_count=1, important_count=2)
    questions = (
        "What did I miss?",
        "What did I miss while I was away?",
        "Catch me up.",
        "Catch me up on everything",
        "Anything I need to check?",
        "What should I look at first?",
        "Give me my attention digest.",
        "my attention digest",
        "Bring me up to speed",
        "What happened while I was gone?",
    )
    first = _digest(snapshot, questions[0])
    for question in questions:
        assert is_activity_question(question), question
        assert _digest(snapshot, question) == first, question


# --- activity shapes ------------------------------------------------------------------------


async def test_a_chat_only_digest_does_not_call_the_volume_other():
    """"other" is a comparison, and with nothing listed above it there is nothing to compare
    against — saying "12 other chat messages" as the only line would be a small lie."""
    text = _digest(_snap(chat_count=12))
    assert _bullets(text) == ["12 chat messages"]
    assert "other" not in text


async def test_a_priority_hub_only_digest_leads_with_the_hub():
    text = _digest(_snap(hub_count=2, pressing_hub_count=2, important_count=2))
    assert _bullets(text) == ["2 priority Hub items"]
    assert text.endswith("Start with the priority Hub items.")


async def test_ordinary_hub_items_are_the_lowest_signal_and_are_not_called_priority():
    text = _digest(_snap(hub_count=3))
    assert _bullets(text) == ["3 Hub items"]
    assert "priority" not in text
    assert text.endswith("None of it is flagged for you specifically.")


async def test_singulars_read_as_english():
    text = _digest(
        _snap(chat_count=2, mention_count=1, missed_call_count=1, hub_count=2,
              pressing_hub_count=1, important_count=3)
    )
    assert _bullets(text) == [
        "1 mention needs your attention",
        "1 missed call",
        "1 priority Hub item",
        "1 other chat message",
        "1 other Hub item",
    ]


async def test_the_zero_state_is_clean_rather_than_a_list_of_zeroes():
    text = _digest(_snap())
    assert "0" not in text
    assert BULLET not in text
    assert text == (
        "Nothing came in since you were last active — no mentions, missed calls, Hub items "
        "or chat messages."
    )


# --- since_reason honesty -------------------------------------------------------------------


async def test_an_observed_absence_is_the_only_case_that_says_you_were_away():
    text = _digest(_snap(chat_count=3, mention_count=1))
    assert text.startswith("While you were away:")


async def test_tracking_started_never_claims_an_absence():
    text = _digest(_snap(reason="tracking_started", chat_count=3, mention_count=1))
    assert text.startswith("Since I started keeping track:")
    assert "away" not in text
    # The bullets are unchanged — only the claim about the window differs.
    assert _bullets(text) == ["1 mention needs your attention", "2 other chat messages"]


async def test_tracking_started_zero_state_is_also_honest():
    text = _digest(_snap(reason="tracking_started"))
    assert text == (
        "Nothing came in since I started keeping track — no mentions, missed calls, Hub "
        "items or chat messages."
    )
    assert "away" not in text


async def test_no_history_refuses_to_report_a_confident_nothing():
    """First use: the server has never seen this person, so nothing was being watched. Every
    count is trivially zero, and reporting a clean zero state would be a lie of omission."""
    for question in ("what did I miss", "what should I look at first", "give me my digest"):
        answer = answer_question(question, _ctx(), activity=_snap(reason="no_history"))
        assert answer.text == NO_ACTIVITY_HISTORY_TEXT, question
        assert answer.intent == "away_summary", question
        assert "away" not in answer.text


# --- T2 narrow intents are untouched ---------------------------------------------------------


async def test_the_narrow_t2_questions_still_get_one_number_not_a_digest():
    """A specific question deserves a specific answer. "How many messages did I miss" must NOT
    become the triage list — the digest patterns are matched last for exactly this reason."""
    snapshot = _snap(chat_count=15, mention_count=3, missed_call_count=1, hub_count=2,
                     pressing_hub_count=2, important_count=6)
    cases = {
        "how many chats did i miss": (
            "missed_chats", "You received 15 chat messages since you were last active."),
        "how many messages did I miss?": (
            "missed_chats", "You received 15 chat messages since you were last active."),
        "how many times was I mentioned?": (
            "missed_mentions", "You were mentioned 3 times since you were last active."),
        "did I miss any calls?": (
            "missed_calls", "You missed 1 call since you were last active."),
    }
    for question, (intent, expected) in cases.items():
        answer = answer_question(question, _ctx(), activity=snapshot)
        assert answer.intent == intent, question
        assert answer.text == expected, question
        assert BULLET not in answer.text, question


async def test_the_important_roll_up_keeps_its_own_wording_and_its_own_phrasings():
    """"Anything IMPORTANT?" is still the T2 triage sentence, not the T3 digest — _IMPORTANT_
    _SUMMARY is matched before the digest table and must keep every phrasing it owned."""
    snapshot = _snap(chat_count=40, mention_count=3, missed_call_count=1, pressing_hub_count=1,
                     hub_count=1, important_count=5)
    for question in (
        "Is there anything important I need to check?",
        "anything urgent",
        "what needs my attention",
        "do I need to check anything?",
    ):
        answer = answer_question(question, _ctx(), activity=snapshot)
        assert answer.intent == "important_summary", question
        assert answer.text == (
            "5 things worth checking since you were last active: you were mentioned 3 times, "
            "you missed 1 call and there is 1 priority Hub item."
        ), question
        assert BULLET not in answer.text, question


async def test_live_state_questions_are_untouched_by_the_digest_patterns():
    """The digest table must not have swallowed a present-tense office question, and none of
    these may start costing a database round trip."""
    for question in ("who is online", "where is micah", "is micah available", "who is in a call"):
        assert not is_activity_question(question), question


# --- privacy ----------------------------------------------------------------------------------


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def _cursor(email: str, *, away_since: datetime) -> None:
    """Put a viewer's window where the test needs it, writing the cursor row directly — exactly
    as tests/test_toucan_activity.py does. The window's production path (socket arrival and
    departure) is T2's to cover and is not re-tested here."""
    async with app_db.async_session_maker() as session:
        session.add(
            ToucanAttentionCursor(
                email=email,
                last_seen_at=datetime.now(timezone.utc),
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


async def test_a_digest_is_built_from_counts_and_can_contain_nothing_else():
    """THE STRUCTURAL PRIVACY ARGUMENT, asserted rather than asserted-about. A digest is a pure
    function of six integers plus a window label: two snapshots carrying the same numbers
    produce byte-identical text, so no fact outside the AttentionSnapshot can be influencing a
    single character of it."""
    numbers = dict(chat_count=15, mention_count=3, missed_call_count=1, hub_count=4,
                   pressing_hub_count=2, important_count=6)
    a = AttentionSnapshot(
        since=datetime(2020, 1, 1, tzinfo=timezone.utc),
        since_reason="last_active",
        until=datetime(2020, 1, 2, tzinfo=timezone.utc),
        **numbers,
    )
    b = AttentionSnapshot(
        since=datetime(2031, 6, 6, tzinfo=timezone.utc),
        since_reason="last_active",
        until=datetime(2031, 7, 7, tzinfo=timezone.utc),
        **numbers,
    )
    assert _digest(a) == _digest(b)
    # Different callers, same numbers — a digest carries nothing caller-specific either.
    assert answer_question("what did I miss", _ctx(ANGELO), activity=a).text == (
        answer_question("what did I miss", _ctx(BON), activity=a).text
    )


async def test_no_real_message_body_sender_or_conversation_reaches_a_digest():
    """The dynamic counterpart: real private text, a real mention, a real Hub item, driven
    through the real endpoint — and the digest still says only how many."""
    secret = "SECRET-T3-DIGEST-BODY-do-not-leak"
    await _cursor(ANGELO, away_since=datetime.now(timezone.utc) - timedelta(hours=2))
    conversation_id = await _send(MICAH, ANGELO, secret, mentions=[ANGELO])

    async with await _client() as client:
        answers = [
            await client.post("/toucan/ask", json={"question": q}, headers=_headers(ANGELO))
            for q in ("what did I miss", "what should I look at first", "catch me up")
        ]

    for res in answers:
        assert res.status_code == 200
        body = res.json()
        assert body["intent"] == "away_summary"
        assert secret not in res.text
        # Nobody is named, and no conversation is identifiable.
        for forbidden in (MICAH, "micah", conversation_id):
            assert forbidden.lower() not in body["text"].lower()
        assert "1 mention needs your attention" in body["text"]


async def test_the_digest_reaches_the_client_only_as_text():
    """T1's four-field contract is untouched by T3. There is no `digest` field, no bullet array,
    no counts object — a client cannot read the numbers out of anything but the sentence."""
    await _cursor(ANGELO, away_since=datetime.now(timezone.utc) - timedelta(hours=2))

    async with await _client() as client:
        body = (
            await client.post(
                "/toucan/ask", json={"question": "what did I miss"}, headers=_headers(ANGELO)
            )
        ).json()
    assert set(body) == {"text", "intent", "supported", "conversationId"}
    assert body["intent"] == "away_summary"


async def test_one_viewers_digest_is_not_another_viewers():
    """T3 changed no query, so viewer scoping is inherited from T2 — asserted here anyway,
    because the digest is the surface a leak would actually show up on."""
    away = datetime.now(timezone.utc) - timedelta(hours=2)
    await _cursor(ANGELO, away_since=away)
    await _cursor(BON, away_since=away)
    await _send(MICAH, ANGELO, "hello angelo", mentions=[ANGELO])

    async with await _client() as client:
        angelo = (
            await client.post(
                "/toucan/ask", json={"question": "what did I miss"}, headers=_headers(ANGELO)
            )
        ).json()["text"]
        bon = (
            await client.post(
                "/toucan/ask", json={"question": "what did I miss"}, headers=_headers(BON)
            )
        ).json()["text"]

    assert "1 mention needs your attention" in angelo
    assert bon.startswith("Nothing came in")
    assert "mention" not in _bullets(bon)


# --- isolation guard ----------------------------------------------------------------------------


async def test_the_digest_tests_never_touch_a_real_database():
    """Same guard as tests/test_toucan_activity.py: this file truncates tables, so it must be
    proven to be doing so inside the sandbox rather than in the developer's own database."""
    url = str(app_db.engine.url)
    assert "isolated_test.db" in url, url
    for real in ("virtual_office", "dev_hub_playground"):
        assert real not in url, f"the app is pointed at a real database: {url}"
