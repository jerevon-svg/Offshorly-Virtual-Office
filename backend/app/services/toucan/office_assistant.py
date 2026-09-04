from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.toucan.activity import AttentionSnapshot
from app.services.toucan.context import (
    NOT_A_NAME,
    Availability,
    OfficeContext,
    PersonView,
    availability,
    available_people,
    checked_out_people,
    dnd_people,
    occupied_rooms,
    people_in_calls,
    people_in_conversations,
    present_people,
    resolve_person,
    resolve_room,
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
    # T5 — richer office awareness, still answered purely from live registry state via the same
    # OfficeContext. "available" split out of "present" (in the office != free to talk),
    # "in_conversation" reads the spatial sessions already projected onto PersonView, "headcount"
    # counts the same rosters the list intents word, "occupied_rooms" regroups room_presence, and
    # "status_untracked" is the honest answer for statuses (breaks/lunch) the VO has no source of
    # truth for.
    "available",
    "in_conversation",
    "headcount",
    "occupied_rooms",
    "status_untracked",
    # T2 — the durable activity intents. These are the only intents whose answers are built from
    # anything that survives a restart, and the only ones that need an AttentionSnapshot; every
    # intent above is answered purely from live registry state.
    #
    # T3 changed WHAT "away_summary" says, not what it is called: it is now the prioritised
    # attention digest rather than a flat sentence of counts. The name is kept so the persisted
    # transcripts, the response contract and the client stay untouched — the intent has always
    # meant "the broad what-did-I-miss question", and that is still exactly what it means.
    "away_summary",
    "missed_chats",
    "missed_mentions",
    "missed_calls",
    "important_summary",
)

# Said when an activity question arrives without a snapshot to answer it from — the caller
# either could not build one, or the question was routed here without one. Never guesses a
# number, and never implies the answer is zero.
ACTIVITY_UNAVAILABLE_TEXT = (
    "I can't check what you've missed right now — try me again in a moment."
)

# Said when the server has never observed this person present, so there is no window to measure
# and every count is trivially zero. Reporting a confident "nothing happened" here would be a
# lie of omission: nothing was being watched.
NO_ACTIVITY_HISTORY_TEXT = (
    "I haven't seen you in the office yet, so I've got nothing to compare against. Once "
    "you've been here and come back, I can tell you what you missed."
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
    text = re.sub(r"\s+", " ", text).strip()
    # A trailing full stop survives the character filter above — "." is kept deliberately, so an
    # email address stays intact — and it used to make "Catch me up." miss a pattern that
    # "Catch me up" matched. Stripped here rather than widening the filter, because a period is
    # only ever noise at the END of a question and is load-bearing anywhere inside one.
    return text.rstrip(". ")


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
        r"in a call|on a call|in a meeting|on dnd|dnd|do not disturb|"
        r"in a conversation|talking to someone|talking with someone)$"
    ),
    re.compile(r"^can\s+i\s+(?:talk|speak|chat)\s+(?:to|with)\s+(?P<person>.+?)$"),
]

# Statuses this office HAS NO SOURCE OF TRUTH FOR. The VO's live state is exactly: checked out,
# DND, in a room, in a conversation, in a call. Breaks and lunches are not tracked anywhere —
# not in a registry, not in Atlas fields Toucan may read — so these phrasings get an honest
# "the office doesn't track that" instead of the generic fallback, and never an inference.
_UNTRACKED_STATUS = r"(?:on\s+(?:a\s+)?break|at\s+lunch|on\s+lunch|out\s+to\s+lunch)"

_UNTRACKED_ROSTER = [
    re.compile(r"^who\s+is\s+" + _UNTRACKED_STATUS + "$"),
]

_UNTRACKED_PERSON = [
    re.compile(r"^(?:is|are)\s+(?P<person>.+?)\s+" + _UNTRACKED_STATUS + "$"),
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

_IN_CONVERSATION = [
    re.compile(r"^who\s+is\s+(?:in|having)\s+(?:a\s+)?conversations?$"),
    re.compile(r"^who\s+is\s+(?:talking|chatting)(?:\s+(?:to|with)\s+(?:someone|somebody))?$"),
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
        r"^who\s+is\s+(?:here|around|working|at work|in|in the office|in today|checked in)$"
    ),
    re.compile(r"^who\s+is\s+in\s+the\s+office(?:\s+today)?$"),
    re.compile(
        r"^(?:is|are)\s+(?:anyone|anybody|someone|somebody)\s+"
        r"(?:around|here|in|in the office)$"
    ),
]

