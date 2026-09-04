from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# A2.1 — EXPLICIT, TEMPORARY DELEGATION: parsing and wording. Pure module, storage-free like the
# rest of this package (tests/test_toucan_privacy.py): no database, no network, no registry. It
# decides WHAT a valid delegation request is and how to word it; the router owns the pending
# proposal around it and repositories/toucan_delegation.py owns the durable row.
#
# THE PRODUCT RULES THIS MODULE ENCODES STRUCTURALLY:
#
#   * EXPLICIT. Only the imperative "handle/assist with/cover my messages for <duration>"
#     phrasings below become a proposal. "I'm away", "I'll be back later", "I'm busy" match
#     nothing — Toucan never infers permission to act on somebody's behalf. Even a matched
#     phrasing only ever yields a PROPOSAL that the explicit Confirm click alone activates.
#   * TEMPORARY, DURATION-ONLY AT A2.1. Every pattern requires an explicit "for N minutes/hours";
#     clock times ("until 3 PM"), "until I return" and status-triggered delegation are not
#     parsed here, so they can never activate silently. The duration is clamped to a hard cap.
#   * SELF-SCOPED BY CONSTRUCTION. There is no target field on the dataclass — "handle Micah's
#     messages" is not merely rejected, it is unrepresentable. The owner is always the bearer
#     identity bound where the pending entry is created.
#   * NEVER IMPERSONATES. Every automatic reply Toucan sends under a delegation begins with the
#     fixed prefix built by assisting_prefix() and states only what the templates below state:
#     no return time, no reason, no commitment, no decision.

ACTION_START_DELEGATION = "start_delegation"

# Scopes. A2.1 rows carry "dm" (direct messages only) and keep behaving that way. A2.2 makes
# "dm_and_groups" the default for NEW delegations: direct messages plus group messages that
# carry a server-validated @mention of the owner — never general group chatter.
SCOPE_DM = "dm"
SCOPE_DM_AND_GROUPS = "dm_and_groups"
SCOPES = (SCOPE_DM, SCOPE_DM_AND_GROUPS)

# End conditions. "at_time" carries an absolute expiry (from a duration or a clock time);
# "until_return" (A2.3) has none and ends on strong evidence the owner is back — or at the cap.
END_AT_TIME = "at_time"
END_UNTIL_RETURN = "until_return"

# Bounds on one delegation. The cap is the audited hard ceiling: a delegation that outlives a
# working day is a stale one, not a helpful one.
DELEGATION_MIN_MINUTES = 5
DELEGATION_MAX_MINUTES = 24 * 60


@dataclass(frozen=True)
class StartDelegationAction:
    """One validated start-delegation proposal. NOTE WHAT IS NOT HERE: no owner, no target, no
    conversation — the owner is the authenticated caller, bound at proposal time by the router
    and re-derived from the bearer identity at confirm time."""

    # Duration form: already clamped to [DELEGATION_MIN_MINUTES, DELEGATION_MAX_MINUTES].
    duration_minutes: int | None
    scope: str = SCOPE_DM_AND_GROUPS
    end_condition: str = END_AT_TIME
    # Clock form (A2.3): the RESOLVED absolute end in UTC, and the label the card shows in the
    # requester's own zone ("3:00 PM today"). Only ever produced by resolve_clock_request.
    ends_at: datetime | None = None
    end_label: str | None = None

    @property
    def is_until_return(self) -> bool:
        return self.end_condition == END_UNTIL_RETURN

    @property
    def action(self) -> str:
        return ACTION_START_DELEGATION


def clamp_duration(minutes: int) -> int:
    return max(DELEGATION_MIN_MINUTES, min(DELEGATION_MAX_MINUTES, minutes))


@dataclass(frozen=True)
class DelegationClockRequest:
    """An UNRESOLVED "until <clock time>" request: the local wall-clock the user typed, 24-hour.
    Not yet a proposal — resolve_clock_request needs the caller's IANA zone to turn it into an
    absolute UTC instant, and refuses to guess when it cannot."""

    hour: int
    minute: int
    scope: str = SCOPE_DM_AND_GROUPS


@dataclass(frozen=True)
class ClockProblem:
    """Why an "until <time>" could not be resolved. kind ∈ {"no_timezone", "already_passed"}.
    The router answers with a clarification and creates nothing."""

    kind: str
    label: str | None = None


