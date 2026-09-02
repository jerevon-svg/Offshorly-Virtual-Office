from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.toucan.context import (
    NOT_A_NAME,
    Availability,
    OfficeContext,
    PersonView,
    availability,
    checked_out_people,
    dnd_people,
    people_in_calls,
    present_people,
    resolve_person,
    room_occupants,
)

# DETERMINISTIC OFFICE ASSISTANT — the T0 "brain".
#
# No model, no provider, no network. A small normalized-intent matcher over a fixed set of live
# office questions, plus the wording for their answers.
#
# THE SPLIT THAT MATTERS: context.py owns DATA (registry reads + structured queries, no prose);
# this module owns INTENT + WORDING. Every user-facing sentence Toucan can produce is in this
# file. When an AI provider lands, context.py's query functions become tool implementations
# unchanged and this module's phrasing is what the model replaces — that is only possible
# because no wording was baked into the registry layer.
#
# Deliberately NOT broad NLP. Anything outside the pattern tables below returns FALLBACK_TEXT
# rather than guessing, so Toucan is never confidently wrong about a person's state.

FALLBACK_TEXT = "I can't answer that yet, but I'm still learning about the office."

# WHAT TOUCAN MUST NOT CLAIM. The VO backend has no socket-liveness registry: presence is
# explicit-checkout-only (see app/realtime/socket.py's disconnect handler and
# context.present_people's docstring). "Checked in and not checked out" is therefore NOT the
# same fact as "connected right now", and an explicitly-worded online question gets this
# disclaimer rather than a confident answer built from the weaker signal.
LIVENESS_UNKNOWN_TEXT = (
    "I can see who's checked in, but I can't confirm live connection status yet."
)

INTENT_UNSUPPORTED = "unsupported"

SUPPORTED_INTENTS: tuple[str, ...] = (
    # A bare name on its own line ("Angelo") — answered as that person's current status.
    "person_status",
    # Checked-in roster. Deliberately NOT called "online" — see LIVENESS_UNKNOWN_TEXT.
    "present",
    "liveness_unknown",
    "offline",
    "dnd",
    "in_call",
    "room_occupants",
    "locate_person",
    "person_available",
)


@dataclass(frozen=True)
class Answer:
    text: str
    intent: str
    supported: bool


# --- question normalization ----------------------------------------------------------------


def _normalize_question(raw: str) -> str:
    text = raw.strip().lower()
    # Drop apostrophes rather than expanding them, then repair the few contractions that
    # actually matter: "who's" -> "whos" -> "who is".
    text = text.replace("’", "").replace("'", "")
    text = re.sub(r"[^a-z0-9@._\- ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\bwhos\b", "who is", text)
    text = re.sub(r"\bwheres\b", "where is", text)
    text = re.sub(r"\bwhatis\b", "what is", text)
    text = re.sub(r"\bwhats\b", "what is", text)
    text = _FILLER.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


# Time filler that carries no meaning for a live-state question. Stripped from ANYWHERE in the
# question, not just the tail: "who is CURRENTLY in the office" sits in the middle of the phrase
# and used to miss every pattern and fall to the generic fallback.
_FILLER = re.compile(
    r"\b(?:right now|at the moment|at present|currently|now|today|atm|please)\b"
)

# Kept as a second pass over a captured name, so a name group is clean even if the global strip
# above ever stops being applied first.
_TRAILING_FILLER = re.compile(
    r"\s*\b(?:right now|now|currently|at the moment|at present|today|please|atm)\b\s*$"
)


def _clean_person(raw: str) -> str:
    name = raw.strip()
    previous = None
    while previous != name:
        previous = name
        name = _TRAILING_FILLER.sub("", name).strip()
    return name


# --- intent patterns -----------------------------------------------------------------------
# Order matters: person-specific forms are tried before the general "who is ..." forms, and
# room occupancy before the office-wide roster ("in this room" vs "in the office").

_PERSON_AVAILABLE = [
    re.compile(
        r"^(?:is|are)\s+(?P<person>.+?)\s+"
        r"(?:available|free|busy|around|reachable|offline|there|here|"
        r"in a call|on a call|in a meeting|on dnd|dnd|do not disturb)$"
    ),
    re.compile(r"^can\s+i\s+(?:talk|speak|chat)\s+(?:to|with)\s+(?P<person>.+?)$"),
]

