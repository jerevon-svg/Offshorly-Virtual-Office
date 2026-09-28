from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import database as app_db
from app.models.meeting_capture import (
    CONSENT_DECLINED,
    CONSENT_GRANTED,
    CONSENT_PENDING,
    SOURCE_FAKE,
    STOP_STOPPED,
    CaptureSession,
)
from app.models.meeting_session import GRANT_ORGANIZER, KIND_SCHEDULED, MeetingSession, MeetingSessionGrant
from app.repositories import meeting_captures as repo
from app.repositories import meeting_sessions as session_repo
from app.services import meeting_access, meeting_sessions
from app.services.call_registry import MEETING_KEY_PREFIX
from app.services.notifications import _display_name

# PHASE 6B — CAPTURE + CONSENT + TRANSCRIPT EVIDENCE: the provider-independent rules underneath future
# real recording/transcription. Nothing here touches media, LiveKit, storage or any external service.
#
# WHO MAY START / STOP. The actor must be CONNECTED to the live meeting right now (a participant) and be
# its current host — or, for a scheduled meeting, its organizer (the grant snapshotted at go-live). Being
# authorized to READ the meeting's memory is a different thing and starts nothing: an invitee who is not
# in the call cannot remotely switch capture on. Stop needs the same role, but not presence — stopping
# only ever reduces what is captured. Identity is always the socket's authenticated email.
#
# CONSENT is per person, per capture, and starts `pending`. Whoever is connected when a capture starts,
# and anyone who joins while it is active, gets a pending row; only that person moves it to granted or
# declined. Declining never removes anybody from the meeting — it only makes ingestion refuse them.
# Leaving and rejoining keeps the row (and its decision). A NEW capture starts with no rows at all.
#
# INGESTION is the one door a transcript segment comes through (`ingest_segment`). The source supplies
# words and timing; the SERVER decides everything else, before anything is written:
#   * the speaker is the SourceIdentity the adapter established from authenticated stream ownership —
#     never a speaker field in the payload, never a guess;
#   * the capture is active and its Meeting Session is still the live one in this process;
#   * that speaker has a consent row on THIS capture (so they were in the meeting) and it is `granted`;
#   * the moment the words were SPOKEN (capture.started_at + the segment's offsets) lies inside one of the
#     speaker's persisted attendance intervals in this Meeting Session — an open interval runs to now, a
#     closed one ends at left_at, each rejoin is its own interval. So a delayed STT result for speech made
#     before somebody left is still accepted; speech claiming to happen after they left, or in the gap
#     between a leave and a rejoin, is not. Attendance never implies consent; both are required.
# Unknown, pending and declined speakers are refused. Nothing is captured first and filtered later.
#
# TIMESTAMPS. capture.started_at is the server's UTC clock and the zero for every offset. A segment's
# offsets are validated against it (never negative, end ≥ start, not meaningfully in the future); the
# server's receive time is the segment's created_at. Fake input proves the contract, not audio evidence.
#
# READS go through meeting_access.readable FIRST — there is no capture-level permission system. The room
# grants nothing; consent and attendance are not read permissions either.
#
# LOCKING. Every mutation runs under meeting_sessions.lock_for(key) — the same per-meeting lock that closes
# the session — so a capture can never be started on, or a segment accepted into, a session that is
# closing at that same moment.

_logger = logging.getLogger(__name__)

#: longest single segment text accepted
MAX_SEGMENT_TEXT = 4000
#: a segment may end at most this far past "now" relative to capture start (clock skew between source and server)
FUTURE_SKEW_TOLERANCE_MS = 5_000
#: slack at each edge of an attendance interval (join/leave are server-stamped; offsets come from the source)
ATTENDANCE_TOLERANCE_MS = 1_000