# T5 split "available" out of the present roster: being in the office and being free to talk are
# different questions, and the old alias listed someone on DND or mid-call as an answer to "who
# is available". "is anyone free?" stays a roster question, not a lookup for a colleague called
# Anyone.
_AVAILABLE = [
    re.compile(r"^who\s+(?:else\s+)?is\s+(?:available|free)(?:\s+to\s+(?:talk|chat))?$"),
    re.compile(
        r"^(?:is|are)\s+(?:anyone|anybody|someone|somebody)\s+"
        r"(?:available|free)(?:\s+to\s+(?:talk|chat))?$"
    ),
]

# Counts, not lists. The same rosters the list intents word, so a count can never disagree with
# its list — and the online-phrased count keeps the same liveness disclaimer the online roster
# has, because counting does not make the checked-in signal any stronger.
_COUNT_SUBJECT = r"(?:\s+(?:people|folks|employees|users))?"

_HEADCOUNT_LIVENESS = [
    re.compile(r"^how many" + _COUNT_SUBJECT + r"\s+are\s+(?:online|connected)$"),
]

_HEADCOUNT_CALLS = [
    re.compile(r"^how many" + _COUNT_SUBJECT + r"\s+are\s+(?:in|on)\s+(?:a\s+|the\s+)?calls?$"),
]

_HEADCOUNT_PRESENT = [
    re.compile(
        r"^how many"
        + _COUNT_SUBJECT
        + r"\s+are\s+(?:here|around|at work|in the office|in today|checked in|present)$"
    ),
]

_OCCUPIED_ROOMS = [
    re.compile(
        r"^(?:which|what)\s+rooms?\s+(?:have|has)\s+"
        r"(?:people|anyone|anybody|someone|somebody)(?:\s+in\s+(?:them|it))?$"
    ),
    re.compile(r"^(?:which|what)\s+rooms?\s+are\s+(?:occupied|busy|in use)$"),
    re.compile(r"^where\s+is\s+everyone$"),
]

# A room asked about BY NAME ("who is in the central hub"). Matched LAST among the who-is
# intents (see answer_question) so "the office", "a call" and "this room" keep their own
# answers; whatever reaches here is resolved against rooms that currently have occupants
# (context.resolve_room) and anything unmatched gets the honest empty-or-unknown wording.
_ROOM_NAMED = [
    re.compile(r"^who\s+(?:else\s+)?is\s+(?:in|inside|at)\s+the\s+(?P<room>.+)$"),
    re.compile(r"^who\s+(?:else\s+)?is\s+(?:in|inside)\s+(?P<room>.+?)\s+room$"),
]



# --- T2 activity patterns ---------------------------------------------------------------
# Matched BEFORE every live-state intent (see answer_question): these phrasings are about the
# PAST and are unambiguous, so there is nothing for them to shadow. The narrow forms come first
# so "how many chats did i miss" is answered with the chat number alone rather than the whole
# summary — a specific question deserves a specific answer.

_MISSED_CHATS = [
    re.compile(
        r"^how many (?:chats|chat messages|messages|dms)"
        r"(?: did i (?:miss|get|receive))?$"
    ),
    re.compile(r"^how many (?:chats|chat messages|messages|dms) do i have$"),
    re.compile(r"^did i (?:miss|get) any (?:chats|chat messages|messages|dms)$"),
]

_MISSED_MENTIONS = [
    re.compile(r"^how many times was i (?:mentioned|tagged)$"),
    re.compile(r"^how many (?:mentions|tags)(?: do i have)?$"),
    re.compile(r"^was i (?:mentioned|tagged)(?: anywhere)?$"),
    re.compile(r"^did anyone (?:mention|tag) me$"),
]