# Explicitly-worded connection questions. Matched BEFORE _PERSON_AVAILABLE/_ONLINE so an
# "online" phrasing can never be answered out of the weaker checked-in signal.
_PERSON_LIVENESS = [
    re.compile(r"^(?:is|are)\s+(?P<person>.+?)\s+(?:online|connected)$"),
]

_ROSTER_LIVENESS = [
    re.compile(r"^who\s+is\s+(?:online|connected)$"),
    re.compile(r"^(?:is|are)\s+(?:anyone|anybody|someone|somebody)\s+(?:online|connected)$"),
]

_LOCATE_PERSON = [
    re.compile(r"^where\s+(?:is|are)\s+(?P<person>.+?)$"),
    re.compile(r"^(?:find|locate)\s+(?P<person>.+?)$"),
    re.compile(r"^which\s+room\s+is\s+(?P<person>.+?)\s+in$"),
]

_ROOM_OCCUPANTS = [
    re.compile(r"^who\s+(?:else\s+)?is\s+(?:in|inside)\s+(?:this|my|the)\s+room$"),
    re.compile(r"^who\s+(?:else\s+)?is\s+in\s+here$"),
    re.compile(r"^who\s+is\s+with\s+me$"),
]

_IN_CALL = [
    re.compile(r"^who\s+is\s+(?:in|on)\s+(?:a|the)?\s*(?:call|calls|meeting|meetings)$"),
    re.compile(r"^who\s+is\s+calling$"),
]

_DND = [
    re.compile(r"^who\s+is\s+(?:on\s+)?(?:dnd|do not disturb)$"),
    re.compile(r"^who\s+is\s+busy$"),
    re.compile(r"^who\s+has\s+dnd\s+on$"),
]

_OFFLINE = [
    re.compile(r"^who\s+is\s+(?:offline|out|away|gone|checked out)$"),
    re.compile(r"^who\s+has\s+(?:checked out|left)$"),
    re.compile(r"^who\s+left$"),
]

_ONLINE = [
    re.compile(
        r"^who\s+is\s+(?:here|around|available|working|at work|in|in the office|in today|checked in)$"
    ),
    re.compile(r"^who\s+is\s+in\s+the\s+office(?:\s+today)?$"),
    # "is anyone free?" is a roster question, not a lookup for a colleague called Anyone.
    re.compile(
        r"^(?:is|are)\s+(?:anyone|anybody|someone|somebody)\s+"
        r"(?:available|free|around|here|in|in the office)$"
    ),
]


# A question that is NOTHING BUT a name (one or two tokens, or an email). Matched LAST, so it
# can never shadow a real phrasing, and answered only when the name resolves — an unrecognised
# single word is far more likely to be small talk than a colleague, so it falls to the generic
# fallback rather than telling the user their imaginary friend doesn't work here.
_BARE_NAME = re.compile(r"^(?P<person>[a-z0-9@._\-]+(?: [a-z0-9@._\-]+)?)$")


def _first_match(patterns: list[re.Pattern[str]], text: str) -> re.Match[str] | None:
    for pattern in patterns:
        match = pattern.match(text)
        if match:
            return match
    return None


# --- wording -------------------------------------------------------------------------------
# Pronoun policy: nobody's pronouns are known here, so every sentence about another person uses
# they/them. Never infer a pronoun from a name.

# Tokens that read as initialisms rather than words when a room id is titled.
_ROOM_INITIALISMS = frozenset({"ai", "hr", "qa", "it", "ux", "ceo", "cto"})


def _display(person: PersonView) -> str:
    """Atlas's display name when the roster supplied one, else the email's local part titled."""
    if person.display_name:
        return person.display_name
    local = person.email.split("@", 1)[0]
    parts = [p for p in re.split(r"[._\-]+", local) if p]
    return " ".join(p.capitalize() for p in parts) if parts else person.email


def _room_label(room_id: str) -> str:
    parts = [p for p in re.split(r"[._\-\s]+", room_id) if p]
    if not parts:
        return room_id
    return " ".join(p.upper() if p in _ROOM_INITIALISMS else p.capitalize() for p in parts)


def _names(people: tuple[PersonView, ...]) -> list[str]:
    return sorted(_display(p) for p in people)


