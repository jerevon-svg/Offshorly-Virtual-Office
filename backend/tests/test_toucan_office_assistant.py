from __future__ import annotations

import pytest

from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.services.position_registry import position_registry
from app.services.toucan.context import build_office_context_from
from app.services.toucan.office_assistant import (
    FALLBACK_TEXT,
    LIVENESS_UNKNOWN_TEXT,
    answer_question,
)

# Functional coverage for the deterministic resolver: one test per supported intent, plus the
# unsupported fallback. Asserts on intent ids and on the substantive part of the wording only —
# not on whole sentences — so phrasing can be polished without rewriting the suite.

pytestmark = pytest.mark.asyncio

A = "angelo@example.com"
B = "micah@example.com"
C = "bon@example.com"


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


def _place(email: str, room_id: str | None = None):
    position_registry.load_stable(
        [
            {
                "email": email,
                "revision": 1,
                "x": 1.0,
                "y": 2.0,
                "facing": "front",
                "state": "standing",
                "seat_key": None,
                "room_id": room_id,
                "updated_at": 0,
            }
        ]
    )


def _ask(question: str, viewer: str = A):
    return answer_question(question, build_office_context_from(viewer))


# --- present (checked in) -----------------------------------------------------------------


async def test_who_is_here_lists_checked_in_people():
    room_presence.enter(A, "ai-room")
    room_presence.enter(B, "ai-room")
    answer = _ask("Who is here?")
    assert answer.intent == "present"
    assert answer.supported
    assert "Angelo" in answer.text and "Micah" in answer.text
    assert "in the office" in answer.text


async def test_presence_phrasings_all_resolve():
    _place(A)
    for question in (
        "Who is here?",
        "who is in the office",
        "who is available",
        "who is checked in",
        "who is around",
    ):
        assert _ask(question).intent == "present", question


async def test_checked_out_people_are_excluded_from_the_present_roster():
    room_presence.enter(A, "ai-room")
    offline_lineup.add(B)
    answer = _ask("who is here")
    assert "Micah" not in answer.text


async def test_the_present_roster_never_claims_anyone_is_online():
    _place(A)
    for question in ("who is here", "who is in the office", "who is available"):
        assert "online" not in _ask(question).text.lower(), question


# --- explicit online questions (liveness is unknown) --------------------------------------
# The backend has no socket-liveness registry, so an explicitly-worded "online" question must
# not be answered out of the weaker checked-in signal.


async def test_who_is_online_refuses_to_claim_live_connection_status():
    room_presence.enter(A, "ai-room")
    room_presence.enter(B, "ai-room")
    answer = _ask("Who is online?")
    assert answer.intent == "liveness_unknown"
    assert answer.supported
    assert answer.text.startswith(LIVENESS_UNKNOWN_TEXT)
    # It may still list the checked-in roster — but only ever labelled as checked in.
    assert "Angelo" in answer.text and "Micah" in answer.text
    assert "checked in" in answer.text


async def test_who_is_online_with_nobody_checked_in():
    offline_lineup.add(A)
    answer = _ask("who's online")
    assert answer.intent == "liveness_unknown"
    assert "Nobody is checked in" in answer.text


async def test_is_person_online_refuses_to_claim_live_connection_status():
    room_presence.enter(B, "ai-room")
    answer = _ask("is Angelo online?", viewer=B)
    assert answer.intent == "liveness_unknown"
    answer = _ask("is micah online")
    assert answer.intent == "liveness_unknown"
    assert answer.text.startswith(LIVENESS_UNKNOWN_TEXT)
    assert "checked in" in answer.text
    assert "AI Room" in answer.text


async def test_is_person_online_for_a_checked_out_person_is_definite():
    """Checkout is an explicit action, so it IS authoritative — no disclaimer needed."""
    offline_lineup.add(B)
    answer = _ask("is micah online")
    assert answer.intent == "liveness_unknown"
    assert answer.text == "Micah is checked out right now."
    assert LIVENESS_UNKNOWN_TEXT not in answer.text


async def test_is_anyone_online_gets_the_liveness_disclaimer_not_the_roster():
    _place(A)
    answer = _ask("is anyone online")
    assert answer.intent == "liveness_unknown"
    assert answer.text.startswith(LIVENESS_UNKNOWN_TEXT)


async def test_no_answer_anywhere_asserts_someone_is_online():
    """Sweep every supported phrasing: the word "online" may only ever appear inside the
    disclaimer, never as a claim about a person."""
    _place(A)
    _place(B)
    room_presence.enter(A, "ai-room")
    for question in (
        "who is here",
        "who is in the office",
        "who is available",
        "who is checked in",
        "who is offline",
        "who is dnd",
        "who is in a call",
        "who is in this room",
        "where is micah",
        "is micah available",
        "who is online",
        "is micah online",
    ):
        text = _ask(question).text
        without_disclaimer = text.replace(LIVENESS_UNKNOWN_TEXT, "")
        assert "online" not in without_disclaimer.lower(), question


