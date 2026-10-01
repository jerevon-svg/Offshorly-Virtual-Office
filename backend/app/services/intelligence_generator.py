from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.config import settings
from app.models.meeting_intelligence import (
    ITEM_COMMITMENT,
    ITEM_DECISION,
    ITEM_KEY_POINT,
    ITEM_OPEN_LOOP,
    ITEM_SUMMARY,
    ITEM_TOPIC,
)

# PHASE 7A — THE GENERATION SEAM. Everything a Meeting Intelligence generator may see, and everything it may
# say back, is defined here; nothing else about the meeting reaches it.
#
# IN: an already-authorized Meeting Session's transcript — the current revision of each accepted segment,
# with its real id, speaker attribution, timing and revision. The generator gets no database handle, no
# email of the requester, no other meeting and no room: services/meeting_intelligence.py resolves access and
# assembles the input before calling it.
#
# OUT: item DRAFTS. A draft is a suggestion — it names its type, its content, the segment ids it rests on and
# how sure it is. The service validates every draft (type, shape, evidence belongs to THIS run's snapshot)
# and stores it as `suggested`; a generator can never mark anything confirmed, create a task, or touch any
# other business state.
#
# PROVIDERS plug in behind `IntelligenceGenerator`. A real one (an LLM adapter, later) replaces `resolve()`'s
# answer and nothing else: sessions, access, evidence and persistence stay as they are. In this phase the
# only generator is the deterministic, in-process FakeGenerator, and — like the dev transcript source — it
# is available only in development.
#
# PHASE 7B — MEETING UNDERSTANDING. What a generator must say back, per item type. A provider adapter maps
# its own response onto these drafts; nothing provider-shaped is ever persisted.
#
#   summary     {text}                                   — at most one; evidence optional
#   topic       {text}                                   — a concise subject actually discussed
#   decision    {text, rationale?}                       — something the meeting DECIDED, not a suggestion,
#                                                          a preference or an open debate
#   commitment  {text, action?, ownerEmail?, deadline?, rationale?}
#                                                        — someone actually accepting/promising an action
#                                                          ("I'll check it", "Yes, I'll handle it tomorrow").
#                                                          A request, "X could do it", and a hedge ("I can
#                                                          probably…", "I might…", "…if needed") are NOT
#                                                          commitments: the generator omits them rather than
#                                                          rating them lower. Always high confidence.
#   open_loop   {text, kind, rationale?}                 — still unresolved when the meeting ENDED (a question
#                                                          answered later in the transcript is not open)
#   key_point   {text}                                   — an important takeaway not already a decision,
#                                                          commitment or open loop
#
# All values are strings; `ownerEmail` and `deadline` may be null ("not established"). Unknown keys are
# refused. `ownerEmail` must be the persisted SPEAKER of one of the item's cited segments — the person who
# accepted, never someone named in the speech. `deadline` is the timeframe as said ("this afternoon"); it
# is stored only when the generator supplies it and is never parsed or inferred by the server.
#
# CONFIDENCE — two bands, not fake precision:
#   high   (>= CONFIDENCE_HIGH)  direct, explicit evidence ("Okay, let's launch Friday." / "Agreed.")
#   medium (>= CONFIDENCE_FLOOR) a reasonable reading of ambiguous wording (e.g. an open loop that may have
#                                been settled off-transcript) — never for a commitment, which is either
#                                established by the evidence (high) or omitted
# Below the floor the generator must OMIT the item. Every item but the summary carries a confidence;
# a medium item, and a commitment without an owner, must say what is uncertain.
CONFIDENCE_FLOOR = 0.5
CONFIDENCE_HIGH = 0.8

OPEN_LOOP_KINDS = frozenset(
    {"unanswered_question", "deferred_decision", "unresolved_issue", "unowned_action", "pending_dependency"}
)

#: per type: content keys a draft may carry → (max length, required, nullable)
CONTENT_FIELDS: dict[str, dict[str, tuple[int, bool, bool]]] = {
    ITEM_SUMMARY: {"text": (4000, True, False)},
    ITEM_TOPIC: {"text": (200, True, False)},
    ITEM_DECISION: {"text": (1000, True, False), "rationale": (1000, False, False)},
    ITEM_COMMITMENT: {
        "text": (1000, True, False),
        "action": (500, False, False),
        "ownerEmail": (255, False, True),
        "deadline": (200, False, True),
        "rationale": (1000, False, False),
    },
    ITEM_OPEN_LOOP: {"text": (1000, True, False), "kind": (32, True, False), "rationale": (1000, False, False)},
    ITEM_KEY_POINT: {"text": (1000, True, False)},
}

