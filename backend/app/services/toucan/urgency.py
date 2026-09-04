from __future__ import annotations

import re

from app.services.toucan.delegation import (
    assisting_label,
    assisting_prefix,
    display_name_from_email,
    sorted_owners,
)

# A3 — URGENCY, REQUESTER-DECLARED AND DETERMINISTIC. Pure module, storage-free like the rest of
# this package: it classifies ONE incoming reply and words ONE confirmation. It never decides
# whether a question was asked (that is the reply gate's memory, in services/chat_delegation.py)
# and never touches a row (repositories/toucan_urgency.py owns the durable flag).
#
# THE PRODUCT RULES THIS MODULE ENCODES STRUCTURALLY:
#
#   * DECLARED, NOT INFERRED. Toucan flags a message as urgent only when the requester SAYS so:
#     an explicit marker ("urgent", "asap", "emergency") anywhere in their message, or a bare
#     affirmative ("yes", "yes please") that the caller has established is an answer to Toucan's
#     own "Is this urgent?". Tone, length, capital letters and exclamation marks mean nothing.
#   * NEGATIVE MEANS NOTHING HAPPENS. "not urgent", "no rush", a bare "no": no flag, ever. A
#     negation anywhere near the marker wins over the marker.
#   * ONE CONFIRMATION, NO PROMISES. The reply below says the message is flagged and that the
#     owner will see it on return. No return time, no reason, no escalation to anybody else.

URGENCY_EXPLICIT = "explicit"
URGENCY_AFFIRMATIVE = "affirmative"
URGENCY_NEGATIVE = "negative"

MAX_REPLY_CHARS = 400

_MARKER = re.compile(
    r"\b(?:urgent(?:ly)?|urgency|asap|emergenc(?:y|ies)|time[- ]sensitive|top priority)\b",
    re.IGNORECASE,
)

# A negation within a few words BEFORE the marker, or one of the stock "no hurry" idioms.
_NEGATED_MARKER = re.compile(
    r"\b(?:not|isn['’]?t|isnt|no|never|nothing|non|hardly|barely)(?:\s+\w+){0,3}?[\s-]+"
    r"(?:urgent(?:ly)?|urgency|asap|emergenc(?:y|ies)|time[- ]sensitive|top priority)\b"
    r"|\bnon-?urgent\b|\bno (?:rush|hurry)\b|\bnot (?:an? )?(?:big )?(?:deal|problem)\b"
    r"|\bwhenever (?:you|they) (?:can|get)\b|\bcan wait\b|\bno need to (?:rush|hurry)\b",
    re.IGNORECASE,
)

_BARE_AFFIRMATIVE = re.compile(
    r"^(?:yes|yes[,!]?\s*(?:please|it\s+is|indeed|very|definitely|absolutely)|yep|yeah|yup|"
    r"ye[sa]h?\s*please|it\s+is|it['’]s\s+(?:urgent|important)|definitely|absolutely|indeed|"
    r"affirmative|correct|very(?:\s+much)?|please|i(?:['’]m|\s+am)\s+afraid\s+so)$",
    re.IGNORECASE,
)

_BARE_NEGATIVE = re.compile(
    r"^(?:no|nope|nah|no[,!]?\s*(?:thanks|thank\s+you|it['’]s\s+(?:fine|ok(?:ay)?)|not\s+really|"
    r"no\s+rush|no\s+hurry|no\s+worries)|not\s+really|it['’]s\s+(?:fine|ok(?:ay)?)|no\s+worries|"
    r"no\s+rush|no\s+hurry|nothing\s+urgent|it\s+can\s+wait|never\s+mind|nevermind)$",
    re.IGNORECASE,
)

_MENTION = re.compile(r"(?<![\w.@-])@[\w.\-]+")


def _normalize(text: str) -> str:
    stripped = _MENTION.sub(" ", text or "")
    return re.sub(r"[\s.!?,]+$", "", " ".join(stripped.split()))


def classify_urgency_reply(text: str | None) -> str | None:
    """What one incoming message SAYS about urgency, and nothing about whether it matters yet.

    * URGENCY_NEGATIVE    — a negated marker, a "no hurry" idiom, or a bare "no"-shaped reply.
                            The caller creates nothing for these.
    * URGENCY_EXPLICIT    — an un-negated marker anywhere in the message. Flags whenever the
                            message was addressed to a delegated owner at all.
    * URGENCY_AFFIRMATIVE — a bare "yes"-shaped reply. Only means anything when the caller can
                            show Toucan's own "Is this urgent?" is outstanding in that conversation.
    * None                — everything else: an ordinary message."""
    body = _normalize(text or "")
    if not body:
        return None
    if _NEGATED_MARKER.search(body) or _BARE_NEGATIVE.match(body):
        return URGENCY_NEGATIVE
    if _MARKER.search(body):
        return URGENCY_EXPLICIT
    if _BARE_AFFIRMATIVE.match(body):
        return URGENCY_AFFIRMATIVE
    return None


# --- wording -----------------------------------------------------------------------------------


def urgent_flagged_reply_text(owner_emails: list[str]) -> str:
    """The ONE confirmation Toucan sends when it records a flag. Works both as the first reply in
    a conversation (the requester said "urgent" straight away) and as the answer to a "yes":
    states who is speaking, that the owner is unavailable, that the message is flagged, and that
    the owner will see it on return. Nothing about when, why, or anybody else."""
    owners = sorted_owners(owner_emails)
    if len(owners) == 1:
        name = display_name_from_email(owners[0])
        return (
            f"{assisting_prefix(owners[0])} Understood — I've flagged this as urgent for {name}. "
            "They'll see it as soon as they're back."
        )
    return (
        f"Toucan — assisting {assisting_label(owners)}: Understood — I've flagged this as urgent "
        "for them. They'll see it as soon as they're back."
    )