# --- deterministic parsing ---------------------------------------------------------------------

_WORD_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}

_DURATION = (
    r"for\s+(?:the\s+next\s+)?(?:(?P<half>half\s+an?\s+hour)|"
    r"(?P<n>\d{1,4}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)"
    r"\s*(?P<unit>min|mins|minute|minutes|h|hr|hrs|hour|hours))"
)

# Optional, harmless preambles. They never widen what counts as a request — the explicit
# "for <duration>" tail is still mandatory.
_PREAMBLE = r"(?:(?:while|when)\s+i(?:['’]m|\s+am)\s+(?:away|out|gone|offline|afk)[,\s]+)?(?:please\s+)?"
_VERB = r"(?:handle|assist\s+with|help\s+with|cover|manage|take\s+care\s+of|look\s+after|watch)"
_OBJECT = r"my\s+(?:messages|dms|direct\s+messages|chats|inbox)"

_START_PATTERNS = [
    re.compile(rf"^{_PREAMBLE}{_VERB}\s+{_OBJECT}(?:\s+for\s+me)?\s+{_DURATION}$", re.IGNORECASE),
    # "for 2 hours, handle my messages"
    re.compile(rf"^{_PREAMBLE}{_DURATION}[,\s]+(?:please\s+)?{_VERB}\s+{_OBJECT}(?:\s+for\s+me)?$", re.IGNORECASE),
]

# A2.3 — "until <clock time>", today, in the requester's zone. AM/PM makes any hour explicit; without
# it only an unambiguous 24-hour form is accepted (hour ≥ 13, or a two-digit hour like "09:30").
# "until 3" or "until 3:30" with no AM/PM matches NOTHING — ambiguity is refused, not guessed.
_CLOCK = (
    r"until\s+(?P<hour>\d{1,2})(?::(?P<minute>[0-5]\d))?\s*(?P<ampm>a\.?m\.?|p\.?m\.?)?(?:\s+today)?"
)
_CLOCK_PATTERNS = [
    re.compile(rf"^{_PREAMBLE}{_VERB}\s+{_OBJECT}(?:\s+for\s+me)?\s+{_CLOCK}$", re.IGNORECASE),
]

# A2.3 — "until I return". Still requires the explicit handling verb: "I'll be back" alone is nothing.
_RETURN = r"until\s+(?:i(?:['’]m|\s+am)\s+back|i\s+(?:return|come\s+back|get\s+back)|my\s+return)"
_RETURN_PATTERNS = [
    re.compile(rf"^{_PREAMBLE}{_VERB}\s+{_OBJECT}(?:\s+for\s+me)?\s+{_RETURN}$", re.IGNORECASE),
]

_STOP_VERB = r"(?:handling|assisting\s+with|helping\s+with|covering|managing|taking\s+care\s+of|looking\s+after|watching)"
_STOP_PATTERNS = [
    re.compile(
        rf"^(?:i(?:['’]m|\s+am)\s+back[,\s]+)?(?:please\s+)?(?:stop|cancel|end)\s+"
        rf"(?:{_STOP_VERB}\s+{_OBJECT}(?:\s+for\s+me)?|(?:the\s+|my\s+)?(?:message\s+)?delegation)$",
        re.IGNORECASE,
    ),
]


def _normalize(question: str) -> str:
    return re.sub(r"[.!?\s]+$", "", " ".join(question.split()))


def _minutes_from(match: re.Match) -> int | None:
    if match.group("half"):
        return 30
    raw = match.group("n").lower()
    count = int(raw) if raw.isdigit() else _WORD_NUMBERS.get(raw)
    if count is None:
        return None
    unit = match.group("unit").lower()
    return count if unit.startswith("m") else count * 60


def _clock_from(match: re.Match) -> tuple[int, int] | None:
    hour_token = match.group("hour")
    hour = int(hour_token)
    minute = int(match.group("minute") or 0)
    ampm = (match.group("ampm") or "").replace(".", "").lower()
    if ampm:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if ampm == "pm" else 0)
        return hour, minute
    # 24-hour form only when it cannot be mistaken for a 12-hour one.
    if hour > 23:
        return None
    if hour >= 13 or len(hour_token) == 2:
        return hour, minute
    return None


