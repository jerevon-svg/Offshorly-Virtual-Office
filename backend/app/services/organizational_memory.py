from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_capture import CaptureSession, TranscriptSegment
from app.models.meeting_intelligence import (
    ITEM_COMMITMENT,
    ITEM_DECISION,
    ITEM_OPEN_LOOP,
    ITEM_SUMMARY,
    ITEM_TYPES,
    REVIEW_REJECTED,
    REVIEW_SUGGESTED,
    RUN_SUCCEEDED,
    MeetingIntelligenceItem,
    MeetingIntelligenceRun,
)
from app.models.meeting_session import MeetingSession, MeetingSessionAttendance
from app.models.scheduled_meeting import ScheduledMeeting
from app.repositories import meeting_intelligence as intel_repo
from app.repositories import meeting_sessions as repo
from app.services import meeting_access
from app.services.intelligence_generator import TranscriptEvidence
from app.services.meeting_intelligence import confidence_level, current_transcript, effective_content, fingerprint
from app.services.meeting_memory import _effective_text_sql, _like
from app.services.meeting_receipt import _aware, _iso

# PHASE 9A — ORGANIZATIONAL MEMORY: "what relevant things have happened across the meetings I may remember?"
# A deterministic, provider-neutral RETRIEVAL layer over data VO already owns. No AI, no embeddings, nothing
# stored. Phase 9B's Organizational Twin will reason only over what this returns.
#
# "ORGANIZATIONAL" NAMES THE CAPABILITY, NOT A PERMISSION. Each employee's Organizational Memory is exactly
# the ended Meeting Sessions services/meeting_access lets them read — nothing more. Department, room, project
# or having organized some other meeting grants nothing; the room is a metadata filter only.
#
# ORDER OF OPERATIONS — authorization before content:
#   1. SCOPE. SQL runs only inside meeting_access.candidate_ids(caller) (the gate's own rules as a narrowing
#      query), plus the caller's filters and a loose token prefilter, newest first, at most MAX_SESSIONS;
#   2. THE GATE. meeting_access.readable per candidate — a refused one is dropped and never mentioned;
#   3. CONTENT, for approved ids only: titles, attendance, the latest succeeded run's items + evidence, and
#      the CURRENT transcript. Nothing is loaded broadly and hidden afterwards.
# So a hidden meeting with a perfect match leaves no result, count, rank gap, snippet, name or evidence.
# There is no total, no "more results" flag and no cursor: the response is a bounded top-N of approved rows.
#
# WHAT A RESULT MAY CLAIM. A structured result carries its item's OWN type — a decision is a decision only
# because the intelligence says so. Effective content (edited → the human's wording, and only that wording is
# searched); rejected items are not memory at all; suggested stays marked as a suggestion. A transcript
# result is `discussion` — something was said — and is never promoted to a decision, commitment or
# resolution. Transcript results are offered only for a meeting none of whose structured items matched.
#
# STALE. When the transcript changed since the run, its items are still returned but flagged `stale`, and a
# cited line no longer in the current transcript is not presented as evidence (`evidenceComplete` false).
# Every evidence line must be in the result's own session's current transcript AND owned by that session in
# the database — no cross-session evidence. Nothing is regenerated.
#
# RANKING — explainable integers (see _score): phrase > token coverage > structured type > human review >
# title/attendee context; stale costs a little; recency is only a tie-breaker, never a match signal.
#
# CONTENT IS DATA. Transcript and intelligence text is untrusted: it is matched and returned verbatim, never
# interpreted. The scope is decided by the caller's identity and filters alone — nothing in a query or in
# meeting text can widen it. 9B's input keeps instructions, the question and these memories apart
# (OrganizationalMemoryContext below), as 8B did.

