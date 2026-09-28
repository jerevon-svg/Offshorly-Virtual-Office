from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_capture import TranscriptSegment
from app.models.meeting_intelligence import (
    EVIDENCE_OPTIONAL,
    FAIL_GENERATOR_ERROR,
    FAIL_INVALID_OUTPUT,
    FAIL_SERVER_RESTART,
    FAIL_TIMEOUT,
    ITEM_TYPES,
    ORIGIN_GENERATED,
    REVIEW_CONFIRMED,
    REVIEW_EDITED,
    REVIEW_REJECTED,
    REVIEW_SUGGESTED,
    RUN_FAILED,
    RUN_RUNNING,
    RUN_SUCCEEDED,
    MeetingIntelligenceEvidence,
    MeetingIntelligenceItem,
    MeetingIntelligenceRun,
)
from app.models.meeting_session import KIND_SCHEDULED, MeetingSession
from app.repositories import meeting_captures as capture_repo
from app.repositories import meeting_intelligence as repo
from app.services import intelligence_generator, meeting_access
from app.services.intelligence_generator import (
    GenerationInput,
    GeneratorUnavailable,
    IntelligenceGenerator,
    ItemDraft,
    TranscriptEvidence,
)
from app.services.meeting_capture import _is_organizer

# PHASE 7A — MEETING INTELLIGENCE: the rules between a Meeting Session's transcript and anything generated
# from it. Nothing here calls a provider, touches media, or writes any business state (tasks, bookings,
# statuses) — the only rows it writes are its own runs, items, evidence and reviews.
#
# READ = services/meeting_access.readable, FIRST, for every read and every mutation. Unauthorized and
# nonexistent are the same answer (None → 404). There is no intelligence-level read permission: an
# invited-but-absent employee reads; the room grants nothing; a private meeting's outsiders see nothing.
#
# CURATE (generate / regenerate / review) is narrower than read. Only the meeting's owner may do it:
#   * a SCHEDULED meeting → its organizer (the grant snapshotted at go-live);
#   * an INSTANT meeting  → whoever started the occurrence (its host at activation).
# The same people who may control capture, minus the "in the call right now" part — intelligence is made
# after the meeting. Being able to read Meeting Memory, being an invitee, attending, or having spoken
# starts no generation and confirms nothing. A caller who may read but not curate gets 403 (the meeting's
# existence is no secret to them); anybody else gets 404.
#
# WHEN generation may run: the Meeting Session has ENDED, no capture is active, and at least one transcript
# segment exists. A live meeting's transcript is still growing (and ingestion refuses everything once it
# ends, so an ended meeting's transcript is settled). One run at a time per session.
#
# WHAT IT READS: only transcript_segments under THIS session's captures — the current revision of each
# utterance (a corrected STT result supersedes its earlier revision), in transcript order, with real ids,
# speakers, offsets and revisions. That list IS the run's snapshot: its ids are stored on the run with a
# fingerprint, before the generator is called.
#
# WHAT IT ACCEPTS: every draft is validated (type, content shape, confidence range) and every evidence id
# must be in the run's own snapshot AND — checked again in the database — belong to a capture of the same
# Meeting Session. Anything else fails the whole run as `invalid_output`: no partial intelligence, no
# cross-meeting evidence. Items are stored `suggested`.
#
# FAILURES are durable: the run stays, `failed` with a stable code (never an exception message, which
# could carry transcript text). A failed or running run never displaces the latest succeeded one.
# Retrying is just generating again — a new version.
#
# REVIEW applies only to the LATEST succeeded run's items (an older run is history, and its items are left
# as they were). Confirm and reject set the state; edit stores the human wording in `reviewed_content` and
# never touches the generated `content`. A later review replaces the previous review (no review history in
# this phase); the AI original always remains.

_logger = logging.getLogger(__name__)