class CaptureError(Exception):
    """A refused capture operation. `code` is a stable machine string the client may show or log."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class SourceIdentity:
    """Who a segment is attributed to, as the SOURCE ADAPTER established it from authenticated stream
    ownership (the LiveKit participant identity of the track, for a real adapter; the authenticated socket
    for the dev fake source). Only trusted server code constructs one — never from a payload field."""

    email: str
    source: str


@dataclass(frozen=True)
class SegmentIn:
    """What a source may tell us about an utterance: its words and timing. Nothing about who is allowed."""

    start_offset_ms: int
    end_offset_ms: int
    text: str
    confidence: float | None = None
    source_segment_ref: str | None = None
    revision: int = 1


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def _aware(dt: datetime) -> datetime:
    """SQLite hands datetimes back naive; naive == UTC in this app."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return _aware(dt).isoformat() if dt is not None else None


async def _is_organizer(db: AsyncSession, session_id: str, email: str) -> bool:
    row = await db.execute(
        select(MeetingSessionGrant.id).where(
            MeetingSessionGrant.session_id == session_id,
            MeetingSessionGrant.email == _norm(email),
            MeetingSessionGrant.reason == GRANT_ORGANIZER,
        )
    )
    return row.first() is not None


async def _may_control(db: AsyncSession, session: MeetingSession, email: str, host: str | None) -> bool:
    email = _norm(email)
    if email and email == _norm(host or ""):
        return True
    return session.kind == KIND_SCHEDULED and await _is_organizer(db, session.id, email)


async def _open_session(db: AsyncSession, key: str) -> MeetingSession:
    """The key's live, persisted, open Meeting Session — or refuse."""
    session_id = meeting_sessions.session_id_for(key)
    row = await session_repo.get(db, session_id) if session_id else None
    if row is None or row.ended_at is not None:
        raise CaptureError("no_live_session")
    return row


# ---- start / stop ---------------------------------------------------------------------------------------


async def start(key: str, actor: str, *, participants: list[str], host: str | None, now: datetime) -> str:
    """Start a capture on `key`'s live Meeting Session. Every current participant gets a PENDING consent.
    Returns the new capture id."""
    actor = _norm(actor)
    if actor not in {_norm(p) for p in participants}:
        raise CaptureError("not_participant")
    async with meeting_sessions.lock_for(key):
        async with app_db.async_session_maker() as db:
            session = await _open_session(db, key)
            if not await _may_control(db, session, actor, host):
                raise CaptureError("not_allowed")
            if await repo.active_for_session(db, session.id) is not None:
                raise CaptureError("already_active")
            capture = await repo.create(
                db, meeting_session_id=session.id, started_by_email=actor, started_at=now, source=SOURCE_FAKE
            )
            for email in sorted({_norm(p) for p in participants}):
                await repo.ensure_pending(db, capture.id, email)
            await db.commit()
            return capture.id


async def stop(key: str, actor: str, *, host: str | None, now: datetime) -> str:
    """Stop the live session's active capture. Existing segments are kept. Returns the capture id."""
    async with meeting_sessions.lock_for(key):
        async with app_db.async_session_maker() as db:
            session = await _open_session(db, key)
            if not await _may_control(db, session, actor, host):
                raise CaptureError("not_allowed")
            capture = await repo.active_for_session(db, session.id)
            if capture is None:
                raise CaptureError("no_active_capture")
            await repo.stop(db, capture.id, at=now, reason=STOP_STOPPED)
            await db.commit()
            return capture.id


# ---- consent --------------------------------------------------------------------------------------------


async def decide(key: str, actor: str, capture_id: str, *, grant: bool, now: datetime) -> str:
    """The actor's own decision about the ACTIVE capture on `key`. Only a person who has a consent row on it
    (present at start, or joined while it ran) may decide, and only for themself. Returns the new state."""
    actor = _norm(actor)
    async with meeting_sessions.lock_for(key):
        async with app_db.async_session_maker() as db:
            session = await _open_session(db, key)
            capture = await repo.get(db, capture_id or "")
            if capture is None or capture.meeting_session_id != session.id or capture.stopped_at is not None:
                raise CaptureError("no_active_capture")
            row = await repo.consent(db, capture.id, actor)
            if row is None:
                raise CaptureError("no_consent_record")
            row.state = CONSENT_GRANTED if grant else CONSENT_DECLINED
            row.decided_at = now
            await db.commit()
            return row.state