MAX_QUERY = 200
MAX_TOKENS = 8
MAX_LIMIT = 25
DEFAULT_LIMIT = 10
MAX_SESSIONS = 100  # approved meetings considered per query, newest first among those that prefilter-match
MAX_PER_SESSION = 4
MAX_TRANSCRIPT_PER_SESSION = 2
MAX_EVIDENCE = 5
_TEXT_CHARS = 500
DISCUSSION = "discussion"
RESULT_TYPES = ITEM_TYPES | {DISCUSSION}
ATTENDANCE = frozenset({"all", "attended", "absent"})

_STOPWORDS = frozenset(
    "a an and are as at be by did do does for from has have how i in is it of on or our that the this to "
    "us was we were what when where which who why with you".split()
)
_TOKEN = re.compile(r"[0-9a-z]+(?:['@.\-_][0-9a-z]+)*")

# score weights — kept together so the ranking reads as one rule
W_PHRASE = 40
W_TOKEN = 10
W_ALL_TOKENS = 15
W_STRUCTURED = {ITEM_DECISION: 12, ITEM_COMMITMENT: 12, ITEM_OPEN_LOOP: 12}
W_OTHER_ITEM = 6
W_REVIEWED = 10
W_TITLE = 8
W_ATTENDEE = 4
W_STALE = -4