#: how long a generator may take before the run fails as `timeout`
GENERATION_TIMEOUT_S = 120.0
MAX_ITEMS = 200
MAX_EVIDENCE_PER_ITEM = 50
MAX_TEXT = 4000
MAX_CONTENT_BYTES = 16_000
MAX_UNCERTAINTY = 2000

REVIEW_ACTIONS = {"confirm": REVIEW_CONFIRMED, "edit": REVIEW_EDITED, "reject": REVIEW_REJECTED}

#: serializes the "is one already running? → claim the next version" step per session (not the generation)
_claim_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


class IntelligenceError(Exception):
    """A refused operation. `code` is a stable machine string; routers map it to a status."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class _InvalidOutput(Exception):
    pass


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite hands datetimes back naive; naive == UTC in this app."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return _aware(dt).isoformat() if dt is not None else None


# ---- authority ------------------------------------------------------------------------------------------


async def may_curate(db: AsyncSession, session: MeetingSession, email: str) -> bool:
    email = _norm(email)
    if not email:
        return False
    if session.kind == KIND_SCHEDULED:
        return await _is_organizer(db, session.id, email)
    return email == _norm(session.started_by_email)


async def _readable(db: AsyncSession, session_id: str, email: str) -> MeetingSession:
    session = await meeting_access.readable(db, session_id, email)
    if session is None:
        raise IntelligenceError("not_found")
    return session


async def _curatable(db: AsyncSession, session_id: str, email: str) -> MeetingSession:
    session = await _readable(db, session_id, email)
    if not await may_curate(db, session, email):
        raise IntelligenceError("not_allowed")
    return session


# ---- the transcript snapshot ----------------------------------------------------------------------------


async def _current_rows(db: AsyncSession, meeting_session_id: str) -> list[tuple[TranscriptSegment, datetime]]:
    captures = {c.id: _aware(c.started_at) for c in await capture_repo.for_session(db, meeting_session_id)}
    current: dict[tuple, TranscriptSegment] = {}
    for s in await capture_repo.segments(db, list(captures)):
        # A ref-less segment is its own utterance; a ref'd one is superseded by a higher revision of that ref.
        key = (s.capture_id, s.source, s.source_segment_ref) if s.source_segment_ref else ("row", s.id)
        kept = current.get(key)
        if kept is None or s.revision > kept.revision:
            current[key] = s
    ordered = sorted(
        current.values(),
        key=lambda s: (captures[s.capture_id], s.capture_id, s.start_offset_ms, _aware(s.created_at), s.id),
    )
    return [(s, captures[s.capture_id]) for s in ordered]


def _evidence(s: TranscriptSegment, capture_started_at: datetime) -> TranscriptEvidence:
    return TranscriptEvidence(
        segment_id=s.id,
        capture_id=s.capture_id,
        capture_started_at=capture_started_at,
        speaker_email=s.speaker_email,
        speaker_name=s.speaker_name,
        start_offset_ms=s.start_offset_ms,
        end_offset_ms=s.end_offset_ms,
        revision=s.revision,
        text=s.text,
        confidence=s.confidence,
    )


async def current_transcript(db: AsyncSession, meeting_session_id: str) -> list[TranscriptEvidence]:
    """The session's transcript as a generator sees it: the CURRENT revision of each utterance, from this
    session's captures only, in transcript order. Deterministic for the same rows."""
    return [_evidence(s, started) for s, started in await _current_rows(db, meeting_session_id)]