def parse_delegation_request(question: str) -> StartDelegationAction | DelegationClockRequest | None:
    """Explicit "handle my messages …" phrasings → a proposal-to-be, or None.

    * "for <duration>"      → StartDelegationAction (at_time, resolved here)
    * "until <clock time>"  → DelegationClockRequest (needs the caller's zone; see resolve_clock_request)
    * "until I return"      → StartDelegationAction (until_return)
    Anything else — a vague "I'm away", a time with no AM/PM that could mean either half of the
    day, "until tomorrow" — is None."""
    text = _normalize(question)
    for pattern in _START_PATTERNS:
        match = pattern.match(text)
        if match is None:
            continue
        minutes = _minutes_from(match)
        if minutes is None or minutes <= 0:
            return None
        return StartDelegationAction(duration_minutes=clamp_duration(minutes))
    for pattern in _CLOCK_PATTERNS:
        match = pattern.match(text)
        if match is None:
            continue
        clock = _clock_from(match)
        return DelegationClockRequest(hour=clock[0], minute=clock[1]) if clock else None
    for pattern in _RETURN_PATTERNS:
        if pattern.match(text):
            return StartDelegationAction(duration_minutes=None, end_condition=END_UNTIL_RETURN)
    return None


# --- A2.3: resolving a clock time in the requester's zone ----------------------------------------

_TZ_SHAPE = re.compile(r"^[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+){0,3}$")


def validate_timezone(name: str | None) -> ZoneInfo | None:
    """The client's IANA zone, or None when absent, malformed or unknown. Used ONLY to interpret
    a wall-clock the user typed — never for identity, never stored."""
    if not name or len(name) > 64 or not _TZ_SHAPE.match(name):
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def format_clock(local: datetime) -> str:
    hour12 = local.hour % 12 or 12
    return f"{hour12}:{local.minute:02d} {'PM' if local.hour >= 12 else 'AM'}"


def resolve_clock_request(
    request: DelegationClockRequest, *, client_timezone: str | None, now: datetime | None = None
) -> StartDelegationAction | ClockProblem:
    """Turn "until 3 PM" into an absolute UTC end — TODAY in the caller's zone, never rolled over
    to tomorrow. A wall-clock already behind the caller's local now is refused (ClockProblem
    "already_passed"); a missing or unknown zone is refused ("no_timezone")."""
    zone = validate_timezone(client_timezone)
    if zone is None:
        return ClockProblem(kind="no_timezone")
    current = (now or datetime.now(timezone.utc)).astimezone(zone)
    local_end = current.replace(hour=request.hour, minute=request.minute, second=0, microsecond=0)
    label = f"{format_clock(local_end)} today"
    if local_end <= current:
        return ClockProblem(kind="already_passed", label=label)
    return StartDelegationAction(
        duration_minutes=None,
        scope=request.scope,
        end_condition=END_AT_TIME,
        ends_at=local_end.astimezone(timezone.utc),
        end_label=label,
    )


def parse_stop_delegation(question: str) -> bool:
    """Explicit "stop handling my messages" phrasings. Stopping is the safe direction, so the
    router executes it immediately without a confirmation round-trip."""
    text = _normalize(question)
    return any(p.match(text) for p in _STOP_PATTERNS)


# --- wording -----------------------------------------------------------------------------------


def duration_phrase(minutes: int) -> str:
    if minutes % 60 == 0:
        hours = minutes // 60
        return "1 hour" if hours == 1 else f"{hours} hours"
    if minutes > 60:
        hours, rest = divmod(minutes, 60)
        return f"{hours} hour{'s' if hours != 1 else ''} {rest} minutes"
    return f"{minutes} minutes"


def scope_label(scope: str) -> str:
    return "direct messages only" if scope == SCOPE_DM else "direct messages + group @mentions"


def window_phrase(action: StartDelegationAction) -> str:
    """"for 2 hours" | "until 3:00 PM today" | "until you return"."""
    if action.is_until_return:
        return "until you return"
    if action.ends_at is not None:
        return f"until {action.end_label or 'the time you gave'}"
    return f"for {duration_phrase(action.duration_minutes or 0)}"


def proposal_summary(action: StartDelegationAction) -> str:
    cap = ", maximum 24 hours" if action.is_until_return else ""
    return f"Let Toucan handle your messages {window_phrase(action)} ({scope_label(action.scope)}{cap})"


