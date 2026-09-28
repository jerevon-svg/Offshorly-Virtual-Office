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
    """Deterministic, network-free stand-in that proves the pipeline. Same input → same drafts. It recognises
    explicit markers a test or developer types ("decision: …", "commit: …", "open: …") and marks each
    draft with low confidence and an uncertainty note, because it understands nothing."""

    id = "fake-v1"

    _MARKERS = (("decision:", ITEM_DECISION), ("commit:", ITEM_COMMITMENT), ("open:", ITEM_OPEN_LOOP))

    async def generate(self, source: GenerationInput) -> list[ItemDraft]:
        segs = source.segments
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
                    confidence=0.1,
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
                        # Who SAID it, not who owns it — ownership is for a human to confirm.
                        content["speakerEmail"] = s.speaker_email
                    drafts.append(
                        ItemDraft(
                            item_type=item_type,
                            content=content,
                            evidence_segment_ids=(s.segment_id,),
                            confidence=0.2,
                            uncertainty="Development generator: matched a typed marker.",
                        )
                    )
        return drafts


_fake = FakeGenerator()


def resolve() -> IntelligenceGenerator:
    """The generator this process uses. Development only in Phase 7A — outside it there is none, so no
    request can produce placeholder "intelligence" on a real meeting."""
    if not settings.is_development:
        raise GeneratorUnavailable()
    return _fake