def fingerprint(segments: list[TranscriptEvidence]) -> str:
    """sha256 over what a run analyzed — id, revision, speaker, capture, offsets and words of each segment,
    in order. Equal fingerprints mean the generator would see exactly the same transcript."""
    canon = [
        [s.segment_id, s.revision, s.speaker_email, s.capture_id, s.start_offset_ms, s.end_offset_ms, s.text]
        for s in segments
    ]
    return hashlib.sha256(json.dumps(canon, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


# ---- validation -----------------------------------------------------------------------------------------


def _valid_content(item_type: str, content) -> dict:
    """Every type carries a non-empty `text`; other keys are free JSON but bounded. Raises _InvalidOutput."""
    if item_type not in ITEM_TYPES or not isinstance(content, dict):
        raise _InvalidOutput()
    text = content.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise _InvalidOutput()
    try:
        encoded = json.dumps(content, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        raise _InvalidOutput() from None
    if len(encoded.encode()) > MAX_CONTENT_BYTES:
        raise _InvalidOutput()
    return json.loads(encoded)  # a detached, plain-JSON copy


def _validate_drafts(drafts, snapshot_ids: set[str]) -> list[tuple[ItemDraft, dict, list[str]]]:
    if not isinstance(drafts, list) or len(drafts) > MAX_ITEMS:
        raise _InvalidOutput()
    out = []
    for d in drafts:
        if not isinstance(d, ItemDraft):
            raise _InvalidOutput()
        content = _valid_content(d.item_type, d.content)
        c = d.confidence
        if c is not None and (not isinstance(c, (int, float)) or isinstance(c, bool) or not 0.0 <= float(c) <= 1.0):
            raise _InvalidOutput()
        if d.uncertainty is not None and (not isinstance(d.uncertainty, str) or len(d.uncertainty) > MAX_UNCERTAINTY):
            raise _InvalidOutput()
        ids = d.evidence_segment_ids
        if not isinstance(ids, (tuple, list)) or len(ids) > MAX_EVIDENCE_PER_ITEM:
            raise _InvalidOutput()
        cited: list[str] = []
        for sid in ids:
            # Only a segment this run analyzed — which also rules out other meetings, superseded revisions
            # and ids that do not exist.
            if not isinstance(sid, str) or sid not in snapshot_ids:
                raise _InvalidOutput()
            if sid not in cited:
                cited.append(sid)
        if not cited and d.item_type not in EVIDENCE_OPTIONAL:
            raise _InvalidOutput()
        out.append((d, content, cited))
    return out


# ---- generation -----------------------------------------------------------------------------------------


async def _mark_failed(db: AsyncSession, run_id: str, reason: str) -> None:
    await db.execute(
        update(MeetingIntelligenceRun)
        .where(MeetingIntelligenceRun.id == run_id, MeetingIntelligenceRun.status == RUN_RUNNING)
        .values(status=RUN_FAILED, failure_reason=reason, completed_at=_utcnow())
    )
    await db.commit()


async def generate(
    db: AsyncSession,
    session_id: str,
    email: str,
    *,
    now: datetime | None = None,
    generator: IntelligenceGenerator | None = None,
) -> dict:
    """Run one generation over the session's settled transcript. Always a NEW version. Returns the run
    (succeeded or failed — a failure is recorded, not raised). Raises IntelligenceError when refused before
    a run exists (access, authority, state, no transcript, no generator)."""
    email = _norm(email)
    session = await _curatable(db, session_id, email)
    if session.ended_at is None:
        raise IntelligenceError("meeting_active")
    if await capture_repo.active_for_session(db, session.id) is not None:
        raise IntelligenceError("capture_active")
    try:
        gen = generator or intelligence_generator.resolve()
    except GeneratorUnavailable:
        raise IntelligenceError("generator_unavailable") from None

    async with _claim_locks[session.id]:
        rows = await _current_rows(db, session.id)
        if not rows:
            raise IntelligenceError("no_transcript")
        if any(r.status == RUN_RUNNING for r in await repo.runs(db, session.id)):
            raise IntelligenceError("generation_in_progress")
        segments = [_evidence(s, started) for s, started in rows]
        through = max(_aware(s.created_at) for s, _ in rows)
        run = MeetingIntelligenceRun(
            meeting_session_id=session.id,
            version=await repo.next_version(db, session.id),
            status=RUN_RUNNING,
            generator=gen.id,
            requested_by_email=email,
            started_at=now or _utcnow(),
            source_segment_ids=[s.segment_id for s in segments],
            source_segment_count=len(segments),
            source_fingerprint=fingerprint(segments),
            source_through_at=through,
        )
        db.add(run)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise IntelligenceError("generation_in_progress") from None
        run_id = run.id

    # The generator runs OUTSIDE any transaction (a real provider will take seconds) and sees only the snapshot.
    failure: str | None = None
    drafts = None
    try:
        drafts = await asyncio.wait_for(
            gen.generate(GenerationInput(meeting_session_id=session.id, segments=tuple(segments))),
            timeout=GENERATION_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        failure = FAIL_TIMEOUT
    except Exception:  # noqa: BLE001 — any generator error is a failed run, never a 500
        _logger.warning("meeting intelligence: generator %s failed for run %s", gen.id, run_id, exc_info=True)
        failure = FAIL_GENERATOR_ERROR

    if failure is None:
        try:
            validated = _validate_drafts(drafts, {s.segment_id for s in segments})
            cited = sorted({sid for _, _, ids in validated for sid in ids})
            owners = await repo.segment_session_ids(db, cited)
            if any(owners.get(sid) != session.id for sid in cited):  # defense in depth, from the database
                raise _InvalidOutput()
            for position, (d, content, ids) in enumerate(validated):
                item = MeetingIntelligenceItem(
                    run_id=run_id,
                    item_type=d.item_type,
                    position=position,
                    origin=ORIGIN_GENERATED,
                    content=content,
                    confidence=float(d.confidence) if d.confidence is not None else None,
                    uncertainty=d.uncertainty,
                    review_state=REVIEW_SUGGESTED,
                )
                db.add(item)
                await db.flush()
                for i, sid in enumerate(ids):
                    db.add(MeetingIntelligenceEvidence(item_id=item.id, segment_id=sid, position=i))
            await db.execute(
                update(MeetingIntelligenceRun)
                .where(MeetingIntelligenceRun.id == run_id)
                .values(status=RUN_SUCCEEDED, completed_at=_utcnow())
            )
            await db.commit()
        except _InvalidOutput:
            await db.rollback()
            failure = FAIL_INVALID_OUTPUT
        except Exception:  # noqa: BLE001 — a persistence error fails the run, whole
            await db.rollback()
            _logger.warning("meeting intelligence: could not store run %s", run_id, exc_info=True)
            failure = FAIL_INVALID_OUTPUT

    if failure is not None:
        await _mark_failed(db, run_id, failure)
    fresh = await repo.get_run(db, session.id, run_id)
    await db.refresh(fresh)
    return await _run_detail(db, fresh)


async def fail_orphans(*, now: datetime) -> int:
    """Startup recovery: any run left `running` by a process that is gone becomes `failed/server_restart`."""
    from app import database as app_db

    async with app_db.async_session_maker() as db:
        n = await repo.fail_all_running(db, at=now, reason=FAIL_SERVER_RESTART)
        await db.commit()
        return n


# ---- review ---------------------------------------------------------------------------------------------


async def review(
    db: AsyncSession, session_id: str, item_id: str, email: str, *, action: str, content: dict | None = None
) -> dict:
    """A human decision on one generated item of the latest succeeded run. Never creates a task or any
    other state outside this item."""
    email = _norm(email)
    session = await _readable(db, session_id, email)
    found = await repo.item_in_session(db, session.id, item_id or "")
    if found is None:
        raise IntelligenceError("not_found")
    if not await may_curate(db, session, email):
        raise IntelligenceError("not_allowed")
    item, run = found
    latest = await repo.latest_succeeded(db, session.id)
    if run.status != RUN_SUCCEEDED or latest is None or latest.id != run.id:
        raise IntelligenceError("run_superseded")
    state = REVIEW_ACTIONS.get(action)
    if state is None:
        raise IntelligenceError("invalid_review")
    if state == REVIEW_EDITED:
        try:
            edited = _valid_content(item.item_type, content)
        except _InvalidOutput:
            raise IntelligenceError("invalid_review") from None
    elif content is not None:
        raise IntelligenceError("invalid_review")
    else:
        edited = None
    item.review_state = state
    item.reviewed_content = edited
    item.reviewed_by_email = email
    item.reviewed_at = _utcnow()
    await db.commit()
    await db.refresh(item)
    [wire] = await _items_wire(db, [item])
    return wire


# ---- authorized reads -----------------------------------------------------------------------------------


def _run_summary(r: MeetingIntelligenceRun) -> dict:
    return {
        "runId": r.id,
        "sessionId": r.meeting_session_id,
        "version": r.version,
        "status": r.status,
        "generator": r.generator,
        "requestedBy": r.requested_by_email,
        "startedAt": _iso(r.started_at),
        "completedAt": _iso(r.completed_at),
        "failureReason": r.failure_reason,
        "source": {
            "segmentCount": r.source_segment_count,
            "fingerprint": r.source_fingerprint,
            "throughAt": _iso(r.source_through_at),
        },
    }


async def _items_wire(db: AsyncSession, items: list[MeetingIntelligenceItem]) -> list[dict]:
    evidence: dict[str, list[dict]] = {i.id: [] for i in items}
    for ev, seg in await repo.evidence_with_segments(db, list(evidence)):
        evidence[ev.item_id].append(
            {
                "segmentId": seg.id,
                "captureId": seg.capture_id,
                "position": ev.position,
                "speakerEmail": seg.speaker_email,
                "speakerName": seg.speaker_name,
                "startOffsetMs": seg.start_offset_ms,
                "endOffsetMs": seg.end_offset_ms,
                "revision": seg.revision,
                "text": seg.text,
            }
        )
    return [
        {
            "itemId": i.id,
            "type": i.item_type,
            "position": i.position,
            "origin": i.origin,
            "content": i.content,
            "confidence": i.confidence,
            "uncertainty": i.uncertainty,
            "reviewState": i.review_state,
            "reviewedContent": i.reviewed_content,
            "reviewedBy": i.reviewed_by_email,
            "reviewedAt": _iso(i.reviewed_at),
            "evidence": evidence[i.id],
        }
        for i in items
    ]


async def _run_detail(db: AsyncSession, r: MeetingIntelligenceRun) -> dict:
    return {
        **_run_summary(r),
        "sourceSegmentIds": list(r.source_segment_ids or []),
        "items": await _items_wire(db, await repo.items(db, r.id)),
    }


async def list_runs(db: AsyncSession, session_id: str, email: str) -> dict | None:
    session = await meeting_access.readable(db, session_id, email)
    if session is None:
        return None
    runs = await repo.runs(db, session.id)
    latest = await repo.latest_succeeded(db, session.id)
    return {
        "sessionId": session.id,
        "latestRunId": latest.id if latest is not None else None,
        "runs": [_run_summary(r) for r in runs],
    }


async def read_run(db: AsyncSession, session_id: str, run_id: str, email: str) -> dict | None:
    session = await meeting_access.readable(db, session_id, email)
    if session is None:
        return None
    run = await repo.get_run(db, session.id, run_id or "")
    return await _run_detail(db, run) if run is not None else None


async def read_latest(db: AsyncSession, session_id: str, email: str) -> dict | None:
    """The latest succeeded run with its items and evidence, and whether the transcript has changed since
    it was generated (`stale`). `run` is None when nothing has succeeded yet."""
    session = await meeting_access.readable(db, session_id, email)
    if session is None:
        return None
    latest = await repo.latest_succeeded(db, session.id)
    if latest is None:
        return {"sessionId": session.id, "run": None, "stale": False}
    current = fingerprint(await current_transcript(db, session.id))
    return {"sessionId": session.id, "run": await _run_detail(db, latest), "stale": current != latest.source_fingerprint}