async def on_join(key: str, email: str) -> str | None:
    """Somebody is connected to `key`'s meeting. If a capture is active, make sure they have a consent row —
    a late joiner becomes PENDING; a rejoiner keeps whatever they decided. Returns the session id when the
    meeting has one (so the caller can send them the capture state), else None. Never raises."""
    session_id = meeting_sessions.session_id_for(key)
    if session_id is None:
        return None
    try:
        async with meeting_sessions.lock_for(key):
            async with app_db.async_session_maker() as db:
                capture = await repo.active_for_session(db, session_id)
                if capture is not None:
                    await repo.ensure_pending(db, capture.id, email)
                    await db.commit()
    except Exception:  # noqa: BLE001 — bookkeeping must never break a join
        _logger.warning("meeting capture: failed to enrol late joiner on %s", key, exc_info=True)
    return session_id


# ---- ingestion: the ONE door for transcript segments ----------------------------------------------------


def _validate(segment: SegmentIn) -> str:
    ints = (segment.start_offset_ms, segment.end_offset_ms, segment.revision)
    if any(not isinstance(v, int) or isinstance(v, bool) for v in ints):
        raise CaptureError("invalid_segment")
    if segment.start_offset_ms < 0 or segment.end_offset_ms < segment.start_offset_ms or segment.revision < 1:
        raise CaptureError("invalid_segment")
    text = segment.text.strip() if isinstance(segment.text, str) else ""
    if not text or len(text) > MAX_SEGMENT_TEXT:
        raise CaptureError("invalid_segment")
    c = segment.confidence
    if c is not None and (not isinstance(c, (int, float)) or isinstance(c, bool) or not 0.0 <= float(c) <= 1.0):
        raise CaptureError("invalid_segment")
    ref = segment.source_segment_ref
    if ref is not None and (not isinstance(ref, str) or not ref.strip() or len(ref) > 128):
        raise CaptureError("invalid_segment")
    return text


async def _attended_during(db: AsyncSession, session_id: str, email: str, spoken: tuple[datetime, datetime]) -> bool:
    """Was `email` attending this session for the whole of `spoken`? One interval must cover it (open = until
    now). No interval, or a span that crosses a leave, fails closed."""
    slack = timedelta(milliseconds=ATTENDANCE_TOLERANCE_MS)
    start, end = spoken
    for a in await session_repo.attendance(db, session_id):
        if a.email != email:
            continue
        joined = _aware(a.joined_at) - slack
        left = _aware(a.left_at) + slack if a.left_at is not None else None
        if joined <= start and (left is None or end <= left):
            return True
    return False


