from __future__ import annotations

import re
from dataclasses import dataclass

# T8 — SAFE ACTIONS: the server-owned allowlist, parsing, validation and wording. Pure module,
# storage-free like the rest of this package (see tests/test_toucan_privacy.py): no database, no
# network, no registry — it decides WHAT a valid action proposal is and how to word it; the
# router owns the pending-state and the confirm/cancel endpoints around it.
#
# THE CORE SAFETY PRINCIPLE, encoded structurally:
#
#   * The allowlist below is the ONLY set of actions that exists. T8 ships exactly one —
#     set_status, self-scoped by construction (there is no target field on the dataclass, so
#     "set Angelo to DND" is not merely rejected, it is unrepresentable).
#   * NOTHING the model emits is executed. The provider may hand the router a raw
#     {name, args} dict (its one structured outlet, see services/toucan_ai/provider.py);
#     validate_ai_proposal below is the only door that dict can pass through, and everything
#     that is not exactly an allowlisted name with exactly the allowed args comes back None —
#     which the router treats as "no action", never as an error the model can steer.
#   * A proposal NEVER executes on its own. It becomes a pending entry (see
#     pending_actions.py) that only an explicit POST /toucan/actions/{id}/confirm from the
#     same authenticated owner can consume — confirmation is structural, not conversational.
#
# STATUS VOCABULARY: mirrors frontend/src/services/presence/status.ts's MANUAL_STATUSES — the
# statuses a person can already set by hand in the StatusPicker, and nothing more. The status
# itself is a CLIENT-OWNED product concept (selfStatusStore + localStorage; only the DND bit is
# broadcast via the dnd_set socket event), so "execution" for set_status means: the server
# validates, gates on explicit confirmation, records the audit line, and returns the validated
# effect for the caller's own client to apply through the exact same code path the StatusPicker
# uses. The server never applies a status to anybody, so it cannot possibly apply one to
# somebody else.

# The action allowlist. T8 shipped set_status alone; A1 adds send_message now that chat has a
# reusable server-side write seam (app/services/chat_send.py — the same persist + fan-out path
# the Socket.IO handler uses). Movement and call actions remain deferred.
ACTION_SET_STATUS = "set_status"
ACTION_SEND_MESSAGE = "send_message"
ALLOWED_ACTIONS = (ACTION_SET_STATUS, ACTION_SEND_MESSAGE)

# Bounds on a proposed outgoing message. The chat path itself has no cap; this one only bounds
# what a proposal (typed or model-emitted) may carry.
MAX_MESSAGE_CHARS = 2000
MAX_RECIPIENT_CHARS = 200

# Intent label for an ask() answer that carries a proposal — same shape as the deterministic
# intent ids, stable for tests/telemetry.
ACTION_PROPOSAL_INTENT = "action_proposal"

# Mirrors frontend/src/services/presence/status.ts MANUAL_STATUSES. The frontend list remains
# the product authority; this copy exists because this module may not reach across the wire.
MANUAL_STATUSES = ("AVAILABLE", "BUSY", "BREAK", "LUNCH", "DND")

# DND is duration-bounded in the product (frontend/src/services/presence/dndPolicy.ts:
# 2h max session, 3h daily allowance). A Toucan DND proposal therefore always carries an
# explicit minute count so the confirmation can state the exact effect; these bounds mirror
# that policy and the client clamps again when applying.
DND_DEFAULT_MINUTES = 30
DND_MIN_MINUTES = 5
DND_MAX_MINUTES = 120


@dataclass(frozen=True)
class SetStatusAction:
    """One validated set-my-status proposal. NOTE WHAT IS NOT HERE: no target, no email, no
    endpoint, no free-form payload — the owner is always the authenticated caller, bound where
    the pending entry is created (routers/toucan.py), never carried by the action itself."""

    # One of MANUAL_STATUSES, already validated — construct via the functions below only.
    status: str
    # Present only when status == "DND"; already clamped to the bounds above.
    dnd_minutes: int | None = None

    @property
    def action(self) -> str:
        return ACTION_SET_STATUS