_MISSED_CALLS = [
    re.compile(r"^did i miss (?:any|a) calls?$"),
    re.compile(r"^how many calls did i miss$"),
    re.compile(r"^(?:any|how many) missed calls(?: do i have)?$"),
    re.compile(r"^did anyone (?:call|ring) me$"),
]

_IMPORTANT_SUMMARY = [
    re.compile(
        r"^is there anything (?:important|urgent)"
        r"(?: (?:i need|for me) to (?:check|look at|see|know about))?$"
    ),
    re.compile(r"^anything (?:important|urgent)(?: i need to (?:check|see|know))?$"),
    re.compile(r"^do i need to check anything$"),
    re.compile(r"^what needs my attention$"),
]

# T3 — THE ATTENTION DIGEST. These are the BROAD phrasings: "tell me everything that is waiting
# for me, worst first". They are matched LAST among the activity intents (see _ACTIVITY_INTENTS)
# precisely so a narrow question keeps its narrow answer — "how many messages did I miss" is a
# request for one number, not for a triage list.
#
# The T3 additions are the phrasings that ask WHICH THING FIRST rather than HOW MANY: "what
# should I look at first", "give me my attention digest", "anything I need to check". None of
# them matched anything before T3 (each one fell to FALLBACK_TEXT), so widening the table here
# takes no phrasing away from an existing intent — _IMPORTANT_SUMMARY still owns every
# "anything IMPORTANT/URGENT" wording, and is tried first regardless.
_AWAY_SUMMARY = [
    re.compile(r"^what happened while i was (?:gone|away|out|offline)$"),
    re.compile(r"^what happened while i was not (?:here|around)$"),
    re.compile(r"^what did i miss(?: while i was (?:gone|away|out|offline))?$"),
    re.compile(r"^what have i missed$"),
    re.compile(r"^(?:did|have) i miss(?:ed)? anything$"),
    re.compile(r"^anything i missed$"),
    re.compile(r"^catch me up(?: on (?:everything|things|the office))?$"),
    re.compile(r"^bring me up to speed$"),
    re.compile(r"^what happened$"),
    re.compile(r"^what is new$"),
    # "which of these deserves me first" — the question the priority ordering exists for.
    re.compile(r"^what should i (?:look at|check|read|handle|do) first$"),
    re.compile(r"^what do i (?:look at|check) first$"),
    re.compile(r"^(?:anything|is there anything) i need to (?:check|look at|see|know about)$"),
    re.compile(r"^(?:do i have|is there) anything (?:waiting|pending)(?: for me)?$"),
    # The feature asked for by name.
    re.compile(r"^(?:give me|show me|whats) (?:my )?(?:attention )?digest$"),
    re.compile(r"^(?:my )?attention digest$"),
]

# Every activity phrasing, in the order answer_question tries them. Exported as one list so the
# router can ask "would this question need a database?" with the SAME patterns that will answer
# it — see is_activity_question. Two separate lists would eventually disagree, and the failure
# mode would be silent (a question matched here, answered without a snapshot).
_ACTIVITY_INTENTS: tuple[tuple[str, list[re.Pattern[str]]], ...] = (
    ("missed_chats", _MISSED_CHATS),
    ("missed_mentions", _MISSED_MENTIONS),
    ("missed_calls", _MISSED_CALLS),
    ("important_summary", _IMPORTANT_SUMMARY),
    ("away_summary", _AWAY_SUMMARY),
)


def is_activity_question(question: str) -> bool:
    """Does answering this question require durable activity data?

    The router calls this to decide whether to spend a database round trip before calling
    answer_question — so an ordinary "who is online" costs exactly what it cost at T1, and only
    the handful of phrasings above pay for a snapshot. Pure and side-effect free."""
    text = _normalize_question(question)
    if not text:
        return False
    return any(_first_match(patterns, text) for _, patterns in _ACTIVITY_INTENTS)


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


