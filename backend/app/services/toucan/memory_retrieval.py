from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from app.config import settings

# T7 — RELEVANT MEMORY RETRIEVAL: a pure, deterministic relevance pass, and nothing else.
#
# This module answers one question for the router: "of the caller's own saved memories, which
# few are actually about what they just asked?" — so that the AI provider can be handed a tiny,
# bounded, relevant projection instead of either nothing (T6) or everything (never).
#
# THE SHAPE OF THE PIPELINE, restated as who does what:
#   * the ROUTER fetches the candidate pool through repositories/toucan_memory.py's
#     list_memories — owner-filtered IN THE QUERY, newest first, repository-bounded — so a
#     cross-user row can never become a candidate here; this module never sees a session
#   * THIS MODULE scores those candidates against the question and returns at most
#     TOUCAN_AI_MAX_MEMORIES tiny projections of the winners: {"kind", "content"} and nothing
#     else — no id, no owner, no timestamps, no ORM object
#   * the PROVIDER renders that list into its prompt as fenced data, exactly as it renders the
#     office-context projection
#
# DELIBERATELY LEXICAL, NOT SEMANTIC. Scoring is normalised-token overlap: lowercase, strip
# punctuation, drop question scaffolding ("what", "do", "you", "remember", ...), fold trivial
# plurals, then count shared content words. That is enough for the facts and notes people
# actually save ("my favorite office room is the Central Hub" ∩ "what's my favorite office
# room?" = {favorite, office, room}) while an unrelated memory shares nothing and is excluded.
# No embeddings, no vector store, no extra model call to choose memories — retrieval costs zero
# tokens, and the ONE existing answer-generation request stays the only network call.
#
# This file lives in the swept package on purpose: the static privacy tests that forbid storage,
# provider SDKs and private-data field names in services/toucan/ apply here automatically.

# Words that carry the SHAPE of a question rather than its subject. Dropped from both sides
# before scoring so "Do you remember my favorite room?" and "my favorite room is X" meet on
# {favorite, room}. Kept deliberately generic — scaffolding and glue only, never domain words
# ("office", "room", "like" all score).
_STOPWORDS = frozenset(
    """
    a about again also am an and any anyone anything are as at be been being but by can could
    did do does doing done ever for from had has have having he her here hers him his how i if
    in is it its just know knew me might mine more most much must my no not of on one or our
    ours out own please recall remember remembered said say she should so some still tell than
    that the their theirs them then there these they thing things this those to told us very
    was we were what whats when where which who whom whose why will with without would you your
    yours
    """.split()
)

_WORD = re.compile(r"[a-z0-9]+")

# A memory must share at least this many content words with the question to be considered at
# all. One genuinely shared subject word ("room") is a legitimate — if weak — signal; the
# prompt's honesty rules own the job of keeping weak evidence qualified.
_MIN_SHARED_TOKENS = 1


def _fold(token: str) -> str:
    """Trivial plural fold so "rooms" meets "room". Nothing cleverer — a stemmer would buy
    ambiguity, not recall, at these content sizes."""
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _content_tokens(text: str) -> frozenset[str]:
    """The set of words that are ABOUT something: lowercased, alphanumeric runs only, minus the
    scaffolding vocabulary, plurals folded. Both the question and every candidate go through
    exactly this function, so the two sides can only ever meet on equal footing."""
    return frozenset(
        _fold(token)
        for token in _WORD.findall(text.lower())
        if len(token) >= 2 and token not in _STOPWORDS
    )


def select_relevant_memories(
    question: str, memories: Sequence[dict[str, Any]]
) -> list[dict[str, str]]:
    """The caller's own candidate memories, reduced to the few relevant ones, projected.

    `memories` is the repository's newest-first dict list (the caller's rows only — ownership
    was proved in the SQL that produced them). Returns at most TOUCAN_AI_MAX_MEMORIES entries of
    exactly {"kind", "content"}, content clamped to TOUCAN_AI_MAX_MEMORY_CHARS — the complete
    memory payload the AI provider is allowed to see, and treated there as data, never
    instructions.

    Ranking: shared-content-word count, ties broken by recency (the given order). A clear
    front-runner also evicts stragglers — anything scoring less than half the best match is
    noise riding on one common word, not a second relevant memory. An empty result is an
    ordinary outcome, not an error: general questions ("explain React") share nothing with
    saved facts and correctly retrieve nothing.
    """
    question_tokens = _content_tokens(question)
    if not question_tokens:
        return []

    scored: list[tuple[int, int, dict[str, Any]]] = []
    for index, memory in enumerate(memories):
        score = len(question_tokens & _content_tokens(str(memory.get("content", ""))))
        if score >= _MIN_SHARED_TOKENS:
            scored.append((score, index, memory))
    if not scored:
        return []

    best = max(score for score, _, _ in scored)
    kept = sorted(
        ((s, i, m) for s, i, m in scored if s * 2 >= best),
        key=lambda item: (-item[0], item[1]),
    )[: settings.TOUCAN_AI_MAX_MEMORIES]

    return [
        {
            "kind": str(memory.get("kind", "note")),
            "content": str(memory.get("content", ""))[: settings.TOUCAN_AI_MAX_MEMORY_CHARS],
        }
        for _, _, memory in kept
    ]
