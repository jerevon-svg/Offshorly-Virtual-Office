from __future__ import annotations

from dataclasses import dataclass

from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.services.position_registry import position_registry
from app.services.toucan.roster import RosterPerson, fetch_roster

# THE ONE PLACE TOUCAN READS OFFICE STATE.
#
# Every registry read the Toucan feature performs happens in this module and nowhere else.
# That is deliberate and load-bearing in two directions:
#
#   1. PRIVACY. `build_office_context()` copies field-by-field out of the existing snapshots
#      into the frozen views below — it never spreads a snapshot dict wholesale. The set of
#      fields Toucan can see is therefore the set of fields literally named in this file, and
#      it is asserted as a golden set in tests/test_toucan_context.py. Adding a field is a
#      visible, reviewable diff; it cannot happen by accident.
#
#   2. SCALING. app/realtime/state.py is the construction seam for the shared-state work
#      described in docs/realtime-scaling-roadmap.md. When R3 converts the store Protocols from
#      `def` to `async def`, every Toucan call site that must change is in this file — a
#      bounded, single-file addition to that conversion's blast radius rather than a diffuse
#      one. Keep it that way: no other Toucan module may import a registry.
#
# EXPLICITLY NOT READ HERE (and asserted absent by tests/test_toucan_privacy.py):
#   * chat message bodies, conversation lists, unread/mention counts, read receipts
#     (app/repositories/chat.py is never imported)
#   * LiveKit rooms, tokens, tracks, audio or video — note `call_registry.snapshot()` carries a
#     `room` (the LiveKit room id) and this module deliberately DROPS it; only "is this person
#     connected to a call, and to which spatial session" survives
#   * anything Atlas- or Cliq-derived beyond a name: `last_message`, `current_activity`,
#     `status`, tasks, person-card extras. The ONLY Atlas data that enters is the two-field
#     allowlist in services/toucan/roster.py (email + display name), fetched with the
#     caller's own bearer token. app/auth/atlas.py is still never imported — Toucan verifies
#     nothing, it only forwards.
#   * anything from a database — this module opens no session and takes no `db` dependency
#
# NO WORDING LIVES HERE. Every function below returns structured data. Sentences are built in
# office_assistant.py. That split is what lets these same functions become AI tool/function
# implementations later without being rewritten.


@dataclass(frozen=True)
class Position:
    """Live floor coordinates. Used ONLY to distinguish "placed somewhere on the floor" from
    "not placed at all" — office_assistant.py never renders raw coordinates at users."""

    x: float
    y: float


@dataclass(frozen=True)
class PersonView:
    """The complete, allowlisted view Toucan has of one person. If a fact is not a field here,
    Toucan cannot know it."""

    email: str
    # From the Atlas roster when available (services/toucan/roster.py), else None and the email's
    # local part is used for display. Identity only — never a status.
    display_name: str | None
    # THE ROSTER/REALTIME DISTINCTION. False means "this employee exists, and that is genuinely
    # all we know": they came from the Atlas roster and no realtime registry has seen them this
    # session. Roster membership is NOT presence, NOT availability, NOT a location — every
    # derived read below gates on this so existence can never be mistaken for a live claim.
    live_state_known: bool
    # Explicit checkout via the offline lineup. NOTE this is the only offline signal the VO
    # backend has: see app/realtime/socket.py's disconnect handler — presence is
    # explicit-checkout-only, there is no socket-liveness registry to read.
    checked_out: bool
    dnd: bool
    # This app's own hand-drawn room id (e.g. "ai-room"), from the room_presence registry.
    # NOT an Atlas/Zoho/Cliq room — the two namespaces are unrelated.
    room_id: str | None
    # Ephemeral in-world spatial clustering ("standing in a huddle with these people").
    session_id: str | None
    # The spatial session whose call this person is connected to, or None. Metadata only.
    call_session_id: str | None
    position: Position | None

    @property
    def in_call(self) -> bool:
        return self.call_session_id is not None

    @property
    def in_conversation(self) -> bool:
        return self.session_id is not None

    @property
    def present(self) -> bool:
        # A roster-only identity is never counted as present — we have no evidence either way.
        return self.live_state_known and not self.checked_out


@dataclass(frozen=True)
class Availability:
    """Structured answer to "can I talk to this person right now?" — no wording."""

    person: PersonView
    available: bool
    # Machine-readable reason the person is not available; None when they are.
    blocked_by: str | None


@dataclass(frozen=True)
class PersonMatch:
    """Result of resolving a name typed by a human onto known people."""

    matches: tuple[PersonView, ...]

    @property
    def is_unique(self) -> bool:
        return len(self.matches) == 1

    @property
    def is_ambiguous(self) -> bool:
        return len(self.matches) > 1

    @property
    def person(self) -> PersonView | None:
        return self.matches[0] if self.is_unique else None