def _headcount_answer(
    people: tuple[PersonView, ...], *, some: str, none: str, prefix: str = ""
) -> str:
    """A count worded from the same roster the list intents use, with the names attached so the
    number is falsifiable. `some` carries a {n} placeholder."""
    names = _names(people)
    if not names:
        return f"{prefix}{none}"
    n = len(names)
    noun = "person is" if n == 1 else "people are"
    return f"{prefix}{some.format(n=f'{n} {noun}')}: {_join(names)}."


def _occupied_rooms_answer(rooms: tuple[tuple[str, tuple[PersonView, ...]], ...]) -> str:
    if not rooms:
        return "No rooms have anyone active in them right now."
    parts = [f"{_room_label(room_id)} ({len(members)})" for room_id, members in rooms]
    verb = "has" if len(parts) == 1 else "have"
    return f"{_join(parts)} {verb} people active in there right now."


# Said for statuses the office has no source of truth for (breaks, lunch). Honest by
# construction: nothing in the registries or the roster allowlist records one, so Toucan says
# so instead of inferring one from absence.
UNTRACKED_STATUS_TEXT = (
    "The office doesn't track breaks or lunches, so I can't tell you that. I can check who's "
    "checked out, on Do Not Disturb, or in a call instead."
)


def _untracked_person_answer(person: PersonView) -> str:
    return (
        f"I can't tell whether {_display(person)} is on a break — the office doesn't track "
        f"breaks or lunches. What I can see: they're {_where_phrase(person)}."
    )


def _named_room_answer(ctx: OfficeContext, raw_room: str) -> str:
    room_id = resolve_room(ctx, raw_room)
    if room_id is None:
        # Empty room and unknown room are the same honest answer — there is no server-side room
        # catalog to tell them apart (see context.resolve_room), so neither is ever fabricated.
        label = _room_label(raw_room.strip()) or raw_room.strip()
        return (
            f"I can't see anyone active in {label} right now — it's either empty or not a "
            "room I can watch."
        )
    viewer = ctx.viewer
    if viewer is not None and viewer.room_id == room_id:
        return _room_answer(ctx)
    occupants = tuple(p for p in room_occupants(ctx, room_id) if p.present)
    label = _room_label(room_id)
    names = _names(occupants)
    verb = "is" if len(names) == 1 else "are"
    return f"{_join(names)} {verb} active in {label} right now."


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


def unknown_person_text(raw_name: str, *, roster_available: bool) -> str:
    """Public wording for a name that resolves to nobody — shared by the A1 send-message
    clarification so a recipient that cannot be resolved is worded exactly like any other
    unknown name (and never guessed)."""
    return _no_such_person(raw_name, roster_available=roster_available)


def ambiguous_person_text(raw_name: str, people: tuple[PersonView, ...]) -> str:
    """Public wording for a name matching several people — see unknown_person_text."""
    return _ambiguous_person(raw_name, people)



# --- T2 activity wording -------------------------------------------------------------------
# Counts only. There is nothing else in an AttentionSnapshot to say (see
# services/toucan/activity.py), which is precisely why the wording layer cannot leak content
# even by accident — it has none to leak. No sentence below names a person, a conversation, a
# Hub item or a single word anybody wrote.

# What the window means, said out loud. `since` is never rendered as a date: a timestamp invites
# the reader to reason about a boundary the server only knows approximately (presence is sampled
# at connect/checkout), whereas these phrases are exactly as precise as the data is.
_WINDOW_PHRASE = {
    "last_active": "since you were last active",
    "tracking_started": "since I started keeping track",
}

# The same window, worded as a DIGEST HEADER rather than as a trailing clause. Split from
# _WINDOW_PHRASE rather than derived from it because the honesty requirement bites differently
# in the two positions: "While you were away" is a claim about an observed absence and is only
# available to `last_active`, whereas `tracking_started` has to keep saying out loud that it is
# reporting everything it has ever seen, not everything that happened during a gap.
_HEADER_PHRASE = {
    "last_active": "While you were away",
    "tracking_started": "Since I started keeping track",
}


def _window(snapshot: AttentionSnapshot) -> str:
    return _WINDOW_PHRASE.get(snapshot.since_reason, "since I started keeping track")


def _header(snapshot: AttentionSnapshot) -> str:
    return _HEADER_PHRASE.get(snapshot.since_reason, "Since I started keeping track")


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular if count == 1 else (plural or singular + 's')}"


