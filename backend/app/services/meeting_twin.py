from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_intelligence import REVIEW_REJECTED
from app.repositories import meeting_intelligence as intel_repo
from app.services import meeting_access, twin_generator
from app.services.intelligence_generator import GeneratorUnavailable, TranscriptEvidence
from app.services.meeting_intelligence import confidence_level, current_transcript, effective_content, fingerprint
from app.services.twin_generator import (
    INTEL_CURRENT,
    INTEL_NONE,
    INTEL_STALE,
    STATUS_GROUNDED,
    STATUSES,
    PriorTurn,
    TwinAnswerDraft,
    TwinGenerator,
    TwinInput,
    TwinInterpretation,
)

# PHASE 8B — MEETING TWIN: "ask this meeting". One question about ONE Meeting Session, answered only from what
# the caller may read of that session, with the transcript lines the answer rests on.
#
# ORDER IS THE RULE (services/meeting_access.py's header): the gate runs FIRST — before the question is even
# looked at — and an unauthorized or unknown session is `not_found`, exactly like every other session read.
# Only then is anything loaded, and only for `session.id`: its current transcript (the evidence foundation)
# and its latest succeeded intelligence as interpretations. No other session is queried; the room is never
# read; nothing is retrieved broadly and filtered afterwards.
#
# INTERPRETATIONS: rejected items are dropped; edited items carry the human wording (the Receipt's effective-
# content rule); confirmed / suggested keep their review state so an answer can say which it used. When the
# transcript changed since the run (stale), an item survives only if it cites lines and every one of them is
# still in the current transcript — the answer must stay supported by the CURRENT transcript. A session with
# no run at all still gets answers from its transcript. Nothing here regenerates intelligence.
#
# THE ANSWER is accepted whole or not at all: every citation must be a current transcript line of THIS session
# (checked against the supplied set and again in the database), every basis ref an interpretation that was
# supplied, a grounded answer must cite something. Anything else → `answer_rejected`; no partial trust.
#
# NOTHING IS STORED: no Twin conversation, no question, no answer. Prior turns come from the client as
# bounded referent context, are handed to the generator as such, and are never evidence. Logs carry codes
# only — never the question, the answer or transcript text.

_logger = logging.getLogger(__name__)

MAX_QUESTION = 500
MAX_PRIOR_TURNS = 3
MAX_HISTORY_SENT = 10
MAX_PRIOR_ANSWER = 1200
MAX_ANSWER = 1200
MAX_CITATIONS = 8
MAX_UNCERTAINTY = 500
TWIN_TIMEOUT_S = 30.0
RATE_LIMIT = 12
RATE_WINDOW_S = 60.0