async def ingest_segment(capture_id: str, identity: SourceIdentity, segment: SegmentIn, *, now: datetime) -> str:
    """Accept one transcript segment, or refuse it with a CaptureError — see the header for what must hold.
    Returns the stored segment id. Fails closed on anything unknown."""
    text = _validate(segment)
    speaker = _norm(identity.email)
    if not speaker:
        raise CaptureError("unknown_speaker")
    async with app_db.async_session_maker() as db:
        capture = await repo.get(db, capture_id or "")
        session = await session_repo.get(db, capture.meeting_session_id) if capture is not None else None
    if capture is None or session is None:
        raise CaptureError("unknown_capture")
    key = MEETING_KEY_PREFIX + session.meeting_key

    async with meeting_sessions.lock_for(key):
        async with app_db.async_session_maker() as db:
            capture = await repo.get(db, capture_id)
            session = await session_repo.get(db, capture.meeting_session_id)
            if identity.source != capture.source:
                raise CaptureError("source_mismatch")
            if session.ended_at is not None or meeting_sessions.session_id_for(key) != session.id:
                raise CaptureError("meeting_not_live")
            if capture.stopped_at is not None:
                raise CaptureError("capture_stopped")
            consent = await repo.consent(db, capture.id, speaker)
            if consent is None:
                raise CaptureError("unknown_speaker")
            if consent.state == CONSENT_PENDING:
                raise CaptureError("consent_pending")
            if consent.state != CONSENT_GRANTED:
                raise CaptureError("consent_declined")
            started = _aware(capture.started_at)
            elapsed_ms = int((now - started).total_seconds() * 1000)
            if segment.end_offset_ms > elapsed_ms + FUTURE_SKEW_TOLERANCE_MS:
                raise CaptureError("offset_out_of_range")
            spoken = (
                started + timedelta(milliseconds=segment.start_offset_ms),
                started + timedelta(milliseconds=segment.end_offset_ms),
            )
            if not await _attended_during(db, session.id, speaker, spoken):
                raise CaptureError("not_attending")
            try:
                row = await repo.add_segment(
                    db,
                    capture_id=capture.id,
                    speaker_email=speaker,
                    speaker_name=_display_name(speaker),
                    start_offset_ms=segment.start_offset_ms,
                    end_offset_ms=segment.end_offset_ms,
                    text=text,
                    confidence=float(segment.confidence) if segment.confidence is not None else None,
                    source=capture.source,
                    source_segment_ref=segment.source_segment_ref,
                    revision=segment.revision,
                    created_at=now,
                    evidence_ref=None,
                )
                await db.commit()
            except IntegrityError:
                await db.rollback()
                raise CaptureError("duplicate_segment") from None
            return row.id


# ---- participant state + authorized reads ---------------------------------------------------------------


def _capture_wire(c: CaptureSession) -> dict:
    return {
        "captureId": c.id,
        "active": c.stopped_at is None,
        "startedBy": c.started_by_email,
        "startedAt": _iso(c.started_at),
        "stoppedAt": _iso(c.stopped_at),
        "stopReason": c.stop_reason,
        "source": c.source,
    }


async def state_for(session_id: str, email: str, *, host: str | None) -> dict:
    """What ONE participant sees about their meeting's capture: the latest capture (active or just stopped),
    their OWN consent state on it, and whether they may start/stop. Callers send it only to participants."""
    async with app_db.async_session_maker() as db:
        session = await session_repo.get(db, session_id)
        capture = await repo.latest_for_session(db, session_id)
        mine = await repo.consent(db, capture.id, email) if capture is not None else None
        can_control = session is not None and session.ended_at is None and await _may_control(db, session, email, host)
    return {
        "sessionId": session_id,
        "capture": _capture_wire(capture) if capture is not None else None,
        "myConsent": mine.state if mine is not None else None,
        "canControl": can_control,
    }


async def read_transcript(db: AsyncSession, session_id: str, email: str) -> dict | None:
    """Every capture of a Meeting Session with its accepted segments — ONLY if meeting_access authorizes
    `email`; otherwise None, exactly as if the session did not exist. Consent states are not exposed."""
    session = await meeting_access.readable(db, session_id, email)
    if session is None:
        return None
    captures = await repo.for_session(db, session.id)
    by_capture: dict[str, list[dict]] = {c.id: [] for c in captures}
    for s in await repo.segments(db, list(by_capture)):
        by_capture[s.capture_id].append(
            {
                "segmentId": s.id,
                "speakerEmail": s.speaker_email,
                "speakerName": s.speaker_name,
                "startOffsetMs": s.start_offset_ms,
                "endOffsetMs": s.end_offset_ms,
                "text": s.text,
                "confidence": s.confidence,
                "source": s.source,
                "revision": s.revision,
                "receivedAt": _iso(s.created_at),
                "evidenceRef": s.evidence_ref,
            }
        )
    return {
        "sessionId": session.id,
        "captures": [{**_capture_wire(c), "segments": by_capture[c.id]} for c in captures],
    }
