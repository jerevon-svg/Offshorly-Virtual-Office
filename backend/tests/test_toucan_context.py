from __future__ import annotations

import dataclasses

import pytest

from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.services.position_registry import position_registry
from app.services.toucan import context as toucan_context
from app.services.toucan.context import (
    PersonView,
    availability,
    build_office_context_from,
    checked_out_people,
    dnd_people,
    people_in_calls,
    present_people,
    resolve_person,
    room_occupants,
)
from app.services.toucan.roster import RosterPerson

# Context-layer coverage: what Toucan can see, and what it derives from it.
#
# The golden field-set test below is the enforcement mechanism for the allowlist described in
# app/services/toucan/context.py. If someone widens PersonView, this test fails and the new
# field has to be justified in review.

pytestmark = pytest.mark.asyncio

A = "angelo@example.com"
B = "micah@example.com"
C = "bon.jerevon@example.com"


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


def _place(email: str, x: float = 10.0, y: float = 20.0, room_id: str | None = None):
    position_registry.load_stable(
        [
            {
                "email": email,
                "revision": 1,
                "x": x,
                "y": y,
                "facing": "front",
                "state": "standing",
                "seat_key": None,
                "room_id": room_id,
                "updated_at": 0,
            }
        ]
    )


async def test_person_view_exposes_only_the_allowlisted_fields():
    """GOLDEN SET. Widening this is a deliberate privacy decision, not an incidental one."""
    assert {f.name for f in dataclasses.fields(PersonView)} == {
        "email",
        "display_name",
        "live_state_known",
        "checked_out",
        "dnd",
        "room_id",
        "session_id",
        "call_session_id",
        "position",
    }


# --- a persisted position is location detail, never liveness ------------------------------
# The position registry is cold-loaded from the database at startup and never cleared on
# disconnect, so a row proves where someone WAS, not that they are here now.


async def test_a_restored_position_alone_does_not_make_someone_present():
    """The `a@example.com` case: a stale row must not be reported as being in the office."""
    _place(B)  # exactly what load_stable does at startup — no live socket involved
    ctx = build_office_context_from(A)
    stale = ctx.person(B)
    assert stale is not None
    assert stale.position is not None, "position is still available as location detail"
    assert stale.live_state_known is False
    assert stale.present is False
    assert [p.email for p in present_people(ctx)] == [A]
    assert availability(ctx, stale).blocked_by == "live_state_unknown"


async def test_a_restored_position_is_absent_from_the_present_roster_answer():
    _place(B)
    ctx = build_office_context_from(A)
    from app.services.toucan.office_assistant import answer_question

    for question in ("who is currently in the office", "who is here", "who is online"):
        assert "Micah" not in answer_question(question, ctx).text, question


@pytest.mark.parametrize("evidence", ["room", "session", "call", "dnd", "checked_out"])
async def test_active_realtime_evidence_still_makes_a_person_live(evidence):
    _place(B)  # a stale position on its own is not enough...
    if evidence == "room":
        room_presence.enter(B, "ai-room")
    elif evidence == "session":
        spatial_sessions.start(B, "sess-1", "sid-b")
    elif evidence == "call":
        spatial_sessions.start(B, "sess-1", "sid-b")
        call_registry.join("sess-1", B, "sid-b")
    elif evidence == "dnd":
        dnd_registry.set_dnd(B, True)
    else:
        offline_lineup.add(B)

    ctx = build_office_context_from(A)
    person = ctx.person(B)
    assert person is not None
    assert person.live_state_known is True
    # ...and checked-out is live evidence of a session, but explicitly NOT present.
    assert person.present is (evidence != "checked_out")


async def test_context_includes_the_viewer_even_with_no_live_state():
    ctx = build_office_context_from(A)
    assert [p.email for p in ctx.people] == [A]
    assert ctx.viewer is not None
    assert ctx.viewer.present


async def test_viewer_email_is_normalized():
    ctx = build_office_context_from("  Angelo@Example.COM ")
    assert ctx.viewer_email == A


async def test_checked_out_person_is_not_present():
    offline_lineup.add(B)
    ctx = build_office_context_from(A)
    assert [p.email for p in checked_out_people(ctx)] == [B]
    assert [p.email for p in present_people(ctx)] == [A]


async def test_dnd_and_room_and_session_and_call_are_collected():
    _place(A)
    _place(B)
    dnd_registry.set_dnd(B, True)
    room_presence.enter(A, "ai-room")
    room_presence.enter(B, "ai-room")
    spatial_sessions.start(A, "sess-1", "sid-a")
    spatial_sessions.start(B, "sess-1", "sid-b")
    call_registry.join("sess-1", A, "sid-a")

    ctx = build_office_context_from(A)
    angelo = ctx.person(A)
    micah = ctx.person(B)

    assert angelo is not None and micah is not None
    assert angelo.room_id == "ai-room"
    assert angelo.session_id == "sess-1"
    assert angelo.in_call is True
    assert angelo.in_conversation is True
    assert micah.dnd is True
    assert micah.in_call is False
    assert [p.email for p in dnd_people(ctx)] == [B]
    assert [p.email for p in people_in_calls(ctx)] == [A]
    assert {p.email for p in room_occupants(ctx, "ai-room")} == {A, B}