@dataclass(frozen=True)
class OfficeContext:
    """A caller-scoped, immutable snapshot of live office state.

    Built per request and discarded — nothing here is persisted, cached or logged. `viewer_email`
    is always the server-derived caller (see app/routers/toucan.py); it is never taken from a
    request body.
    """

    viewer_email: str
    people: tuple[PersonView, ...]
    # False when the Atlas roster could not be read (no bearer token, Atlas down, bad response).
    # Purely informational for callers/tests; nothing is fabricated either way.
    roster_available: bool = False

    def person(self, email: str) -> PersonView | None:
        target = _normalize(email)
        return next((p for p in self.people if p.email == target), None)

    @property
    def viewer(self) -> PersonView | None:
        return self.person(self.viewer_email)


def _normalize(email: str) -> str:
    return email.strip().lower()


async def build_office_context(
    viewer_email: str, *, bearer_token: str | None = None
) -> OfficeContext:
    """Assemble the snapshot for one caller: authoritative identity from Atlas, live state from
    the in-process registries.

    THE SINGLE AGGREGATION POINT. Both sources are merged here and nowhere else — the intent
    resolver receives a finished OfficeContext and never reads a registry or calls Atlas itself.
    A future cache would go behind fetch_roster with no change to anything downstream.

    The registry reads below stay synchronous in-process dict reads (see
    docs/realtime-scaling-roadmap.md); the one await is the roster fetch, which never raises.
    """
    roster = await fetch_roster(bearer_token)
    return build_office_context_from(viewer_email, roster=roster, roster_available=bool(roster))


def build_office_context_from(
    viewer_email: str,
    *,
    roster: tuple[RosterPerson, ...] = (),
    roster_available: bool = False,
) -> OfficeContext:
    """Pure merge of an already-fetched roster with the current registries. Split out from the
    async builder so the merge is testable with no network and no monkeypatching."""
    viewer = _normalize(viewer_email)

    checked_out = {_normalize(entry["email"]) for entry in offline_lineup.snapshot()}
    dnd = {_normalize(email) for email in dnd_registry.snapshot()}

    room_by_email: dict[str, str] = {}
    for row in room_presence.snapshot():
        for member in row["members"]:
            room_by_email[_normalize(member)] = row["roomId"]

    session_by_email: dict[str, str] = {}
    for row in spatial_sessions.snapshot():
        for member in row["members"]:
            session_by_email[_normalize(member)] = row["sessionId"]

    # `row["room"]` is the LiveKit room id and is intentionally not copied — Toucan answers
    # "is this person on a call", never "which media room are they in".
    call_by_email: dict[str, str] = {}
    for row in call_registry.snapshot():
        for participant in row["participants"]:
            call_by_email[_normalize(participant)] = row["sessionId"]

    position_by_email: dict[str, Position] = {}
    for row in position_registry.snapshot(own_email=viewer):
        pos = row["pos"]
        position_by_email[_normalize(row["email"])] = Position(x=pos["x"], y=pos["y"])

    # EVIDENCE OF AN ACTIVE SESSION — and ONLY this — is what "we know their live state" means.
    # Every source here is populated by a socket event and cleared when that socket goes away
    # (see app/realtime/socket.py's disconnect handler), so membership implies someone is
    # actually here now.
    #
    # `position_by_email` IS DELIBERATELY ABSENT. The position registry is the one store that is
    # cold-loaded from the database at startup (app/main.py) and never cleared on disconnect —
    # by design, so nobody snaps back to (0,0) after a restart. That makes a persisted position
    # evidence of WHERE SOMEONE WAS, never that they are here now; counting it reported everyone
    # who had ever walked as "in the office right now", permanently and across restarts. It is
    # still read below, purely as location detail for someone we already know is live.
    #
    # ACCEPTED TRADEOFF: a connected user who is outside every room, not DND, not clustered and
    # not in a call has no evidence here and stays liveness-unknown. That is honest — there is
    # still no connected-users registry — and it is why the explicit-online disclaimer exists.
    live = (
        set(room_by_email)
        | set(session_by_email)
        | set(call_by_email)
        | dnd
        | checked_out
        | {viewer}
    )

    display_names = {person.email: person.display_name for person in roster}
    # IDENTITY is broader than liveness on purpose: someone we only know from a persisted
    # position (or from the roster) is still a person Toucan can recognise by name and answer
    # about — it just answers "I can't see where they are right now" instead of inventing a
    # location. Being in `known` is not being in `live`.
    known = live | set(position_by_email) | set(display_names)

    people = tuple(
        PersonView(
            email=email,
            display_name=display_names.get(email),
            live_state_known=email in live,
            checked_out=email in checked_out,
            dnd=email in dnd,
            room_id=room_by_email.get(email),
            session_id=session_by_email.get(email),
            call_session_id=call_by_email.get(email),
            position=position_by_email.get(email),
        )
        for email in sorted(known)
    )

    return OfficeContext(viewer_email=viewer, people=people, roster_available=roster_available)