class OrgMemoryError(ValueError):
    """A malformed query — a stable code, never data."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ---- the provider-neutral contract (what 9B will receive) -------------------------------------------------


@dataclass(frozen=True)
class OrganizationalMemoryQuery:
    asker_email: str
    text: str  # whitespace-normalized, case-folded
    tokens: tuple[str, ...]
    types: frozenset[str]  # empty = every type
    attendance: str
    since: datetime | None
    until: datetime | None
    room_id: str | None  # metadata narrowing inside the authorized scope, never a grant
    limit: int
    # PHASE 9B — narrowing only: commitments must be owned by this (authenticated) email. See browse_query.
    owner_email: str | None = None


@dataclass(frozen=True)
class MemoryEvidence:
    segment_id: str
    speaker_email: str
    speaker_name: str | None
    start_offset_ms: int
    end_offset_ms: int
    text: str


@dataclass(frozen=True)
class MemoryMeeting:
    session_id: str
    title: str | None
    kind: str
    is_private: bool
    room_id: str | None
    started_at: datetime
    ended_at: datetime
    attended: bool  # False = authorized but absent (invited, organizer, granted)


@dataclass(frozen=True)
class AuthorizedMemoryResult:
    """One memory from a meeting the asker was approved for. `ref` is the only handle a generator may cite."""

    ref: str  # "item:<id>" | "segment:<id>"
    meeting: MemoryMeeting
    source: str  # "intelligence" | "transcript"
    item_type: str  # an ITEM_* type, or DISCUSSION for a transcript mention
    text: str
    details: dict  # decision: rationale; commitment: action/ownerEmail/deadline; open_loop: kind
    review_state: str | None  # None for transcript
    confidence_level: str | None
    uncertainty: str | None
    stale: bool
    evidence: tuple[MemoryEvidence, ...]  # current lines of meeting.session_id only
    evidence_complete: bool  # False when a cited line is no longer in the current transcript
    matched_on: tuple[str, ...]


@dataclass(frozen=True)
class OrganizationalMemoryContext:
    """9B's whole world: the question and ALREADY-AUTHORIZED memories, kept apart. There is no database handle
    and no way to name another session — a generator can only point at `refs` it was given."""

    asker_email: str
    question: str
    memories: tuple[AuthorizedMemoryResult, ...]

    @property
    def refs(self) -> frozenset[str]:
        return frozenset(m.ref for m in self.memories)

    @property
    def session_ids(self) -> frozenset[str]:
        return frozenset(m.meeting.session_id for m in self.memories)

    def resolve(self, refs) -> tuple[AuthorizedMemoryResult, ...] | None:
        """The memories a generator cited, or None if any ref was not supplied (reject the answer whole)."""
        by_ref = {m.ref: m for m in self.memories}
        cited = list(dict.fromkeys(refs))
        if any(not isinstance(r, str) or r not in by_ref for r in cited):
            return None
        return tuple(by_ref[r] for r in cited)


# ---- query normalization ----------------------------------------------------------------------------------


def _fold(text: str | None) -> str:
    return " ".join((text or "").split()).casefold()


def _tokens(text: str) -> tuple[str, ...]:
    # A query of only stopwords has nothing to search for — "we" would match every meeting.
    kept = [w for w in _TOKEN.findall(text) if len(w) >= 2 and w not in _STOPWORDS]
    return tuple(dict.fromkeys(kept))[:MAX_TOKENS]


def _when(value) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        at = value
    else:
        try:
            at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            raise OrgMemoryError("invalid_filter") from None
    return (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def parse_query(
    email: str,
    query,
    *,
    types=None,
    attendance: str = "all",
    since=None,
    until=None,
    room_id: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> OrganizationalMemoryQuery:
    text = _fold(query if isinstance(query, str) else "")
    if not text or len(text) > MAX_QUERY:
        raise OrgMemoryError("invalid_query")
    tokens = _tokens(text)
    if not tokens:
        raise OrgMemoryError("invalid_query")
    wanted = frozenset(types or ())
    if not wanted <= RESULT_TYPES or attendance not in ATTENDANCE:
        raise OrgMemoryError("invalid_filter")
    start, end = _when(since), _when(until)
    if start and end and start > end:
        raise OrgMemoryError("invalid_filter")
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        raise OrgMemoryError("invalid_filter") from None
    if not 1 <= limit <= MAX_LIMIT:
        raise OrgMemoryError("invalid_filter")
    return OrganizationalMemoryQuery(
        asker_email=repo.normalize_email(email or ""),
        text=text,
        tokens=tokens,
        types=wanted,
        attendance=attendance,
        since=start,
        until=end,
        room_id=(room_id or "").strip() or None,
        limit=limit,
    )


def browse_query(
    email: str, types, *, owner_email: str | None = None, limit: int = DEFAULT_LIMIT
) -> OrganizationalMemoryQuery:
    """PHASE 9B — a query with no search words: the newest structured items of `types` in the caller's scope
    ("What have we decided recently?", "What am I responsible for?"). Same scope, same gate, same content rules
    as a search; it only drops the word match. Structured types only — a transcript line needs a word to match,
    so a browse never returns `discussion`. Internal to the Organizational Twin; /memory/search still needs a
    searchable query."""
    wanted = frozenset(types or ())
    if not wanted or not wanted <= ITEM_TYPES or not 1 <= int(limit) <= MAX_LIMIT:
        raise OrgMemoryError("invalid_filter")
    return OrganizationalMemoryQuery(
        asker_email=repo.normalize_email(email or ""), text="", tokens=(), types=wanted, attendance="all",
        since=None, until=None, room_id=None, limit=int(limit),
        owner_email=repo.normalize_email(owner_email) if owner_email else None,
    )


# ---- 1. scope (inside candidate_ids only) + 2. the gate ---------------------------------------------------


def _prefilter(tokens: tuple[str, ...]):
    """A loose over-approximation — any token in the title, an attendee, an active latest-run item's effective
    text, or any transcript line. Correlated to MeetingSession and only evaluated inside the candidate set;
    the exact match is decided in Python over approved content."""
    latest = (
        select(func.max(MeetingIntelligenceRun.version))
        .where(
            MeetingIntelligenceRun.meeting_session_id == MeetingSession.id,
            MeetingIntelligenceRun.status == RUN_SUCCEEDED,
        )
        .correlate(MeetingSession)
        .scalar_subquery()
    )
    clauses = []
    for t in tokens:
        p = _like(t)
        clauses += [
            exists().where(
                ScheduledMeeting.id == MeetingSession.scheduled_meeting_id,
                func.lower(ScheduledMeeting.title).like(p, escape="\\"),
            ),
            exists().where(
                MeetingSessionAttendance.session_id == MeetingSession.id,
                func.lower(MeetingSessionAttendance.email).like(p, escape="\\"),
            ),
            exists().where(
                MeetingIntelligenceRun.meeting_session_id == MeetingSession.id,
                MeetingIntelligenceRun.status == RUN_SUCCEEDED,
                MeetingIntelligenceRun.version == latest,
                MeetingIntelligenceItem.run_id == MeetingIntelligenceRun.id,
                MeetingIntelligenceItem.review_state != REVIEW_REJECTED,
                func.lower(_effective_text_sql()).like(p, escape="\\"),
            ),
            exists().where(
                CaptureSession.meeting_session_id == MeetingSession.id,
                TranscriptSegment.capture_id == CaptureSession.id,
                func.lower(TranscriptSegment.text).like(p, escape="\\"),
            ),
        ]
    return or_(*clauses)


async def _authorized_scope(db: AsyncSession, q: OrganizationalMemoryQuery) -> list[MeetingSession]:
    candidates = meeting_access.candidate_ids(q.asker_email)
    stmt = select(MeetingSession.id).where(
        MeetingSession.id.in_(select(candidates.c.sid)), MeetingSession.ended_at.is_not(None)
    )
    if q.room_id:
        stmt = stmt.where(MeetingSession.room_id == q.room_id)
    if q.since:
        stmt = stmt.where(MeetingSession.started_at >= q.since)
    if q.until:
        stmt = stmt.where(MeetingSession.started_at <= q.until)
    mine = exists().where(
        MeetingSessionAttendance.session_id == MeetingSession.id, MeetingSessionAttendance.email == q.asker_email
    )
    if q.attendance == "attended":
        stmt = stmt.where(mine)
    elif q.attendance == "absent":
        stmt = stmt.where(~mine)
    if q.tokens:
        stmt = stmt.where(_prefilter(q.tokens))
    stmt = stmt.order_by(MeetingSession.ended_at.desc(), MeetingSession.id)
    ids = (await db.execute(stmt.limit(MAX_SESSIONS))).scalars().all()
    approved = []
    for sid in ids:
        s = await meeting_access.readable(db, sid, q.asker_email)  # THE GATE, before any content
        if s is not None:
            approved.append(s)
    return approved


# ---- 3. content for approved ids + scoring ----------------------------------------------------------------


@dataclass
class _Hit:
    score: int
    result: AuthorizedMemoryResult
    order: tuple


def _text_match(q: OrganizationalMemoryQuery, text: str) -> tuple[int, list[str]]:
    folded = _fold(text)
    matched = [t for t in q.tokens if t in folded]
    if not matched:
        return 0, []
    score, why = W_TOKEN * len(matched), ["text"]
    if len(matched) == len(q.tokens):
        score += W_ALL_TOKENS
    if " " in q.text and q.text in folded:
        score += W_PHRASE
        why.insert(0, "phrase")
    return score, why


def _details(item_type: str, content: dict) -> dict:
    if item_type == ITEM_DECISION:
        keys = ("rationale",)
    elif item_type == ITEM_COMMITMENT:
        keys = ("action", "ownerEmail", "deadline")
    elif item_type == ITEM_OPEN_LOOP:
        keys = ("kind",)
    else:
        return {}
    return {k: content.get(k) for k in keys}


def _clip(text: str | None) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= _TEXT_CHARS else text[: _TEXT_CHARS - 1].rstrip() + "…"


def _evidence(seg: TranscriptEvidence) -> MemoryEvidence:
    return MemoryEvidence(
        segment_id=seg.segment_id,
        speaker_email=seg.speaker_email,
        speaker_name=seg.speaker_name,
        start_offset_ms=seg.start_offset_ms,
        end_offset_ms=seg.end_offset_ms,
        text=_clip(seg.text),
    )


async def retrieve(db: AsyncSession, q: OrganizationalMemoryQuery) -> tuple[AuthorizedMemoryResult, ...]:
    """The caller's ranked, bounded memories for `q`, every one from a meeting the gate approved."""
    if not q.asker_email:
        return ()
    sessions = await _authorized_scope(db, q)
    if not sessions:
        return ()
    ids = [s.id for s in sessions]

    titles: dict[str, str] = {}
    booking_ids = [s.scheduled_meeting_id for s in sessions if s.scheduled_meeting_id]
    if booking_ids:
        rows = await db.execute(select(ScheduledMeeting.id, ScheduledMeeting.title).where(ScheduledMeeting.id.in_(booking_ids)))
        titles = dict(rows.all())
    attendees: dict[str, set[str]] = defaultdict(set)
    rows = await db.execute(
        select(MeetingSessionAttendance.session_id, MeetingSessionAttendance.email).where(
            MeetingSessionAttendance.session_id.in_(ids)
        )
    )
    for sid, who in rows.all():
        attendees[sid].add(who.lower())
    latest: dict[str, MeetingIntelligenceRun] = {}
    rows = await db.execute(
        select(MeetingIntelligenceRun)
        .where(MeetingIntelligenceRun.meeting_session_id.in_(ids), MeetingIntelligenceRun.status == RUN_SUCCEEDED)
        .order_by(MeetingIntelligenceRun.version.desc())
    )
    for run in rows.scalars():
        latest.setdefault(run.meeting_session_id, run)
    items: dict[str, list[MeetingIntelligenceItem]] = defaultdict(list)
    if latest:
        rows = await db.execute(
            select(MeetingIntelligenceItem)
            .where(
                MeetingIntelligenceItem.run_id.in_([r.id for r in latest.values()]),
                MeetingIntelligenceItem.review_state != REVIEW_REJECTED,  # rejected is not memory
            )
            .order_by(MeetingIntelligenceItem.position, MeetingIntelligenceItem.id)
        )
        for it in rows.scalars():
            items[it.run_id].append(it)

    hits: list[_Hit] = []
    for s in sessions:
        segments = await current_transcript(db, s.id)
        current = {seg.segment_id: seg for seg in segments}
        title = titles.get(s.scheduled_meeting_id) if s.scheduled_meeting_id else None
        who = attendees.get(s.id, set())
        meeting = MemoryMeeting(
            session_id=s.id, title=title, kind=s.kind, is_private=s.is_private, room_id=s.room_id,
            started_at=_aware(s.started_at), ended_at=_aware(s.ended_at), attended=q.asker_email in who,
        )
        context_score, context_why = 0, []
        if title and any(t in _fold(title) for t in q.tokens):
            context_score, context_why = W_TITLE, ["title"]
        if any(t in e for t in q.tokens for e in who):
            context_score, context_why = context_score + W_ATTENDEE, [*context_why, "attendee"]
        recency = -meeting.ended_at.timestamp()

        run = latest.get(s.id)
        run_items = items.get(run.id, []) if run is not None else []
        stale = run is not None and fingerprint(segments) != run.source_fingerprint
        cited: dict[str, list[str]] = defaultdict(list)
        if run_items:
            for ev, seg in await intel_repo.evidence_with_segments(db, [i.id for i in run_items]):
                cited[ev.item_id].append(seg.id)
        owners = await intel_repo.segment_session_ids(db, [sid for refs in cited.values() for sid in refs])

        def item_result(item: MeetingIntelligenceItem, score: int, why: list[str]) -> _Hit:
            content = effective_content(item)
            refs = cited.get(item.id, [])
            valid = [sid for sid in refs if sid in current and owners.get(sid) == s.id]
            score += W_STRUCTURED.get(item.item_type, W_OTHER_ITEM) + context_score
            if item.review_state != REVIEW_SUGGESTED:
                score += W_REVIEWED
            if stale:
                score += W_STALE
            return _Hit(
                score,
                AuthorizedMemoryResult(
                    ref=f"item:{item.id}", meeting=meeting, source="intelligence", item_type=item.item_type,
                    text=_clip(content.get("text")), details=_details(item.item_type, content),
                    review_state=item.review_state, confidence_level=confidence_level(item.confidence),
                    uncertainty=item.uncertainty, stale=stale,
                    evidence=tuple(_evidence(current[sid]) for sid in valid[:MAX_EVIDENCE]),
                    evidence_complete=len(valid) == len(refs), matched_on=tuple(why + context_why),
                ),
                (recency, s.id, 0, item.position, item.id),
            )

        session_hits: list[_Hit] = []
        for item in run_items:
            if q.types and item.item_type not in q.types:
                continue
            content = effective_content(item)
            if q.owner_email and item.item_type == ITEM_COMMITMENT and (
                (content.get("ownerEmail") or "").strip().lower() != q.owner_email
            ):
                continue
            score, why = _text_match(q, content.get("text") or "") if q.tokens else (1, ["type"])
            if score:
                session_hits.append(item_result(item, score, why))
        if q.tokens and not session_hits and (not q.types or DISCUSSION in q.types):
            spoken = []
            for n, seg in enumerate(segments):
                score, why = _text_match(q, seg.text)
                if score:
                    spoken.append((score, n, seg, why))
            spoken.sort(key=lambda x: (-x[0], x[1]))
            for score, n, seg, why in spoken[:MAX_TRANSCRIPT_PER_SESSION]:
                session_hits.append(
                    _Hit(
                        score + context_score,
                        AuthorizedMemoryResult(
                            ref=f"segment:{seg.segment_id}", meeting=meeting, source="transcript",
                            item_type=DISCUSSION, text=_clip(seg.text), details={}, review_state=None,
                            confidence_level=None, uncertainty=None, stale=False, evidence=(_evidence(seg),),
                            evidence_complete=True, matched_on=tuple(why + context_why),
                        ),
                        (recency, s.id, 1, n, seg.segment_id),
                    )
                )
        if not session_hits and context_score and (not q.types or ITEM_SUMMARY in q.types):
            summary = next((i for i in run_items if i.item_type == ITEM_SUMMARY), None)
            if summary is not None:
                session_hits.append(item_result(summary, 0, []))
        session_hits.sort(key=lambda h: (-h.score, h.order))
        hits += session_hits[:MAX_PER_SESSION]

    hits.sort(key=lambda h: (-h.score, h.order))
    return tuple(h.result for h in hits[: q.limit])


