from __future__ import annotations

import re
from dataclasses import dataclass

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

# Bounds on one delegation. The cap is the audited hard ceiling: a delegation that outlives a
# working day is a stale one, not a helpful one.
DELEGATION_MIN_MINUTES = 5
DELEGATION_MAX_MINUTES = 24 * 60


@dataclass(frozen=True)
class StartDelegationAction:
    """One validated start-delegation proposal. NOTE WHAT IS NOT HERE: no owner, no target, no
    conversation — the owner is the authenticated caller, bound at proposal time by the router
    and re-derived from the bearer identity at confirm time."""

    # Already clamped to [DELEGATION_MIN_MINUTES, DELEGATION_MAX_MINUTES].
    duration_minutes: int
    scope: str = SCOPE_DM_AND_GROUPS

    @property
    def action(self) -> str:
        return ACTION_START_DELEGATION


def clamp_duration(minutes: int) -> int:
    return max(DELEGATION_MIN_MINUTES, min(DELEGATION_MAX_MINUTES, minutes))


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


def parse_delegation_request(question: str) -> StartDelegationAction | None:
    """Explicit "handle my messages for <duration>" phrasings → a proposal-to-be, or None. A
    request with no explicit duration (including "until 3 PM" / "until I return") is None."""
    text = _normalize(question)
    for pattern in _START_PATTERNS:
        match = pattern.match(text)
        if match is None:
            continue
        minutes = _minutes_from(match)
        if minutes is None or minutes <= 0:
            return None
        return StartDelegationAction(duration_minutes=clamp_duration(minutes))
    return None


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


def proposal_summary(action: StartDelegationAction) -> str:
    return f"Let Toucan handle your messages for {duration_phrase(action.duration_minutes)} ({scope_label(action.scope)})"


def confirmation_text(action: StartDelegationAction) -> str:
    return (
        f"I can handle your messages for {duration_phrase(action.duration_minutes)} "
        f"({scope_label(action.scope)}). While that's on, I'll answer people who DM you"
        + (" or @mention you in a group" if action.scope == SCOPE_DM_AND_GROUPS else "")
        + " — clearly as Toucan assisting you — and let them know you're unavailable and will see "
        "their message when you're back. I won't watch general group chatter. "
        "Nothing is active yet — confirm below and I'll start."
    )


def executed_text(action: StartDelegationAction) -> str:
    return (
        f"Done — I'm handling your messages ({scope_label(action.scope)}) for the next "
        f"{duration_phrase(action.duration_minutes)}. Say “stop handling my messages” any time to end it."
    )


def cancelled_text(action: StartDelegationAction) -> str:
    return "Okay, cancelled — I'm not handling your messages."


def stopped_text() -> str:
    return "Okay — I've stopped handling your messages."


def nothing_to_stop_text() -> str:
    return "I wasn't handling your messages, so there's nothing to stop."


def replaced_text() -> str:
    return "That replaced the delegation you already had running."


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