async def test_call_context_carries_no_livekit_room():
    """call_registry.snapshot() exposes the LiveKit room id; the context must drop it."""
    spatial_sessions.start(A, "sess-1", "sid-a")
    call_registry.join("sess-1", A, "sid-a")
    livekit_room = call_registry.snapshot()[0]["room"]

    ctx = build_office_context_from(A)
    person = ctx.person(A)
    assert person is not None
    assert person.call_session_id == "sess-1"
    assert livekit_room not in repr(ctx)


async def test_availability_reports_the_most_blocking_reason_first():
    _place(A)
    ctx = build_office_context_from(A)
    person = ctx.person(A)
    assert person is not None
    assert availability(ctx, person).available is True

    dnd_registry.set_dnd(A, True)
    spatial_sessions.start(A, "sess-1", "sid-a")
    call_registry.join("sess-1", A, "sid-a")
    ctx = build_office_context_from(A)
    person = ctx.person(A)
    assert person is not None
    # in_call outranks dnd, which outranks in_conversation.
    assert availability(ctx, person).blocked_by == "in_call"

    offline_lineup.add(A)
    ctx = build_office_context_from(A)
    person = ctx.person(A)
    assert person is not None
    assert availability(ctx, person).blocked_by == "checked_out"


async def test_resolve_person_matches_on_name_tokens_and_prefixes():
    _place(A)
    _place(C)
    ctx = build_office_context_from(A)

    assert resolve_person(ctx, "angelo").person is not None
    assert resolve_person(ctx, "ang").person is not None
    assert resolve_person(ctx, "jerevon").person is not None
    assert resolve_person(ctx, "bon jerevon").person is not None
    assert resolve_person(ctx, A).person is not None
    assert resolve_person(ctx, "nobody-here").matches == ()


async def test_resolve_person_rejects_quantifiers_and_pronouns():
    _place(A)
    ctx = build_office_context_from(A)
    for word in ("anyone", "someone", "everyone", "they", "me"):
        assert resolve_person(ctx, word).matches == ()


async def test_resolve_person_reports_ambiguity():
    _place("angelo@example.com")
    _place("angelo.reyes@example.com")
    ctx = build_office_context_from(A)
    result = resolve_person(ctx, "angelo")
    assert result.is_ambiguous


async def test_context_reads_no_database_and_verifies_no_tokens():
    """The context builder must not have pulled in the chat repository, a DB session maker, or
    Atlas's token verifier — it forwards a credential, it never validates one."""
    module_names = set(vars(toucan_context))
    assert "chat" not in module_names
    assert "async_session_maker" not in module_names
    assert "verify_atlas_token" not in module_names


# --- roster identities (Atlas) vs live state (registries) ---------------------------------


async def test_a_roster_only_employee_is_known_but_has_no_live_state():
    """The whole point of the roster: Angelo exists even though no registry has seen him."""
    ctx = build_office_context_from(
        C, roster=(RosterPerson(email=A, display_name="Angelo Reyes"),), roster_available=True
    )
    angelo = ctx.person(A)
    assert angelo is not None
    assert angelo.display_name == "Angelo Reyes"
    assert angelo.live_state_known is False
    # Existence is NOT presence, availability, a room or a call.
    assert angelo.present is False
    assert angelo.room_id is None
    assert angelo.in_call is False
    assert angelo.in_conversation is False
    assert [p.email for p in present_people(ctx)] == [C]
    assert availability(ctx, angelo).blocked_by == "live_state_unknown"


async def test_realtime_state_enriches_the_same_roster_identity():
    _place(A)
    room_presence.enter(A, "ai-room")
    ctx = build_office_context_from(
        C, roster=(RosterPerson(email=A, display_name="Angelo Reyes"),), roster_available=True
    )
    angelo = ctx.person(A)
    assert angelo is not None
    # One person, not two: the roster identity and the registry state merged on email.
    assert [p.email for p in ctx.people].count(A) == 1
    assert angelo.display_name == "Angelo Reyes"
    assert angelo.live_state_known is True
    assert angelo.room_id == "ai-room"
    assert angelo.present is True


async def test_a_roster_display_name_resolves():
    ctx = build_office_context_from(
        C, roster=(RosterPerson(email="a.r@example.com", display_name="Angelo Reyes"),)
    )
    assert resolve_person(ctx, "angelo").person is not None
    assert resolve_person(ctx, "reyes").person is not None
    assert resolve_person(ctx, "angelo reyes").person is not None


async def test_duplicate_roster_names_stay_ambiguous():
    ctx = build_office_context_from(
        C,
        roster=(
            RosterPerson(email="angelo.reyes@example.com", display_name="Angelo Reyes"),
            RosterPerson(email="angelo.cruz@example.com", display_name="Angelo Cruz"),
        ),
    )
    assert resolve_person(ctx, "angelo").is_ambiguous


async def test_an_unavailable_roster_leaves_registry_answers_working():
    _place(A)
    room_presence.enter(A, "ai-room")
    ctx = build_office_context_from(C, roster=(), roster_available=False)
    assert ctx.roster_available is False
    assert ctx.person(A) is not None
    assert [p.email for p in present_people(ctx)] == sorted([A, C])
    # Nothing invented.
    assert {p.email for p in ctx.people} == {A, C}