@dataclass(frozen=True)
class SendMessageRequest:
    """An UNRESOLVED send request: the recipient exactly as the user (or the model) named them,
    plus the exact outgoing text. Not yet a proposal — the router must resolve `recipient` onto
    exactly one known person (services/toucan/context.resolve_person) before a SendMessageAction
    exists. Zero or several matches never become a proposal; Toucan asks instead."""

    recipient: str
    text: str


@dataclass(frozen=True)
class SendMessageAction:
    """One validated, RESOLVED send-message proposal — what the confirmation card shows and what
    Confirm executes. The sender is never here: it is the authenticated owner of the pending
    entry, applied at confirm time from the bearer identity. `conversation_id` is the existing DM
    when one already exists; None means Confirm creates it (never the proposal)."""

    recipient_email: str
    recipient_label: str
    text: str
    conversation_id: str | None = None

    @property
    def action(self) -> str:
        return ACTION_SEND_MESSAGE


ToucanAction = SetStatusAction | SendMessageAction


# --- status word resolution --------------------------------------------------------------------

# What a person may call each status. Keys are matched against a lowercased, trimmed token.
_STATUS_WORDS = {
    "available": "AVAILABLE",
    "free": "AVAILABLE",
    "busy": "BUSY",
    "break": "BREAK",
    "on break": "BREAK",
    "on a break": "BREAK",
    "lunch": "LUNCH",
    "on lunch": "LUNCH",
    "dnd": "DND",
    "do not disturb": "DND",
    "do-not-disturb": "DND",
}

_STATUS_LABELS = {
    "AVAILABLE": "Available",
    "BUSY": "Busy",
    "BREAK": "Break",
    "LUNCH": "Lunch",
    "DND": "DND",
}


def resolve_status(word: str) -> str | None:
    """Map a user's (or the model's) status word onto the canonical vocabulary, or None. The
    canonical uppercase ids themselves are also accepted, so a model that echoes "BUSY" back
    verbatim validates the same as a person typing "busy"."""
    token = word.strip().lower()
    if not token:
        return None
    canonical = _STATUS_WORDS.get(token)
    if canonical:
        return canonical
    upper = token.upper()
    return upper if upper in MANUAL_STATUSES else None


def _clamp_dnd_minutes(value: int) -> int:
    return max(DND_MIN_MINUTES, min(DND_MAX_MINUTES, value))


def _finish(status: str, minutes: int | None) -> SetStatusAction:
    if status == "DND":
        return SetStatusAction(
            status=status,
            dnd_minutes=_clamp_dnd_minutes(minutes if minutes is not None else DND_DEFAULT_MINUTES),
        )
    # Non-DND statuses are indefinite in the product; a stray duration is meaningless and
    # dropped rather than invented into a new capability.
    return SetStatusAction(status=status)


# --- deterministic parsing ---------------------------------------------------------------------

# EXPLICITNESS IS THE FEATURE, exactly as with T4's memory commands: only the imperative,
# self-scoped phrasings below become proposals without the model's help. Every pattern
# literally contains "me"/"my", so "set Angelo to DND" cannot match — and even a matched
# phrasing only ever creates a proposal that still requires the explicit Confirm click.
# Natural phrasings ("I'm heading out for lunch, update my status") are the AI tail's job,
# and land in the very same validator + pending gate.

_STATUS_TOKEN = r"(?P<status>do not disturb|do-not-disturb|on a break|on break|on lunch|available|free|busy|break|lunch|dnd)"
_DURATION_TOKEN = r"(?:\s+for\s+(?:(?P<minutes>\d{1,3})\s*(?:min|mins|minute|minutes)|(?P<hours>\d)\s*(?:hr|hrs|hour|hours)))?"

_SET_STATUS_PATTERNS = [
    re.compile(
        r"^(?:please\s+)?(?:set|change|switch|update)\s+(?:me|my\s+status)\s+(?:to|as)\s+"
        + _STATUS_TOKEN
        + _DURATION_TOKEN
        + r"$",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?:please\s+)?put\s+me\s+(?:on|to)\s+" + _STATUS_TOKEN + _DURATION_TOKEN + r"$",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?:please\s+)?mark\s+me\s+(?:as\s+)?" + _STATUS_TOKEN + _DURATION_TOKEN + r"$",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?:please\s+)?set\s+my\s+status\s+" + _STATUS_TOKEN + _DURATION_TOKEN + r"$",
        re.IGNORECASE,
    ),
]