def _join(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _roster_answer(people: tuple[PersonView, ...], *, some: str, none: str) -> str:
    names = _names(people)
    if not names:
        return none
    verb = "is" if len(names) == 1 else "are"
    return f"{_join(names)} {verb} {some}"


def _where_phrase(person: PersonView) -> str:
    # Roster-only: we know they work here and nothing else. Say exactly that.
    if not person.live_state_known:
        return "someone I know of, but I can't see where they are right now"
    if person.checked_out:
        return "checked out right now"
    if person.room_id:
        return f"in {_room_label(person.room_id)}"
    if person.position is not None:
        return "out on the office floor, not in a room"
    return "in the office, but I can't see exactly where"


_BLOCKED_PHRASE = {
    "live_state_unknown": "someone I know of, but I can't see their current status",
    "checked_out": "checked out right now",
    "in_call": "in a call right now",
    "dnd": "on Do Not Disturb right now",
    "in_conversation": "already in a conversation right now",
}


def _availability_answer(state: Availability) -> str:
    name = _display(state.person)
    if state.available:
        return f"{name} looks available — they're {_where_phrase(state.person)}."
    phrase = _BLOCKED_PHRASE[state.blocked_by or "in_conversation"]
    if state.blocked_by == "live_state_unknown":
        return f"{name} is {phrase}."
    if state.blocked_by == "dnd":
        return f"{name} is {phrase}. You can send a request to talk instead of walking over."
    return f"{name} is {phrase}."


def _liveness_roster_answer(people: tuple[PersonView, ...]) -> str:
    """Leads with the disclaimer, then lists the checked-in roster under a label that only
    claims what the registries actually know."""
    names = _names(people)
    if not names:
        return f"{LIVENESS_UNKNOWN_TEXT} Nobody is checked in right now."
    verb = "is" if len(names) == 1 else "are"
    return f"{LIVENESS_UNKNOWN_TEXT} {_join(names)} {verb} checked in and in the office."


def _liveness_person_answer(person: PersonView) -> str:
    # Checkout IS authoritative — it is an explicit action, not an inference — so a checked-out
    # person gets a definite answer with no disclaimer attached.
    name = _display(person)
    if not person.live_state_known:
        return f"{name} is {_where_phrase(person)}."
    if person.checked_out:
        return f"{name} is checked out right now."
    return f"{LIVENESS_UNKNOWN_TEXT} {name} is checked in — they're {_where_phrase(person)}."


def _no_such_person(raw_name: str, *, roster_available: bool) -> str:
    """The reason a name fails depends on whether the employee directory was readable — saying
    "only people the office has seen this session" would be untrue once the roster is in play."""
    name = raw_name.strip()
    if roster_available:
        return f"I don't know anyone called \"{name}\" in the office directory."
    return (
        f"I don't know anyone called \"{name}\" — I can't reach the employee directory right "
        "now, so I only know people the office has seen this session."
    )


def _ambiguous_person(raw_name: str, people: tuple[PersonView, ...]) -> str:
    return (
        f"More than one person matches \"{raw_name.strip()}\": "
        f"{_join(_names(people))}. Which one did you mean?"
    )


# --- resolver ------------------------------------------------------------------------------


def answer_question(question: str, ctx: OfficeContext) -> Answer:
    """Resolve one question against a caller-scoped OfficeContext.

    Pure and synchronous — the same question against the same context always produces the same
    answer. Conversation history is intentionally not a parameter: T0 answers each question on
    its own (see app/routers/toucan.py on why history is still accepted on the wire).
    """
    text = _normalize_question(question)
    if not text:
        return Answer(text=FALLBACK_TEXT, intent=INTENT_UNSUPPORTED, supported=False)

    match = _first_match(_PERSON_LIVENESS, text)
    if match:
        answer = _person_answer(ctx, match.group("person"), intent="liveness_unknown")
        if answer is not None:
            return answer

    if _first_match(_ROSTER_LIVENESS, text):
        return Answer(
            text=_liveness_roster_answer(present_people(ctx)),
            intent="liveness_unknown",
            supported=True,
        )

    match = _first_match(_PERSON_AVAILABLE, text)
    if match:
        answer = _person_answer(ctx, match.group("person"), intent="person_available")
        if answer is not None:
            return answer

    match = _first_match(_LOCATE_PERSON, text)
    if match:
        answer = _person_answer(ctx, match.group("person"), intent="locate_person")
        if answer is not None:
            return answer

    if _first_match(_ROOM_OCCUPANTS, text):
        return Answer(text=_room_answer(ctx), intent="room_occupants", supported=True)

    if _first_match(_IN_CALL, text):
        return Answer(
            text=_roster_answer(
                people_in_calls(ctx),
                some="in a call.",
                none="Nobody is in a call right now.",
            ),
            intent="in_call",
            supported=True,
        )

    if _first_match(_DND, text):
        return Answer(
            text=_roster_answer(
                dnd_people(ctx),
                some="on Do Not Disturb.",
                none="Nobody is on Do Not Disturb right now.",
            ),
            intent="dnd",
            supported=True,
        )

    if _first_match(_OFFLINE, text):
        return Answer(
            text=_roster_answer(
                checked_out_people(ctx),
                some="checked out.",
                none="Nobody has checked out right now.",
            ),
            intent="offline",
            supported=True,
        )

    if _first_match(_ONLINE, text):
        return Answer(
            text=_roster_answer(
                present_people(ctx),
                some="in the office right now.",
                none="Nobody is in the office right now.",
            ),
            intent="present",
            supported=True,
        )

    match = _first_match([_BARE_NAME], text)
    if match:
        raw_name = match.group("person")
        result = resolve_person(ctx, raw_name)
        if result.is_ambiguous:
            return Answer(
                text=_ambiguous_person(raw_name, result.matches),
                intent="person_status",
                supported=True,
            )
        if result.person is not None:
            # Availability wording already carries location for an available person and the
            # blocking reason otherwise — exactly "their current known office status/location".
            return Answer(
                text=_availability_answer(availability(ctx, result.person)),
                intent="person_status",
                supported=True,
            )

    return Answer(text=FALLBACK_TEXT, intent=INTENT_UNSUPPORTED, supported=False)


def _person_answer(ctx: OfficeContext, raw_name: str, *, intent: str) -> Answer | None:
    """None means "this pattern matched but the captured text isn't a person" — the caller falls
    through to the remaining intents, so "is anyone available" still reaches the roster answer."""
    name = _clean_person(raw_name)
    if not name:
        return None

    result = resolve_person(ctx, name)
    if not result.matches:
        # A bare stop-word ("anyone") is not a failed lookup, it's a different question — let the
        # roster patterns have it. A real-looking name that matches nobody IS an answer.
        if _looks_like_a_name(name):
            return Answer(
                text=_no_such_person(name, roster_available=ctx.roster_available),
                intent=intent,
                supported=True,
            )
        return None
    if result.is_ambiguous:
        return Answer(text=_ambiguous_person(name, result.matches), intent=intent, supported=True)

    person = result.person
    assert person is not None  # is_unique
    if intent == "liveness_unknown":
        return Answer(text=_liveness_person_answer(person), intent=intent, supported=True)
    if intent == "person_available":
        return Answer(text=_availability_answer(availability(ctx, person)), intent=intent, supported=True)
    return Answer(
        text=f"{_display(person)} is {_where_phrase(person)}.",
        intent=intent,
        supported=True,
    )


def _looks_like_a_name(name: str) -> bool:
    """A single word (or an email) that isn't one of the pronouns/quantifiers context.py filters
    out. Multi-word phrases are treated as "not a name" so a mis-fired pattern degrades to the
    generic fallback instead of scolding the user about an imaginary colleague."""
    if "@" in name:
        return True
    if name in NOT_A_NAME:
        return False
    words = name.split()
    return len(words) == 1 and name.isascii() and name.replace(".", "").replace("-", "").isalnum()


def _room_answer(ctx: OfficeContext) -> str:
    """Answers about people ACTIVE in the room, which is not the same set as the faces drawn on
    the floor — plenty of those are shown at their team's desk without being here. The wording
    says "active" every time so the answer is never mistaken for a headcount of the map."""
    viewer = ctx.viewer
    if viewer is None or not viewer.room_id:
        return "You're not in one of the office rooms right now."
    label = _room_label(viewer.room_id)
    others = tuple(p for p in room_occupants(ctx, viewer.room_id) if p.email != viewer.email)
    if not others:
        return (
            f"You're the only one active in {label} right now — anyone else you can see there "
            "is shown at their usual desk."
        )
    return (
        f"You're in {label} with {_join(_names(others))} — that's everyone active in there "
        "right now."
    )