# --- capabilities -------------------------------------------------------------------------
# Pure, structured queries over an OfficeContext. These are the units that become AI
# tool/function implementations at a later stage; today office_assistant.py is their only
# caller. None of them return prose.


def present_people(ctx: OfficeContext) -> tuple[PersonView, ...]:
    """Everyone this process knows about who has not explicitly checked out.

    "Present" here means exactly that — known to this worker and not checked out. It is NOT
    socket-connection liveness; the VO backend has no such registry (see PersonView.checked_out).
    """
    return tuple(p for p in ctx.people if p.present)


def checked_out_people(ctx: OfficeContext) -> tuple[PersonView, ...]:
    return tuple(p for p in ctx.people if p.checked_out)


def dnd_people(ctx: OfficeContext) -> tuple[PersonView, ...]:
    return tuple(p for p in ctx.people if p.dnd and p.present)


def people_in_calls(ctx: OfficeContext) -> tuple[PersonView, ...]:
    return tuple(p for p in ctx.people if p.in_call)


def room_occupants(ctx: OfficeContext, room_id: str) -> tuple[PersonView, ...]:
    return tuple(p for p in ctx.people if p.room_id == room_id)


def locate(ctx: OfficeContext, email: str) -> PersonView | None:
    return ctx.person(email)


def availability(ctx: OfficeContext, person: PersonView) -> Availability:
    """Ordered most- to least-blocking, so the reason returned is the one worth telling a human
    about first."""
    if not person.live_state_known:
        return Availability(person=person, available=False, blocked_by="live_state_unknown")
    if person.checked_out:
        return Availability(person=person, available=False, blocked_by="checked_out")
    if person.in_call:
        return Availability(person=person, available=False, blocked_by="in_call")
    if person.dnd:
        return Availability(person=person, available=False, blocked_by="dnd")
    if person.in_conversation:
        return Availability(person=person, available=False, blocked_by="in_conversation")
    return Availability(person=person, available=True, blocked_by=None)


# Words that look like a name in "is <x> available" but are not one. Without this guard,
# "is anyone available" resolves to a lookup for a person called "anyone". Public because
# office_assistant.py needs the same list to decide whether a failed lookup is worth reporting
# to the user or should fall through to the next intent.
NOT_A_NAME = frozenset(
    {
        "anyone",
        "anybody",
        "someone",
        "somebody",
        "everyone",
        "everybody",
        "people",
        "he",
        "she",
        "they",
        "them",
        "it",
        "i",
        "me",
        "my",
        "we",
        "us",
        "the",
        "a",
        "an",
        "that",
        "this",
        "there",
    }
)


def _name_tokens(person: PersonView) -> set[str]:
    """Name-ish tokens for one person: the email's local part split on separators
    ("bon.jerevon@x.com" -> {"bon", "jerevon", "bonjerevon"}), plus the words of the Atlas
    display name when there is one."""
    local = person.email.split("@", 1)[0]
    parts = {part for part in local.replace("_", ".").replace("-", ".").split(".") if part}
    tokens = parts | {local}
    if person.display_name:
        tokens |= {word for word in person.display_name.lower().split() if word}
    return tokens


def resolve_person(ctx: OfficeContext, raw_name: str) -> PersonMatch:
    """Map a human-typed name onto known people. Returns every candidate; the caller decides
    what to do about zero or several (office_assistant.py words it)."""
    query = _normalize(raw_name)
    if not query or query in NOT_A_NAME:
        return PersonMatch(matches=())

    if "@" in query:
        exact = ctx.person(query)
        return PersonMatch(matches=(exact,) if exact else ())

    query_tokens = {t for t in query.replace("_", " ").replace("-", " ").split() if t}
    if not query_tokens or query_tokens <= NOT_A_NAME:
        return PersonMatch(matches=())

    matches = []
    for person in ctx.people:
        tokens = _name_tokens(person)
        if query_tokens <= tokens:
            matches.append(person)
            continue
        # Prefix match so "ang" finds "angelo", but only on a single-word query — a multi-word
        # query that did not match whole tokens above is not a prefix of anything useful.
        if len(query_tokens) == 1 and any(t.startswith(query) for t in tokens):
            matches.append(person)

    return PersonMatch(matches=tuple(matches))