def _guard(snapshot: AttentionSnapshot | None) -> str | None:
    """The two cases every activity answer shares: no data to answer from, and no history to
    measure against. Returns the sentence to say, or None to carry on with the real answer."""
    if snapshot is None:
        return ACTIVITY_UNAVAILABLE_TEXT
    if snapshot.has_no_history:
        return NO_ACTIVITY_HISTORY_TEXT
    return None


# --- T3 attention digest --------------------------------------------------------------------
#
# THE PRIORITY ORDER, and it is the whole feature. "What did I miss?" is not a request for a
# tally — it is a request to be told what to do next. The five categories below are listed in
# descending order of how strongly the thing is aimed at THIS PERSON:
#
#   1. mentions            somebody typed this person's name and is waiting on them
#   2. missed calls        somebody tried to reach them in real time and failed
#   3. priority Hub items  the Hub itself marked required/important
#   4. ordinary chat       volume in their conversations, aimed at nobody in particular
#   5. ordinary Hub items  posted to be read eventually
#
# STILL COUNTS ONLY. The digest reorders and re-labels the same six integers T2 already
# collected; it reads no new field, and there is no new field for it to read (see
# services/toucan/activity.py — the AttentionSnapshot IS the privacy boundary). No line below
# can name a person, a conversation, a Hub item or a word anybody wrote, because none of those
# is reachable from here.
#
# THE SUBSET ARITHMETIC. `mention_count` is a subset of `chat_count` and `pressing_hub_count` a
# subset of `hub_count` (see repositories/toucan_activity.py). The digest therefore subtracts
# before it prints: a mention counted on line 1 must not be counted again on line 4, or a
# person with three mentions and nothing else would be told they have three mentions AND three
# chat messages. max(0, ...) guards the subtraction rather than trusting the invariant — a
# negative bullet would be a far worse bug than an under-count.

_BULLET = "\u2022 "


def _digest_lines(snapshot: AttentionSnapshot) -> list[str]:
    """The non-zero categories, highest-value signal first. A zero category is omitted, never
    printed as "0 mentions" — a digest of zeroes is noise, and the zero state is its own answer
    (see _attention_digest)."""
    other_chat = max(0, snapshot.chat_count - snapshot.mention_count)
    other_hub = max(0, snapshot.hub_count - snapshot.pressing_hub_count)

    lines: list[str] = []
    if snapshot.mention_count:
        verb = "needs" if snapshot.mention_count == 1 else "need"
        lines.append(f"{_plural(snapshot.mention_count, 'mention')} {verb} your attention")
    if snapshot.missed_call_count:
        lines.append(_plural(snapshot.missed_call_count, "missed call"))
    if snapshot.pressing_hub_count:
        lines.append(_plural(snapshot.pressing_hub_count, "priority Hub item"))
    if other_chat:
        # "other" is only true once something has been listed above it. On a chat-only digest
        # the word would be a small lie about a comparison that was never made.
        label = "other chat message" if snapshot.mention_count else "chat message"
        lines.append(_plural(other_chat, label))
    if other_hub:
        label = "other Hub item" if snapshot.pressing_hub_count else "Hub item"
        lines.append(_plural(other_hub, label))
    return lines


def _digest_lead(snapshot: AttentionSnapshot) -> str:
    """What to open first, named by CATEGORY. This is the sentence "What should I look at
    first?" is actually asking for, and it is answerable without knowing a single thing about
    the item itself — which is why the digest can offer it at all."""
    if snapshot.mention_count:
        return "Start with the mention." if snapshot.mention_count == 1 else "Start with the mentions."
    if snapshot.missed_call_count:
        noun = _plural(snapshot.missed_call_count, "missed call").split(" ", 1)[1]
        return f"Start with the {noun}."
    if snapshot.pressing_hub_count:
        noun = _plural(snapshot.pressing_hub_count, "priority Hub item").split(" ", 1)[1]
        return f"Start with the {noun}."
    # Reached only when the whole digest is ordinary volume: real, but aimed at nobody.
    return "None of it is flagged for you specifically."


