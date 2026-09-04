from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any, Protocol

from app.services.toucan.delegation import assisting_prefix, display_name_from_email

# A2.4 — GROUNDED DELEGATED ANSWERS: the deterministic walls around the one provider call.
# Pure module, storage-free like the rest of this package: it classifies the incoming question,
# projects an ALREADY-SELECTED same-conversation window into the provider payload, and validates
# what comes back. It never reads anything itself; services/chat_delegation.py hands it rows it
# has already authorised (membership re-verified, bounded SQL read of that one conversation).
#
# THE RULE: Toucan may repeat what the delegated OWNER already said in THIS conversation, and
# nothing else. Retrieval, never judgment. Every wall below fails closed to the deterministic
# acknowledgement the caller already has.

MAX_QUESTION_CHARS = 300
MAX_ANSWER_CHARS = 400

# Questions that are plainly asking the owner to DECIDE, PROMISE, APPROVE, ESTIMATE or OPINE —
# or that touch private/sensitive ground. Any hit refuses the grounded path before any read.
_UNSAFE = re.compile(
    r"\b(?:can|could|may|might|should|shall|will|would)\s+(?:we|you|u|i|they|he|she|it|someone|anyone|somebody)\b"
    r"|\b(?:approv\w*|permission|permitted|allowed|authoriz\w*|sign[- ]?off|green ?light|go[- ]ahead|ok(?:ay)?\s+(?:to|if|with))\b"
    r"|\b(?:commit\w*|promise\w*|guarantee\w*|estimate\w*|eta\b|how long|how soon|by when)\b"
    r"|\b(?:move|extend|postpone|push|change|shift|delay|bring forward)\b"
    r"|\b(?:opinion|think|thoughts|feel|prefer\w*|rather|recommend\w*|suggest\w*|better|best|worth)\b"
    r"|\b(?:decid\w*|decision|accept\w*|agree\w*|take (?:this|that|it|the) (?:on|over)|own\w* (?:this|that|it|the))\b"
    r"|\b(?:salary|raise|bonus|payroll|leave|vacation|sick|hr\b|performance|review|budget|invoice|payment|pay\b|"
    r"contract|legal|lawyer|password|credential\w*|token|secret|access to|permission to|urgent\w*|asap)\b",
    re.IGNORECASE,
)

# What a simple retrieval question looks like: an interrogative opener and a question mark, or
# "did/has <someone> say/mention/share …?". Nothing else even reaches the provider.
_RETRIEVAL = re.compile(
    r"^(?:where|what|which|when|who|whom)\b.*\?$"
    r"|^(?:did|has|have)\s+\S+(?:\s+\S+)?\s+(?:say|said|mention\w*|share\w*|send|sent|post\w*|put|upload\w*|tell)\b.*\?$",
    re.IGNORECASE | re.DOTALL,
)

_MENTION = re.compile(r"(?<![\w.@-])@[\w.\-]+")
_FIRST_PERSON = re.compile(r"^(?:i|i'm|i’m|i'll|i’ll|i've|i’ve|we|we'll|we’ll|my|our)\b", re.IGNORECASE)


def strip_mentions(text: str) -> str:
    return " ".join(_MENTION.sub(" ", text or "").split())


def is_retrieval_question(text: str) -> bool:
    """True only for a short, plainly interrogative, plainly retrieval-shaped question with no
    decision/commitment/opinion/sensitive marker anywhere in it."""
    question = strip_mentions(text).strip()
    if not question or len(question) > MAX_QUESTION_CHARS:
        return False
    if _UNSAFE.search(question):
        return False
    return _RETRIEVAL.match(question) is not None


class _Row(Protocol):
    id: str
    sender_email: str
    text: str
    sent_at: Any


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: max(limit - 1, 1)].rstrip() + "…"


def build_evidence_window(
    rows: Iterable[_Row],
    *,
    owner_email: str,
    incoming_id: str | None,
    exclude_sender: str,
    max_messages: int,
    max_message_chars: int,
    max_total_chars: int,
) -> list[dict[str, object]]:
    """Project the caller's bounded read of ONE conversation into the provider payload:
    [{"id", "author", "fromOwner", "text"}], oldest → newest. Drops the incoming question (it is
    passed separately), Toucan's own earlier replies, and empty texts; keeps at most
    `max_messages`, clips each text, and drops the OLDEST entries until the total fits."""
    owner = owner_email.strip().lower()
    skip = exclude_sender.strip().lower()
    ordered = sorted(rows, key=lambda m: (m.sent_at, m.id))
    kept = [
        m for m in ordered
        if m.id != incoming_id and m.sender_email.strip().lower() != skip and (m.text or "").strip()
    ][-max_messages:]
    window: list[dict[str, object]] = [
        {
            "id": m.id,
            "author": display_name_from_email(m.sender_email),
            "fromOwner": m.sender_email.strip().lower() == owner,
            "text": _clip(m.text, max_message_chars),
        }
        for m in kept
    ]
    total = sum(len(str(t["text"])) for t in window)
    while window and total > max_total_chars:
        total -= len(str(window[0]["text"]))
        window.pop(0)
    return window


def has_owner_evidence(window: list[dict[str, object]]) -> bool:
    return any(t.get("fromOwner") for t in window)


def validate_grounded_answer(
    result: object, window: list[dict[str, object]], owner_email: str
) -> str | None:
    """The provider's structured output, or None (→ deterministic fallback). Accepts only:
    canAnswer true; a non-empty answer within bounds, not in the first person, with no
    decision/commitment marker; a non-empty evidence list whose EVERY id is inside the supplied
    window and at least one of which the owner wrote."""
    if not isinstance(result, dict) or result.get("canAnswer") is not True:
        return None
    answer = result.get("answer")
    if not isinstance(answer, str):
        return None
    answer = " ".join(answer.split())
    prefix = assisting_prefix(owner_email)
    if answer.lower().startswith(prefix.lower()):
        answer = answer[len(prefix):].strip()
    if not answer or len(answer) > MAX_ANSWER_CHARS or _FIRST_PERSON.match(answer) or _UNSAFE.search(answer):
        return None
    ids = result.get("evidenceMessageIds")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        return None
    by_id = {str(t["id"]): t for t in window}
    if any(i not in by_id for i in ids):
        return None
    if not any(by_id[i].get("fromOwner") for i in ids):
        return None
    return answer


def grounded_reply_text(owner_email: str, answer: str) -> str:
    return f"{assisting_prefix(owner_email)} {answer}"
