from __future__ import annotations

import pytest

from app.config import settings
from app.services.toucan.memory_retrieval import select_relevant_memories

# T7 — the pure relevance pass, exercised directly. Everything here is deterministic: no
# database, no network, no provider. The endpoint-level behaviour (owner scoping, the fenced
# prompt block, bounds through configuration) is proved in tests/test_toucan_ai.py; this file
# pins the algorithm itself so a wording tweak cannot silently change what gets retrieved.

FAVORITE = {"kind": "fact", "content": "My favorite office room is the Central Hub"}
DEMO = {"kind": "fact", "content": "The demo deadline moved to Friday"}
WIFI = {"kind": "note", "content": "Guest wifi code changed this week"}


def _contents(selected: list[dict[str, str]]) -> list[str]:
    return [m["content"] for m in selected]


def test_the_exact_target_example_is_selected():
    selected = select_relevant_memories(
        "What's my favorite office room?", [FAVORITE, DEMO, WIFI]
    )
    assert _contents(selected) == [FAVORITE["content"]]


@pytest.mark.parametrize(
    "question",
    [
        "Which office room do I like most?",
        "Do you remember my favorite room?",
        "what is my favourite room",  # missing "office", different casing — overlap still wins
    ],
)
def test_reasonable_paraphrases_still_select_it(question):
    selected = select_relevant_memories(question, [FAVORITE, DEMO, WIFI])
    assert _contents(selected) == [FAVORITE["content"]]


def test_unrelated_questions_select_nothing():
    for question in ("Explain React in one paragraph.", "Write a professional reply"):
        assert select_relevant_memories(question, [FAVORITE, DEMO, WIFI]) == []


def test_empty_inputs_are_ordinary():
    assert select_relevant_memories("", [FAVORITE]) == []
    assert select_relevant_memories("   ", [FAVORITE]) == []
    assert select_relevant_memories("who are you", [FAVORITE]) == []  # scaffolding-only question
    assert select_relevant_memories("What's my favorite office room?", []) == []


def test_projection_is_exactly_kind_and_content():
    """Repository rows carry id/owner/timestamps; the projection must shed everything but the
    two allowed fields — this is the shape the provider prompt receives verbatim."""
    row = {
        "id": "abc-123",
        "kind": "fact",
        "content": FAVORITE["content"],
        "created_at": "2026-09-01T00:00:00",
        "updated_at": "2026-09-01T00:00:00",
    }
    selected = select_relevant_memories("What's my favorite office room?", [row])
    assert selected == [{"kind": "fact", "content": FAVORITE["content"]}]


def test_count_and_content_bounds_come_from_configuration(monkeypatch):
    monkeypatch.setattr(settings, "TOUCAN_AI_MAX_MEMORIES", 2)
    monkeypatch.setattr(settings, "TOUCAN_AI_MAX_MEMORY_CHARS", 25)
    rows = [
        {"kind": "fact", "content": f"my favorite office room fact number {i} with a long tail"}
        for i in range(6)
    ]
    selected = select_relevant_memories("What's my favorite office room?", rows)
    assert len(selected) == 2
    assert all(len(m["content"]) <= 25 for m in selected)


def test_a_clear_front_runner_evicts_one_word_stragglers():
    """Relative threshold: a memory sharing a single common word must not ride along with a
    strong match — one shared word is noise once a real answer exists."""
    straggler = {"kind": "fact", "content": "The meeting room projector is broken"}
    selected = select_relevant_memories(
        "What's my favorite office room?", [straggler, FAVORITE]
    )
    assert _contents(selected) == [FAVORITE["content"]]


def test_a_weak_match_alone_is_still_offered():
    """With no stronger candidate, a single shared subject word is a legitimate weak signal —
    the prompt's honesty rules keep the model from upgrading it into a definite fact."""
    straggler = {"kind": "fact", "content": "The meeting room projector is broken"}
    selected = select_relevant_memories("What's my favorite office room?", [straggler])
    assert _contents(selected) == [straggler["content"]]


def test_ties_keep_the_given_newest_first_order():
    newer = {"kind": "fact", "content": "my favorite office snack is stroopwafels"}
    older = {"kind": "fact", "content": "my favorite office playlist is lo-fi"}
    selected = select_relevant_memories("what is my favorite office thing", [newer, older])
    assert _contents(selected) == [newer["content"], older["content"]]


def test_kind_survives_projection():
    note = {"kind": "note", "content": "finish the office room design"}
    selected = select_relevant_memories("what did I note about the office room?", [note])
    assert selected == [note]