def _away_summary_answer(snapshot: AttentionSnapshot) -> str:
    """The T3 digest. Multi-line by design — the panel renders assistant text with
    `white-space: pre-wrap` (see frontend Chat/ConversationView.module.css), so the newlines
    below display as written and no frontend change was needed to show them."""
    if snapshot.is_empty:
        # A CLEAN ZERO STATE, not a list of zeroes. Says which categories were checked so the
        # answer is falsifiable, without printing a single number.
        return (
            f"Nothing came in {_window(snapshot)} — no mentions, missed calls, Hub items or "
            "chat messages."
        )
    bullets = "\n".join(f"{_BULLET}{line}" for line in _digest_lines(snapshot))
    return f"{_header(snapshot)}:\n{bullets}\n\n{_digest_lead(snapshot)}"


def _single_count_answer(count: int, *, some: str, none: str, window: str) -> str:
    """One number, worded. `some` carries a {n} placeholder so the pluralisation stays with the
    noun it belongs to."""
    if not count:
        return f"{none} {window}."
    return f"{some.format(n=count)} {window}."


def _important_answer(snapshot: AttentionSnapshot) -> str:
    """"Anything I need to check?" is a triage question, so it reports the roll-up and then says
    what it is made of. Ordinary chat volume is excluded by construction (see
    services/toucan/activity.py's important_count) — a busy group thread is not, by itself, a
    thing demanding the reader's attention."""
    if not snapshot.important_count:
        return (
            f"Nothing looks urgent {_window(snapshot)} — no mentions, missed calls or "
            "priority Hub items."
        )
    detail: list[str] = []
    if snapshot.mention_count:
        times = "once" if snapshot.mention_count == 1 else f"{snapshot.mention_count} times"
        detail.append(f"you were mentioned {times}")
    if snapshot.missed_call_count:
        detail.append(f"you missed {_plural(snapshot.missed_call_count, 'call')}")
    if snapshot.pressing_hub_count:
        detail.append(
            f"there {'is' if snapshot.pressing_hub_count == 1 else 'are'} "
            f"{_plural(snapshot.pressing_hub_count, 'priority Hub item')}"
        )
    head = _plural(snapshot.important_count, "thing")
    return f"{head} worth checking {_window(snapshot)}: {_join(detail)}."


def _activity_answer(intent: str, snapshot: AttentionSnapshot) -> str:
    window = _window(snapshot)
    if intent == "missed_chats":
        return _single_count_answer(
            snapshot.chat_count,
            some="You received {n} chat message" + ("" if snapshot.chat_count == 1 else "s"),
            none="No chat messages came in",
            window=window,
        )
    if intent == "missed_mentions":
        if not snapshot.mention_count:
            return f"Nobody mentioned you {window}."
        times = "once" if snapshot.mention_count == 1 else f"{snapshot.mention_count} times"
        return f"You were mentioned {times} {window}."
    if intent == "missed_calls":
        return _single_count_answer(
            snapshot.missed_call_count,
            some="You missed {n} call" + ("" if snapshot.missed_call_count == 1 else "s"),
            none="You didn't miss any calls",
            window=window,
        )
    if intent == "important_summary":
        return _important_answer(snapshot)
    return _away_summary_answer(snapshot)


# --- resolver ------------------------------------------------------------------------------