# --- offline ------------------------------------------------------------------------------


async def test_who_is_offline_lists_checked_out_people():
    _place(A)
    offline_lineup.add(B)
    answer = _ask("Who is offline?")
    assert answer.intent == "offline"
    assert "Micah" in answer.text


async def test_who_is_offline_with_nobody_checked_out():
    _place(A)
    answer = _ask("who has checked out")
    assert answer.intent == "offline"
    assert "Nobody" in answer.text


# --- dnd ----------------------------------------------------------------------------------


async def test_who_is_dnd():
    _place(A)
    dnd_registry.set_dnd(B, True)
    answer = _ask("who is on do not disturb")
    assert answer.intent == "dnd"
    assert "Micah" in answer.text

    assert _ask("who is dnd").intent == "dnd"
    assert _ask("who is busy").intent == "dnd"


# --- call participation --------------------------------------------------------------------


async def test_who_is_in_a_call():
    spatial_sessions.start(A, "sess-1", "sid-a")
    spatial_sessions.start(B, "sess-1", "sid-b")
    call_registry.join("sess-1", B, "sid-b")
    answer = _ask("Who is in a call?")
    assert answer.intent == "in_call"
    assert "Micah" in answer.text and "Angelo" not in answer.text


async def test_who_is_in_a_call_with_nobody_calling():
    _place(A)
    answer = _ask("who is on a call")
    assert answer.intent == "in_call"
    assert "Nobody" in answer.text


async def test_is_person_in_a_call():
    spatial_sessions.start(B, "sess-1", "sid-b")
    call_registry.join("sess-1", B, "sid-b")
    answer = _ask("is micah in a call")
    assert answer.intent == "person_available"
    assert "in a call" in answer.text


# --- room / location -----------------------------------------------------------------------


async def test_who_is_in_this_room():
    room_presence.enter(A, "ai-room")
    room_presence.enter(B, "ai-room")
    answer = _ask("who is in this room")
    assert answer.intent == "room_occupants"
    assert "AI Room" in answer.text
    assert "Micah" in answer.text
    # Scoped to who is ACTIVE here, never presented as a headcount of the floor map.
    assert "active" in answer.text


async def test_who_is_in_this_room_when_alone():
    room_presence.enter(A, "dev-team")
    answer = _ask("who else is in this room")
    assert "only one active" in answer.text
    assert "usual desk" in answer.text


async def test_the_room_answer_leaks_no_implementation_detail():
    room_presence.enter(A, "ai-room")
    for question in ("who is in this room", "who is with me"):
        text = _ask(question).text.lower()
        for term in ("registry", "room_presence", "socket", "atlas", "backend", "database"):
            assert term not in text, question


async def test_who_is_in_this_room_when_not_in_a_room():
    _place(A)
    answer = _ask("who is in my room")
    assert answer.intent == "room_occupants"
    assert "not in one of the office rooms" in answer.text


async def test_where_is_person_in_a_room():
    room_presence.enter(B, "design-team")
    answer = _ask("Where is Micah?")
    assert answer.intent == "locate_person"
    assert "Design Team" in answer.text


async def test_where_is_person_on_the_floor():
    # Live evidence (a spatial session) but no room -> the position supplies the location detail.
    spatial_sessions.start(B, "sess-1", "sid-b")
    _place(B)
    answer = _ask("where is micah right now")
    assert answer.intent == "locate_person"
    assert "office floor" in answer.text


async def test_where_is_a_checked_out_person():
    offline_lineup.add(B)
    answer = _ask("where is micah")
    assert "checked out" in answer.text


async def test_where_is_an_unknown_person():
    _place(A)
    answer = _ask("where is zephyr")
    assert answer.intent == "locate_person"
    assert answer.supported
    assert "don't know anyone" in answer.text
    # Roster unreachable in this context -> says so, instead of implying the directory was checked.
    assert "can't reach the employee directory" in answer.text


async def test_an_unknown_person_when_the_directory_was_readable():
    ctx = build_office_context_from(A, roster=(), roster_available=True)
    answer = answer_question("where is zephyr", ctx)
    assert "in the office directory" in answer.text
    assert "seen this session" not in answer.text


async def test_where_is_an_ambiguous_name():
    _place("angelo@example.com")
    _place("angelo.reyes@example.com")
    answer = _ask("where is angelo")
    assert "More than one person" in answer.text


# --- availability -------------------------------------------------------------------------


async def test_is_person_available_when_free():
    room_presence.enter(B, "ai-room")
    answer = _ask("is micah available")
    assert answer.intent == "person_available"
    assert "looks available" in answer.text
    # Pronoun policy: nobody's pronouns are known, so answers use they/them.
    assert "they're" in answer.text