def _normalize(question: str) -> str:
    # Trailing sentence punctuation only — the words themselves are the match surface.
    return re.sub(r"[.!?\s]+$", "", question.strip())


# --- deterministic send-message parsing -------------------------------------------------------
# Imperative, recipient-first phrasings only: "message Micah that I'll be back at 3", "tell Alex
# I'm running late", "send a message to Micah: on my way", "let Micah know I'm late". The
# recipient is captured as typed and resolved by the router; the text is captured verbatim.
# Words that can never be a recipient keep "tell me who is online" flowing to the assistant.

_NOT_A_RECIPIENT = frozenset(
    {"me", "us", "them", "him", "her", "you", "it", "everyone", "everybody", "all", "someone",
     "somebody", "anyone", "the", "a", "an", "my", "your", "our", "this", "that", "what", "who"}
)
_PERSON_TOKEN = r"(?P<person>[^\s,:]+(?:\s+[^\s,:]+){0,2}?)"
_SEND_VERB = r"(?:(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:send\s+(?:a\s+)?(?:message|dm|note)\s+to|message|dm|text|tell|ping))"

_SEND_MESSAGE_PATTERNS = [
    # With an explicit connector ("that", "saying", ":" or ",") — multi-word names allowed.
    re.compile(
        r"^" + _SEND_VERB + r"\s+" + _PERSON_TOKEN + r"(?:\s+that\s+|\s+saying\s+|\s*:\s*|\s*,\s*)(?P<text>.+)$",
        re.IGNORECASE,
    ),
    # "let <person> know (that) <text>"
    re.compile(
        r"^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?let\s+" + _PERSON_TOKEN + r"\s+know\s+(?:that\s+)?(?P<text>.+)$",
        re.IGNORECASE,
    ),
    # No connector — a single-word recipient only, so the text cannot swallow part of a name.
    re.compile(r"^" + _SEND_VERB + r"\s+(?P<person>[^\s,:]+)\s+(?P<text>.+)$", re.IGNORECASE),
]


def _clean_outgoing(raw: str) -> str:
    text = raw.strip()
    if len(text) >= 2 and text[0] in "\"'\u201c\u2018" and text[-1] in "\"'\u201d\u2019":
        text = text[1:-1].strip()
    return text


def parse_send_message_request(question: str) -> SendMessageRequest | None:
    """Deterministic send-message phrasings → an UNRESOLVED request, or None. Never resolves a
    person and never produces a proposal on its own."""
    text = question.strip()
    if not text:
        return None
    for pattern in _SEND_MESSAGE_PATTERNS:
        match = pattern.match(text)
        if not match:
            continue
        person = match.group("person").strip()
        first_word = person.split()[0].lower() if person else ""
        if not person or first_word in _NOT_A_RECIPIENT or person.lower() in _NOT_A_RECIPIENT:
            return None
        body = _clean_outgoing(match.group("text"))
        if not body or len(body) > MAX_MESSAGE_CHARS or len(person) > MAX_RECIPIENT_CHARS:
            return None
        return SendMessageRequest(recipient=person, text=body)
    return None


def parse_action_request(question: str) -> SetStatusAction | SendMessageRequest | None:
    """The deterministic action parser: is this message one of the explicit set-my-status
    phrasings, or an explicit send-a-message-to-someone phrasing? Anything else returns None and
    flows on to the ordinary assistant untouched — a drafting request ("write a message saying
    I'm busy") matches nothing here by design."""
    text = _normalize(question)
    for pattern in _SET_STATUS_PATTERNS:
        match = pattern.match(text)
        if not match:
            continue
        status = resolve_status(match.group("status"))
        if status is None:
            return None
        minutes: int | None = None
        raw_minutes = match.groupdict().get("minutes")
        raw_hours = match.groupdict().get("hours")
        if raw_minutes:
            minutes = int(raw_minutes)
        elif raw_hours:
            minutes = int(raw_hours) * 60
        return _finish(status, minutes)
    return parse_send_message_request(question)