def confirmation_text(action: StartDelegationAction) -> str:
    return (
        f"I can handle your messages {window_phrase(action)}"
        + (" — for at most 24 hours" if action.is_until_return else "")
        + f" ({scope_label(action.scope)}). While that's on, I'll answer people who DM you"
        + (" or @mention you in a group" if action.scope == SCOPE_DM_AND_GROUPS else "")
        + " — clearly as Toucan assisting you — and let them know you're unavailable and will see "
        "their message when you're back. I won't watch general group chatter. "
        "Nothing is active yet — confirm below and I'll start."
    )


def executed_text(action: StartDelegationAction) -> str:
    return (
        f"Done — I'm handling your messages ({scope_label(action.scope)}) "
        + (
            "until you return (24 hours at most)"
            if action.is_until_return
            else f"until {action.end_label}" if action.ends_at is not None
            else f"for the next {duration_phrase(action.duration_minutes or 0)}"
        )
        + ". Say “stop handling my messages” any time to end it."
    )


def cancelled_text(action: StartDelegationAction) -> str:
    return "Okay, cancelled — I'm not handling your messages."


def stopped_text() -> str:
    return "Okay — I've stopped handling your messages."


def nothing_to_stop_text() -> str:
    return "I wasn't handling your messages, so there's nothing to stop."


def replaced_text() -> str:
    return "That replaced the delegation you already had running."


def clock_problem_text(problem: ClockProblem) -> str:
    """A clarification, never a guess: nothing is proposed and nothing is created."""
    if problem.kind == "already_passed":
        return (
            f"{problem.label or 'That time'} has already passed, so I haven't set anything up. "
            "Give me a later time, a duration like “for 2 hours”, or say “until I return”."
        )
    return (
        "I couldn't work out your local time zone, so I haven't set anything up. "
        "Try a duration like “for 2 hours” or say “until I return”."
    )


# --- the automatic replies -----------------------------------------------------------------------


def display_name_from_email(email: str) -> str:
    """A speaker label without exposing the address: the capitalised local part ("bon@…" →
    "Bon", "micah.reyes@…" → "Micah Reyes"). Same derivation services/chat_assistant.py uses."""
    local = email.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
    return " ".join(w[:1].upper() + w[1:] for w in local.split()) or "Someone"


def assisting_prefix(owner_email: str) -> str:
    return f"Toucan — assisting {display_name_from_email(owner_email)}:"


def first_reply_text(owner_email: str) -> str:
    """The first automatic reply in a conversation. Says WHO is speaking, that the owner is
    unavailable (never why), that the owner will see the message on return (never when), and
    asks about urgency. Nothing here promises, approves, decides or commits."""
    name = display_name_from_email(owner_email)
    return (
        f"{assisting_prefix(owner_email)} {name} is currently unavailable. "
        "They'll see your message when they return. Is this urgent?"
    )


def follow_up_reply_text(owner_email: str) -> str:
    name = display_name_from_email(owner_email)
    return f"{assisting_prefix(owner_email)} {name} is still unavailable and will see this when they return."


# --- A2.2: one reply for several owners -----------------------------------------------------------


def sorted_owners(owner_emails: list[str]) -> list[str]:
    """Deterministic order for a combined reply: by display name, then by address. Duplicates
    (any casing) collapse to one."""
    unique = {e.strip().lower() for e in owner_emails if e and e.strip()}
    return sorted(unique, key=lambda e: (display_name_from_email(e).lower(), e))


def assisting_label(owner_emails: list[str]) -> str:
    names = [display_name_from_email(e) for e in sorted_owners(owner_emails)]
    if not names:
        return "Someone"
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def combined_first_reply_text(owner_emails: list[str]) -> str:
    """ONE reply naming every owner it speaks for. A single owner keeps the A2.1 wording exactly."""
    owners = sorted_owners(owner_emails)
    if len(owners) == 1:
        return first_reply_text(owners[0])
    return (
        f"Toucan — assisting {assisting_label(owners)}: They're currently unavailable and will see "
        "your message when they return. Is this urgent?"
    )


def combined_follow_up_reply_text(owner_emails: list[str]) -> str:
    owners = sorted_owners(owner_emails)
    if len(owners) == 1:
        return follow_up_reply_text(owners[0])
    return f"Toucan — assisting {assisting_label(owners)}: They're still unavailable and will see this when they return."