def answer_question(
    question: str, ctx: OfficeContext, *, activity: AttentionSnapshot | None = None
) -> Answer:
    """Resolve one question against a caller-scoped OfficeContext, and — for the T2 activity
    intents — a caller-scoped AttentionSnapshot.

    Pure and synchronous — the same question against the same context and snapshot always
    produces the same answer. Conversation history is intentionally not a parameter: each
    question is answered on its own (see app/routers/toucan.py on why history is still accepted
    on the wire).

    `activity` is a VALUE, never a session or a repository — this function still cannot reach
    a database, which is what keeps the storage-free rule over services/toucan/ true at T2 (see
    tests/test_toucan_privacy.py). It is optional and defaults to None: the router only builds
    one when is_activity_question says the question needs it, and a missing snapshot degrades to
    ACTIVITY_UNAVAILABLE_TEXT rather than to a fabricated zero.
    """
    text = _normalize_question(question)
    if not text:
        return Answer(text=FALLBACK_TEXT, intent=INTENT_UNSUPPORTED, supported=False)

    # T2 FIRST. These phrasings are about the past and are unambiguous, so they can shadow
    # nothing below — and putting them first means a live-state pattern can never accidentally
    # claim one of them as the feature grows.
    for intent, patterns in _ACTIVITY_INTENTS:
        if _first_match(patterns, text):
            blocked = _guard(activity)
            if blocked is not None:
                return Answer(text=blocked, intent=intent, supported=True)
            assert activity is not None  # _guard returns a sentence when it is None
            return Answer(text=_activity_answer(intent, activity), intent=intent, supported=True)

    # T5 untracked statuses (breaks/lunch) — before every live-state intent so a lunch question
    # can never be half-answered out of a weaker signal. The person form still resolves the name,
    # so an unknown colleague gets the usual "I don't know anyone called..." answer.
    if _first_match(_UNTRACKED_ROSTER, text):
        return Answer(text=UNTRACKED_STATUS_TEXT, intent="status_untracked", supported=True)

    match = _first_match(_UNTRACKED_PERSON, text)
    if match:
        name = _clean_person(match.group("person"))
        if name:
            result = resolve_person(ctx, name)
            if result.is_ambiguous:
                return Answer(
                    text=_ambiguous_person(name, result.matches),
                    intent="status_untracked",
                    supported=True,
                )
            if result.person is not None:
                return Answer(
                    text=_untracked_person_answer(result.person),
                    intent="status_untracked",
                    supported=True,
                )
            if _looks_like_a_name(name):
                return Answer(
                    text=_no_such_person(name, roster_available=ctx.roster_available),
                    intent="status_untracked",
                    supported=True,
                )
            # "is anyone at lunch" — a roster question, and the honest answer is the same.
            return Answer(text=UNTRACKED_STATUS_TEXT, intent="status_untracked", supported=True)

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

    # T5 headcounts. Counts of the same rosters the list intents word; the online phrasing keeps
    # the liveness disclaimer, because a count is not a stronger claim than a list.
    if _first_match(_HEADCOUNT_LIVENESS, text):
        return Answer(
            text=_headcount_answer(
                present_people(ctx),
                some="{n} checked in",
                none="Nobody is checked in right now.",
                prefix=f"{LIVENESS_UNKNOWN_TEXT} ",
            ),
            intent="headcount",
            supported=True,
        )

    if _first_match(_HEADCOUNT_CALLS, text):
        return Answer(
            text=_headcount_answer(
                people_in_calls(ctx),
                some="{n} in a call",
                none="Nobody is in a call right now.",
            ),
            intent="headcount",
            supported=True,
        )

    if _first_match(_HEADCOUNT_PRESENT, text):
        return Answer(
            text=_headcount_answer(
                present_people(ctx),
                some="{n} in the office",
                none="Nobody is in the office right now.",
            ),
            intent="headcount",
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

    if _first_match(_IN_CONVERSATION, text):
        return Answer(
            text=_roster_answer(
                people_in_conversations(ctx),
                some="in a conversation.",
                none="Nobody is in a conversation right now.",
            ),
            intent="in_conversation",
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

    if _first_match(_AVAILABLE, text):
        return Answer(
            text=_roster_answer(
                available_people(ctx),
                some="free to talk right now.",
                none="Nobody looks free to talk right now.",
            ),
            intent="available",
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

    if _first_match(_OCCUPIED_ROOMS, text):
        return Answer(
            text=_occupied_rooms_answer(occupied_rooms(ctx)),
            intent="occupied_rooms",
            supported=True,
        )

    # Named rooms LAST among the who-is forms, so every specific phrasing above ("the office",
    # "a call", "this room") keeps its own intent and only a genuine room name lands here.
    match = _first_match(_ROOM_NAMED, text)
    if match:
        return Answer(
            text=_named_room_answer(ctx, match.group("room")),
            intent="room_occupants",
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