# --- AI proposal validation --------------------------------------------------------------------

_ALLOWED_AI_ARGS = {"status", "dnd_minutes"}
_ALLOWED_SEND_AI_ARGS = {"recipient", "text"}


def _validate_send_proposal(args: dict) -> SendMessageRequest | None:
    if set(args) - _ALLOWED_SEND_AI_ARGS:
        return None
    recipient = args.get("recipient")
    body = args.get("text")
    if not isinstance(recipient, str) or not isinstance(body, str):
        return None
    recipient = recipient.strip()
    body = _clean_outgoing(body)
    if not recipient or not body:
        return None
    if len(recipient) > MAX_RECIPIENT_CHARS or len(body) > MAX_MESSAGE_CHARS:
        return None
    return SendMessageRequest(recipient=recipient, text=body)


def validate_ai_proposal(name: object, args: object) -> SetStatusAction | SendMessageRequest | None:
    """The one door a model-emitted proposal can pass through. Treats every input as untrusted:
    unknown action name, non-dict args, extra keys, unknown status, junk minutes — each returns
    None, which the router treats as 'no action proposed', never as an executable anything.
    A send_message proposal comes back UNRESOLVED (a SendMessageRequest): the model names a
    recipient, it never picks an email, and the router still has to resolve it uniquely."""
    if not isinstance(args, dict):
        return None
    if name == ACTION_SEND_MESSAGE:
        return _validate_send_proposal(args)
    if name != ACTION_SET_STATUS:
        return None
    if set(args) - _ALLOWED_AI_ARGS:
        # Extras forbidden — a smuggled owner_email/target/endpoint kills the whole proposal.
        return None
    status_raw = args.get("status")
    if not isinstance(status_raw, str):
        return None
    status = resolve_status(status_raw)
    if status is None:
        return None
    minutes: int | None = None
    minutes_raw = args.get("dnd_minutes")
    if minutes_raw is not None:
        # bool is an int subclass; reject it explicitly rather than treating True as 1 minute.
        if isinstance(minutes_raw, bool) or not isinstance(minutes_raw, int):
            return None
        minutes = minutes_raw
    return _finish(status, minutes)


# --- wording -----------------------------------------------------------------------------------


def _status_phrase(action: SetStatusAction) -> str:
    label = _STATUS_LABELS[action.status]
    if action.status == "DND" and action.dnd_minutes is not None:
        return f"{label} for {action.dnd_minutes} minutes"
    return label


def proposal_summary(action: ToucanAction) -> str:
    """The exact effect, stated before execution — what the confirmation card shows."""
    if isinstance(action, SendMessageAction):
        return f"Send message to {action.recipient_label}"
    return f"Set your status to {_status_phrase(action)}"


def confirmation_text(action: ToucanAction) -> str:
    """The transcript line accompanying a proposal. Server-worded from the VALIDATED action —
    never the model's own phrasing — so what the user confirms is what will happen."""
    if isinstance(action, SendMessageAction):
        return (
            f"I can send this to {action.recipient_label}: \u201c{action.text}\u201d "
            "Nothing has been sent yet — confirm below and I'll send it."
        )
    return (
        f"I can set your status to {_status_phrase(action)}. "
        "Nothing has changed yet — confirm below and I'll do it."
    )


def executed_text(action: ToucanAction) -> str:
    if isinstance(action, SendMessageAction):
        return f"Done — I sent your message to {action.recipient_label}."
    return f"Done — your status is now {_status_phrase(action)}."


def cancelled_text(action: ToucanAction) -> str:
    if isinstance(action, SendMessageAction):
        return "Okay, cancelled — I haven't sent anything."
    return "Okay, cancelled — I haven't changed your status."


def self_recipient_text() -> str:
    return "That's you — I can only send messages to other people in the office."


# What confirm/cancel says about an id that is unknown, expired, already used, or somebody
# else's. ONE message for all four on purpose — a pending id can no more be probed for
# existence than a conversation id can.
ACTION_UNAVAILABLE_DETAIL = "Action request not found or no longer available"