async def test_is_person_available_when_dnd_suggests_a_talk_request():
    dnd_registry.set_dnd(B, True)
    answer = _ask("is micah free")
    assert "Do Not Disturb" in answer.text
    assert "request to talk" in answer.text


async def test_is_person_available_when_checked_out():
    offline_lineup.add(B)
    answer = _ask("can i talk to micah")
    assert answer.intent == "person_available"
    assert "checked out" in answer.text


async def test_is_person_available_when_in_a_conversation():
    spatial_sessions.start(B, "sess-1", "sid-b")
    spatial_sessions.start(C, "sess-1", "sid-c")
    answer = _ask("is micah around")
    assert "already in a conversation" in answer.text


async def test_quantifier_falls_through_to_the_roster_answer():
    """"is anyone available" is a roster question, not a lookup for a colleague called Anyone."""
    _place(A)
    answer = _ask("is anyone available")
    assert answer.intent == "present"
    assert "Angelo" in answer.text


# --- time filler ("currently", "right now") -----------------------------------------------
# Filler carries no meaning for a live-state question and used to make the whole phrase miss
# every pattern when it sat mid-sentence.


async def test_filler_words_do_not_change_the_intent():
    _place(A)
    room_presence.enter(A, "ai-room")
    room_presence.enter(B, "ai-room")
    cases = {
        "who is currently in the office": "present",
        "who's currently in the office": "present",
        "who is in the office right now": "present",
        "who is here at the moment": "present",
        "who is currently online": "liveness_unknown",
        "who is currently in a call": "in_call",
        "who is currently dnd": "dnd",
        "who is currently in this room": "room_occupants",
        "where is micah currently": "locate_person",
        "is micah currently available": "person_available",
    }
    for question, intent in cases.items():
        assert _ask(question).intent == intent, question


async def test_filler_stripped_questions_give_the_same_answer_as_the_plain_form():
    _place(A)
    _place(B)
    assert _ask("who is currently in the office").text == _ask("who is in the office").text


# --- bare name ----------------------------------------------------------------------------


async def test_a_bare_known_name_answers_with_that_persons_status():
    # A must be in a registry for the context to know them at all — that limitation is the
    # T0 roster gap, not something the bare-name pattern can fix.
    room_presence.enter(A, "ai-room")
    answer = _ask("Angelo", viewer=B)
    assert answer.intent == "person_status"
    assert answer.supported
    assert "Angelo" in answer.text
    assert "AI Room" in answer.text


async def test_a_bare_name_reports_the_blocking_reason():
    spatial_sessions.start(B, "sess-1", "sid-b")
    call_registry.join("sess-1", B, "sid-b")
    answer = _ask("micah")
    assert answer.intent == "person_status"
    assert "in a call" in answer.text


async def test_a_bare_ambiguous_name_asks_which_one():
    _place("angelo@example.com")
    _place("angelo.reyes@example.com")
    answer = _ask("angelo")
    assert answer.intent == "person_status"
    assert "More than one person" in answer.text


async def test_a_bare_unknown_word_is_not_treated_as_a_person_lookup():
    """Small talk must not be answered with "I don't know anyone called hello"."""
    _place(A)
    for word in ("hello", "help", "hi", "thanks", "zephyr"):
        answer = _ask(word, viewer=B)
        assert answer.intent == "unsupported", word
        assert answer.text == FALLBACK_TEXT


async def test_the_bare_name_pattern_never_shadows_a_real_phrasing():
    _place(A)
    room_presence.enter(A, "ai-room")
    for question, intent in (
        ("who is here", "present"),
        ("who is online", "liveness_unknown"),
        ("who is dnd", "dnd"),
        ("who is in a call", "in_call"),
        ("who is in this room", "room_occupants"),
        ("where is angelo", "locate_person"),
        ("is angelo available", "person_available"),
    ):
        assert _ask(question).intent == intent, question


# --- fallback -----------------------------------------------------------------------------


async def test_unsupported_question_returns_the_deterministic_fallback():
    # "what happened while I was gone" used to live in this list. T2 answers it — see
    # tests/test_toucan_activity.py — so it moved out rather than being deleted, and the
    # remaining cases still pin the boundary: content work stays unsupported, and so does
    # "unread", which T2 deliberately does not implement (it counts a time window, not a read
    # cursor).
    for question in (
        "write me a reply to this email",
        "summarize this thread",
        "how many unread messages do I have",
        "",
        "   ",
    ):
        answer = _ask(question)
        assert answer.intent == "unsupported", question
        assert answer.supported is False
        assert answer.text == FALLBACK_TEXT


async def test_answers_are_deterministic():
    _place(A)
    _place(B)
    first = _ask("who is here")
    second = _ask("who is here")
    assert first == second