class TwinError(Exception):
    """A refused question. `code` is a stable machine string; the router maps it to a status."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class _Rate:
    """Per-caller sliding window, in process — a brake on a runaway client, not a quota system."""

    def __init__(self, limit: int, window_s: float) -> None:
        self._limit, self._window = limit, window_s
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float) -> bool:
        hits = self._hits[key]
        while hits and now - hits[0] >= self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            return False
        hits.append(now)
        return True

    def reset(self) -> None:
        """Test-only."""
        self._hits.clear()


rate = _Rate(RATE_LIMIT, RATE_WINDOW_S)


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def _prior(history) -> tuple[PriorTurn, ...]:
    if len(history) > MAX_HISTORY_SENT:
        raise TwinError("invalid_question")
    turns = []
    for q, a in history[-MAX_PRIOR_TURNS:]:
        if not isinstance(q, str) or not isinstance(a, str):
            raise TwinError("invalid_question")
        turns.append(PriorTurn(question=q.strip()[:MAX_QUESTION], answer=a.strip()[:MAX_PRIOR_ANSWER]))
    return tuple(turns)


async def _interpretations(
    db: AsyncSession, session_id: str, segments: list[TranscriptEvidence]
) -> tuple[tuple[TwinInterpretation, ...], str]:
    latest = await intel_repo.latest_succeeded(db, session_id)
    if latest is None:
        return (), INTEL_NONE
    stale = fingerprint(segments) != latest.source_fingerprint
    current = {s.segment_id for s in segments}
    items = await intel_repo.items(db, latest.id)
    cited: dict[str, list[tuple[int, str]]] = {i.id: [] for i in items}
    for ev, seg in await intel_repo.evidence_with_segments(db, list(cited)):
        cited[ev.item_id].append((ev.position, seg.id))
    out = []
    for item in items:
        if item.review_state == REVIEW_REJECTED:
            continue
        ids = [sid for _, sid in sorted(cited[item.id])]
        if stale and (not ids or any(sid not in current for sid in ids)):
            continue
        out.append(
            TwinInterpretation(
                ref=item.id,
                item_type=item.item_type,
                content=dict(effective_content(item)),
                review_state=item.review_state,
                confidence_level=confidence_level(item.confidence),
                uncertainty=item.uncertainty,
                evidence_segment_ids=tuple(sid for sid in ids if sid in current),
                stale=stale,
            )
        )
    return tuple(out), INTEL_STALE if stale else INTEL_CURRENT


async def _accept(db: AsyncSession, source: TwinInput, draft) -> dict:
    if not isinstance(draft, TwinAnswerDraft) or draft.status not in STATUSES:
        raise TwinError("answer_rejected")
    text = draft.text.strip() if isinstance(draft.text, str) else ""
    if not text or len(text) > MAX_ANSWER:
        raise TwinError("answer_rejected")
    u = draft.uncertainty
    if u is not None and (not isinstance(u, str) or len(u) > MAX_UNCERTAINTY):
        raise TwinError("answer_rejected")
    order = {s.segment_id: n for n, s in enumerate(source.segments)}
    refs = {i.ref: i for i in source.interpretations}
    if not isinstance(draft.citations, (tuple, list)) or len(draft.citations) > MAX_CITATIONS:
        raise TwinError("answer_rejected")
    if not isinstance(draft.basis, (tuple, list)):
        raise TwinError("answer_rejected")
    cited = list(dict.fromkeys(draft.citations))
    if any(not isinstance(sid, str) or sid not in order for sid in cited):
        raise TwinError("answer_rejected")  # an invented, superseded or other-meeting line
    if any(not isinstance(r, str) or r not in refs for r in draft.basis):
        raise TwinError("answer_rejected")
    if draft.status == STATUS_GROUNDED and not cited:
        raise TwinError("answer_rejected")
    owners = await intel_repo.segment_session_ids(db, cited)
    if any(owners.get(sid) != source.meeting_session_id for sid in cited):  # defense in depth, from the database
        raise TwinError("answer_rejected")
    by_id = {s.segment_id: s for s in source.segments}
    return {
        "sessionId": source.meeting_session_id,
        "status": draft.status,
        "answer": text,
        "uncertainty": u.strip() if u and u.strip() else None,
        # Transcript order: the lines read as they were said.
        "evidence": [
            {
                "segmentId": sid,
                "speakerEmail": by_id[sid].speaker_email,
                "speakerName": by_id[sid].speaker_name,
                "startOffsetMs": by_id[sid].start_offset_ms,
                "endOffsetMs": by_id[sid].end_offset_ms,
                "text": by_id[sid].text,
            }
            for sid in sorted(cited, key=order.__getitem__)
        ],
        # The receipt interpretations the answer leaned on — a human's reading or a VO suggestion, never evidence.
        "basis": [
            {"type": refs[r].item_type, "reviewState": refs[r].review_state, "text": refs[r].content.get("text"),
             "stale": refs[r].stale}
            for r in dict.fromkeys(draft.basis)
        ],
        "intelligence": source.intelligence,
    }


async def ask(
    db: AsyncSession,
    session_id: str,
    email: str,
    *,
    question: str,
    history: list[tuple[str, str]] = (),
    generator: TwinGenerator | None = None,
    now: float | None = None,
) -> dict:
    email = _norm(email)
    session = await meeting_access.readable(db, session_id, email)  # THE GATE, before anything else
    if session is None:
        raise TwinError("not_found")
    q = question.strip() if isinstance(question, str) else ""
    if not q or len(q) > MAX_QUESTION:
        raise TwinError("invalid_question")
    prior = _prior(list(history))
    if session.ended_at is None:
        raise TwinError("meeting_active")
    try:
        gen = generator or twin_generator.resolve()
    except GeneratorUnavailable:
        raise TwinError("generator_unavailable") from None
    if not rate.allow(email, time.monotonic() if now is None else now):
        raise TwinError("rate_limited")

    segments = await current_transcript(db, session.id)
    if not segments:
        raise TwinError("no_transcript")
    interpretations, intelligence = await _interpretations(db, session.id, segments)
    source = TwinInput(
        meeting_session_id=session.id,
        asker_email=email,
        question=q,
        segments=tuple(segments),
        interpretations=interpretations,
        intelligence=intelligence,
        prior_turns=prior,
    )
    try:
        draft = await asyncio.wait_for(gen.answer(source), timeout=TWIN_TIMEOUT_S)
    except asyncio.TimeoutError:
        _logger.warning("meeting twin: generator %s timed out", getattr(gen, "id", "?"))
        raise TwinError("twin_failed") from None
    except Exception:  # noqa: BLE001 — any generator error is a refusal, never a 500 (and never logged with content)
        _logger.warning("meeting twin: generator %s failed", getattr(gen, "id", "?"))
        raise TwinError("twin_failed") from None
    try:
        return await _accept(db, source, draft)
    except TwinError:
        _logger.warning("meeting twin: rejected an answer from %s", getattr(gen, "id", "?"))
        raise