async def build_context(db: AsyncSession, q: OrganizationalMemoryQuery, question: str) -> OrganizationalMemoryContext:
    """The 9B seam: the application retrieves and authorizes; a future generator only reads this value."""
    return OrganizationalMemoryContext(asker_email=q.asker_email, question=question, memories=await retrieve(db, q))


# ---- wire ---------------------------------------------------------------------------------------------------


def to_wire(r: AuthorizedMemoryResult) -> dict:
    m = r.meeting
    return {
        "ref": r.ref,
        "source": r.source,
        "type": r.item_type,
        "text": r.text,
        "details": r.details,
        "reviewState": r.review_state,
        "confidence": r.confidence_level,
        "uncertainty": r.uncertainty,
        "stale": r.stale,
        "evidenceComplete": r.evidence_complete,
        "evidence": [
            {
                "segmentId": e.segment_id,
                "speakerEmail": e.speaker_email,
                "speakerName": e.speaker_name,
                "startOffsetMs": e.start_offset_ms,
                "endOffsetMs": e.end_offset_ms,
                "text": e.text,
            }
            for e in r.evidence
        ],
        "matchedOn": list(r.matched_on),
        "meeting": {
            "sessionId": m.session_id,
            "title": m.title,
            "kind": m.kind,
            "isPrivate": m.is_private,
            "roomId": m.room_id,
            "startedAt": _iso(m.started_at),
            "endedAt": _iso(m.ended_at),
            "viewer": {"attended": m.attended},
        },
    }


async def search(db: AsyncSession, email: str, query, **filters) -> dict:
    q = parse_query(email, query, **filters)
    return {"results": [to_wire(r) for r in await retrieve(db, q)]}
