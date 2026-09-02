from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

# T4 — DETERMINISTIC MEMORY COMMANDS: parsing and wording, and nothing else.
#
# This module lives in the storage-free package (see tests/test_toucan_privacy.py), so it can
# see no database, no session and no model. It answers exactly two questions for the router:
# "is this message an explicit memory command?" and "how do I word the result?" — the router
# does the persistence in between, through repositories/toucan_memory.py, mirroring how the T2
# activity intents split predicate/wording here and storage there.
#
# EXPLICITNESS IS THE FEATURE. Only the phrasings below are commands; everything else falls
# through to the ordinary assistant untouched, which is what keeps "ordinary messages never
# become memories" true by construction rather than by filtering.
#
# Parsing runs against the RAW question, case-insensitively, so the saved content keeps the
# user's own casing and punctuation — unlike the live-office intents, which normalise first,
# because there the words are discarded and here they ARE the payload.

CommandAction = Literal["remember", "list", "forget"]

# Mirrors repositories/toucan_memory.py's MAX_MEMORY_CONTENT_CHARS; restated here because this
# module may not import the repository. The repository clamp remains the authority.
MEMORY_CONTENT_CHARS = 1000

# Supported intent ids for the ask response — the memory counterparts of SUPPORTED_INTENTS in
# office_assistant.py, kept separate because these are resolved by the router (they need a
# database) rather than by answer_question (which must not have one).
MEMORY_INTENTS = ("memory_save", "memory_list", "memory_forget")


@dataclass(frozen=True)
class MemoryCommand:
    action: CommandAction
    # The user's words for remember/forget, verbatim (trimmed, trailing sentence punctuation
    # dropped). Empty for "list", and for a bare "remember" with nothing after it.
    content: str
    # "fact" for remember-phrasings, "note" for save-a-note phrasings. Meaningless for
    # list/forget.
    kind: Literal["fact", "note"]


@dataclass(frozen=True)
class MemoryView:
    """The value shape the wording functions accept — the router builds these from repository
    dicts, so no ORM object ever crosses into this package."""

    kind: str
    content: str


# --- parsing ---------------------------------------------------------------------------------

# List phrasings are matched on a lightly-normalised copy (lowercased, punctuation-stripped) —
# they carry no payload, so normalising loses nothing and buys tolerance of "What do you
# remember?".
_LIST_PATTERNS = [
    re.compile(r"^what do you remember(?: about me)?$"),
    re.compile(r"^what (?:have|did) i ask(?:ed)? you to remember$"),
    re.compile(r"^(?:list|show)(?: me)?(?: my)? (?:memories|saved notes|notes)$"),
    re.compile(r"^what are my (?:memories|saved notes)$"),
    re.compile(r"^what did you remember$"),
]

# Payload-carrying commands: matched case-insensitively against the raw text, capturing the raw
# content. Note-flavoured save comes FIRST so "save this note: ..." is classified as a note
# rather than falling into the broader remember form.
_NOTE_PATTERNS = [
    re.compile(r"^\s*save (?:this |a )?note[:,]?\s+(?P<content>.+)$", re.IGNORECASE),
    re.compile(r"^\s*note to self[:,]?\s+(?P<content>.+)$", re.IGNORECASE),
]

_REMEMBER_PATTERNS = [
    re.compile(r"^\s*remember[:,]?\s+(?:that\s+|this[:,]?\s+)?(?P<content>.+)$", re.IGNORECASE),
]

_FORGET_PATTERNS = [
    re.compile(r"^\s*forget[:,]?\s+(?:that\s+|this[:,]?\s+|about\s+)?(?P<content>.+)$", re.IGNORECASE),
]

# A remember/forget with nothing after the verb — still a command, so it must not fall through
# to the office assistant and be answered with the generic fallback; the user gets told the
# shape instead.
_BARE_REMEMBER = re.compile(r"^\s*remember\s*[.!?]*\s*$", re.IGNORECASE)
_BARE_FORGET = re.compile(r"^\s*forget\s*[.!?]*\s*$", re.IGNORECASE)


def _normalize_for_list(raw: str) -> str:
    text = raw.strip().lower()
    text = text.replace("’", "").replace("'", "")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_content(raw: str) -> str:
    """Trim, drop trailing sentence punctuation, clamp. The words in between are untouched —
    they are the user's memory, not ours to rewrite."""
    return raw.strip().rstrip(".!").strip()[:MEMORY_CONTENT_CHARS]


def parse_memory_command(question: str) -> MemoryCommand | None:
    """None means "not a memory command" — the router carries on to the ordinary assistant.
    Pure and deterministic, like everything else in this package."""
    if not question or not question.strip():
        return None

    if any(p.match(_normalize_for_list(question)) for p in _LIST_PATTERNS):
        return MemoryCommand(action="list", content="", kind="fact")

    for pattern in _NOTE_PATTERNS:
        match = pattern.match(question)
        if match:
            return MemoryCommand(action="remember", content=_clean_content(match.group("content")), kind="note")

    if _BARE_FORGET.match(question):
        return MemoryCommand(action="forget", content="", kind="fact")
    for pattern in _FORGET_PATTERNS:
        match = pattern.match(question)
        if match:
            return MemoryCommand(action="forget", content=_clean_content(match.group("content")), kind="fact")

    if _BARE_REMEMBER.match(question):
        return MemoryCommand(action="remember", content="", kind="fact")
    for pattern in _REMEMBER_PATTERNS:
        match = pattern.match(question)
        if match:
            return MemoryCommand(action="remember", content=_clean_content(match.group("content")), kind="fact")

    return None


# --- wording ---------------------------------------------------------------------------------

EMPTY_REMEMBER_TEXT = (
    "What would you like me to remember? Try \"Remember that the demo is on Friday\" or "
    "\"Save this note: finish the design\"."
)

EMPTY_FORGET_TEXT = (
    "What should I forget? Try \"Forget that the demo is on Friday\" — I'll only forget an "
    "exact saved memory."
)

NO_MEMORIES_TEXT = "You haven't asked me to remember anything yet."

_BULLET = "• "


def saved_text(command: MemoryCommand) -> str:
    noun = "note" if command.kind == "note" else "that"
    if command.kind == "note":
        return f"Saved your note: “{command.content}”"
    return f"Okay, I'll remember {noun}: “{command.content}”"


def memories_text(memories: list[MemoryView]) -> str:
    """The bounded "What do you remember?" answer, newest first — one bullet per memory, the
    user's own words and nothing derived. Multi-line renders as written in the panel
    (white-space: pre-wrap), same as the T3 digest."""
    if not memories:
        return NO_MEMORIES_TEXT
    bullets = "\n".join(f"{_BULLET}{m.content}" for m in memories)
    plural = "things" if len(memories) != 1 else "thing"
    return f"Here's what you've asked me to remember ({len(memories)} {plural}, newest first):\n{bullets}"


def forgotten_text(command: MemoryCommand, deleted_count: int) -> str:
    if deleted_count <= 0:
        return (
            f"I don't have a saved memory matching “{command.content}”. "
            "Ask \"What do you remember?\" to see what I've got."
        )
    return f"Okay, I've forgotten: “{command.content}”"