#: most items of each type one run may produce
TYPE_LIMITS = {
    ITEM_SUMMARY: 1,
    ITEM_TOPIC: 20,
    ITEM_KEY_POINT: 20,
    ITEM_DECISION: 50,
    ITEM_COMMITMENT: 50,
    ITEM_OPEN_LOOP: 50,
}


@dataclass(frozen=True)
class TranscriptEvidence:
    segment_id: str
    capture_id: str
    capture_started_at: datetime
    speaker_email: str
    speaker_name: str | None
    start_offset_ms: int
    end_offset_ms: int
    revision: int
    text: str
    confidence: float | None


@dataclass(frozen=True)
class GenerationInput:
    meeting_session_id: str
    #: transcript order (capture start, then offset)
    segments: tuple[TranscriptEvidence, ...]


@dataclass(frozen=True)
class ItemDraft:
    item_type: str
    content: dict
    evidence_segment_ids: tuple[str, ...] = ()
    confidence: float | None = None
    uncertainty: str | None = None


class IntelligenceGenerator(Protocol):
    #: stable id recorded on every run it produces ("fake-v1", later e.g. "llm-<provider>-<model>-v1")
    id: str

    async def generate(self, source: GenerationInput) -> list[ItemDraft]: ...


class GeneratorUnavailable(Exception):
    pass


class FakeGenerator:
    """Deterministic, network-free stand-in that proves the pipeline. Same input → same drafts. It
    understands nothing:
      * a transcript that is exactly one of the development fixtures (services/intelligence_fixtures.py)
        gets that fixture's hand-written understanding, bound to the real segment ids and speakers;
      * anything else gets a count-only summary, the first segment as a key point, and an item for each
        segment a developer typed with an explicit marker ("decision: …", "commit: …", "open: …").
    Marker items carry an uncertainty note, because no meaning was read; they are medium confidence except
    commitments, which the contract only allows at high."""

    id = "fake-v2"

    _MARKERS = (("decision:", ITEM_DECISION), ("commit:", ITEM_COMMITMENT), ("open:", ITEM_OPEN_LOOP))
    _DEV = "Development generator: matched a typed marker, not the meaning of the discussion."

    async def generate(self, source: GenerationInput) -> list[ItemDraft]:
        from app.services import intelligence_fixtures

        fixed = intelligence_fixtures.understand(source.segments)
        return fixed if fixed is not None else self._markers(source.segments)

    def _markers(self, segs: tuple[TranscriptEvidence, ...]) -> list[ItemDraft]:
        speakers = sorted({s.speaker_email for s in segs})
        drafts = [
            ItemDraft(
                item_type=ITEM_SUMMARY,
                content={"text": f"{len(segs)} transcript segment(s) from {len(speakers)} speaker(s)."},
                confidence=None,
                uncertainty="Development generator: counts only, no understanding of the discussion.",
            )
        ]
        if segs:
            drafts.append(
                ItemDraft(
                    item_type=ITEM_KEY_POINT,
                    content={"text": segs[0].text},
                    evidence_segment_ids=(segs[0].segment_id,),
                    confidence=CONFIDENCE_FLOOR,
                    uncertainty="Development generator: the first segment, not a real key point.",
                )
            )
        for s in segs:
            lowered = s.text.lower()
            for marker, item_type in self._MARKERS:
                if lowered.startswith(marker):
                    body = s.text[len(marker):].strip() or s.text
                    content = {"text": body}
                    if item_type == ITEM_COMMITMENT:
                        # The marker's speaker is the one committing — the persisted speaker, never a name.
                        content.update(action=body, ownerEmail=s.speaker_email)
                    elif item_type == ITEM_OPEN_LOOP:
                        content["kind"] = "unresolved_issue"
                    drafts.append(
                        ItemDraft(
                            item_type=item_type,
                            content=content,
                            evidence_segment_ids=(s.segment_id,),
                            # A typed "commit:" is an explicit declaration; a commitment is never medium.
                            confidence=CONFIDENCE_HIGH if item_type == ITEM_COMMITMENT else CONFIDENCE_FLOOR,
                            uncertainty=self._DEV,
                        )
                    )
        return drafts


_fake = FakeGenerator()


def resolve() -> IntelligenceGenerator:
    """The generator this process uses. Development only — outside it there is none, so no request can
    produce placeholder "intelligence" on a real meeting."""
    if not settings.is_development:
        raise GeneratorUnavailable()
    return _fake
