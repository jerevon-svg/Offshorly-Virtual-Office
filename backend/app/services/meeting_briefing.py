from __future__ import annotations

import re
from dataclasses import replace
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_intelligence import (
    ITEM_COMMITMENT,
    ITEM_DECISION,
    ITEM_KEY_POINT,
    ITEM_OPEN_LOOP,
    REVIEW_SUGGESTED,
    RUN_SUCCEEDED,
    MeetingIntelligenceItem,
    MeetingIntelligenceRun,
)
from app.models.meeting_session import MeetingSession
from app.models.scheduled_meeting import ScheduledMeeting
from app.repositories import meeting_sessions as repo
from app.repositories import scheduled_meetings as booking_repo
from app.services import organizational_memory as org_memory
from app.services.meeting_continuity import related_sessions
from app.services.meeting_intelligence import current_transcript, fingerprint
from app.services.meeting_receipt import _aware, _iso

# PHASE 9C — PRE-MEETING BRIEFING: before an UPCOMING booking, what the caller's own authorized Meeting
# Memory recorded in the meetings related to it. A composition of existing pieces, not a new memory: nothing
# is generated, stored or predicted.
#
# TWO IDENTITIES, KEPT APART. The booking is what is about to happen; the history is ended Meeting Sessions.
# Nothing here creates a session, attendance or any lifecycle state for the upcoming meeting.
#
# ORDER OF OPERATIONS — authorization before content:
#   1. THE BOOKING. The caller must be on it (organizer or invitee, the same rule as editing/responding), it
#      must still stand and must not have ended. Otherwise: not found, exactly as a booking you are not in.
#   2. RELATED SESSIONS. 8C's pairwise rule (meeting_continuity.related_sessions), keyed off THIS booking:
#      the same booking, or the same normalized title with a meaningful roster overlap. Candidates only inside
#      meeting_access.candidate_ids(caller), then meeting_access.readable per candidate. The room, a similar
#      title or an instant meeting never relate. Being invited to the upcoming booking grants NOTHING about
#      the past: each past session passes the gate on its own rules or it does not exist here.
#   3. CONTENT. 9A's retrieve() narrowed to exactly those sessions (it gates each one again): effective
#      content (edited → the human's wording), rejected excluded, stale flagged, and only evidence lines still
#      in that session's current transcript and owned by it.
# A hidden session therefore leaves no source, date, title, count, gap or wording behind — "latest" always
# means the latest the caller can open, and nothing claims a meeting did or did not happen in between.
#
# WHAT A BRIEFING MAY CLAIM — only what the structured, authorized items say, in their own words:
#   * decisions  — only `decision` items, oldest first. Two different decisions are shown by date and never
#                  called superseded; `recordedChange` is set only when the decision's OWN recorded wording
#                  states a change ("moving launch from Thursday to Friday…"). No cause is ever composed.
#   * commitments — text/owner/deadline as recorded; no status (pending/overdue/done) exists to claim.
#                  `isYours` only when the structured owner IS the caller — never inferred from the text.
#   * open loops — "recorded as open" at the meeting that recorded it, grouped when the same normalized text
#                  recurs. Never resolved, never "still open today".
#   * key context — a few key points, reviewed first. A transcript is never mined: a meeting with a
#                  transcript but no structured notes is listed as a source and contributes no claims.
# STALE: an item from a run whose transcript has moved on is used only while EVERY line it cited is still in
# the current transcript (it keeps its stale flag); otherwise it is left out of the briefing and only counted
# on its source. Nothing is regenerated.

MAX_SOURCES = 5  # the most recent related sessions considered
MAX_DECISIONS = 8
MAX_COMMITMENTS = 8
MAX_OPEN_LOOPS = 6
MAX_KEY_CONTEXT = 3
MAX_EVIDENCE = 2
MAX_AVAILABILITY_IDS = 20
_PER_SESSION = 200  # every active item of a considered meeting; the caps below choose what is shown
_TYPES = frozenset({ITEM_DECISION, ITEM_COMMITMENT, ITEM_OPEN_LOOP, ITEM_KEY_POINT})

# A decision's own words state that something changed. Deliberately narrow: a verb of change with an explicit
# "from … to", or "instead of" / "no longer". "Launch Friday" after "Launch Thursday" is NOT a change here.
_CHANGE = re.compile(
    r"\b(?:(?:mov|chang|switch|shift|push|postpon|reschedul|delay|bump)\w*\b.*\bfrom\b.+\bto\b|instead of|no longer)\b",
    re.IGNORECASE,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fold(text: str | None) -> str:
    return " ".join((text or "").split()).casefold()


async def _booking(db: AsyncSession, booking_id: str, email: str, now: datetime) -> ScheduledMeeting | None:
    """Step 1 — the upcoming booking, only for somebody on it."""
    b = await booking_repo.get(db, (booking_id or "").strip())
    if b is None or b.status != booking_repo.SCHEDULED or _aware(b.ends_at) <= now:
        return None
    if b.organizer_email.strip().lower() != email and await booking_repo.invitee(db, b.id, email) is None:
        return None
    return b


def _usable(r: org_memory.AuthorizedMemoryResult) -> bool:
    """Every cited line still current (always true unless the run is stale)."""
    return bool(r.evidence) and r.evidence_complete


def _entry(r: org_memory.AuthorizedMemoryResult) -> dict:
    return {
        "itemId": r.ref.removeprefix("item:"),
        "sessionId": r.meeting.session_id,
        "at": _iso(r.meeting.started_at),
        "text": r.text,
        "reviewState": r.review_state,
        "stale": r.stale,
        "evidence": [
            {"speakerEmail": e.speaker_email, "speakerName": e.speaker_name, "startOffsetMs": e.start_offset_ms,
             "text": e.text}
            for e in r.evidence[:MAX_EVIDENCE]
        ],
    }


def _pick(results: list, cap: int, order, first=lambda r: False) -> list:
    """At most `cap`: `first` ones, then human-reviewed, then the most recent — shown in `order` (oldest first)."""
    ranked = sorted(
        results,
        key=lambda r: (not first(r), r.review_state == REVIEW_SUGGESTED, -r.meeting.started_at.timestamp(), order(r)),
    )[:cap]
    return sorted(ranked, key=lambda r: (not first(r), order(r)))


async def _sources(db: AsyncSession, sessions: list[MeetingSession], relations: dict[str, str], titles: dict,
                   attended: dict[str, bool], results: list, omitted: dict[str, int]) -> list[dict]:
    """The approved related sessions, oldest first, with what each could contribute. Runs/transcripts are
    read here only for these already-approved ids."""
    ids = [s.id for s in sessions]
    latest: dict[str, MeetingIntelligenceRun] = {}
    rows = await db.execute(
        select(MeetingIntelligenceRun)
        .where(MeetingIntelligenceRun.meeting_session_id.in_(ids), MeetingIntelligenceRun.status == RUN_SUCCEEDED)
        .order_by(MeetingIntelligenceRun.version.desc())
    )
    for run in rows.scalars():
        latest.setdefault(run.meeting_session_id, run)
    used: dict[str, list] = {}
    for r in results:
        used.setdefault(r.meeting.session_id, []).append(r)
    out = []
    for s in sessions:
        run = latest.get(s.id)
        segments = await current_transcript(db, s.id)
        mine = used.get(s.id, [])
        if run is None:
            notes = "transcript_only" if segments else "none"
        else:
            notes = "structured" if mine else "nothing_useful"
        reviewed = sum(1 for r in mine if r.review_state != REVIEW_SUGGESTED)
        out.append({
            "sessionId": s.id,
            "title": titles.get(s.scheduled_meeting_id),
            "relation": relations[s.id],
            "isPrivate": s.is_private,
            "startedAt": _iso(s.started_at),
            "endedAt": _iso(s.ended_at),
            "viewer": {"attended": attended.get(s.id, False)},
            "notes": notes,
            "stale": run is not None and fingerprint(segments) != run.source_fingerprint,
            "review": None if not mine else "reviewed" if reviewed == len(mine) else "partly" if reviewed else "suggested",
            "omittedStale": omitted.get(s.id, 0),
        })
    return out


async def _compose(db: AsyncSession, booking: ScheduledMeeting, email: str) -> dict:
    """Steps 2–3 and the composition, for a booking step 1 already approved."""
    relations = await related_sessions(db, booking, email)
    empty = {"sources": [], "decisions": [], "commitments": [], "openLoops": [], "keyContext": []}
    if not relations:
        return empty
    rows = await db.execute(
        select(MeetingSession).where(MeetingSession.id.in_(sorted(relations)))
        .order_by(MeetingSession.started_at.desc(), MeetingSession.id)
        .limit(MAX_SOURCES)
    )
    sessions = sorted(rows.scalars(), key=lambda s: (_aware(s.started_at), s.id))
    ids = frozenset(s.id for s in sessions)

    q = replace(
        org_memory.browse_query(email, _TYPES, limit=org_memory.MAX_LIMIT),
        session_ids=ids, per_session=_PER_SESSION, limit=_PER_SESSION * MAX_SOURCES,
    )
    everything = [r for r in await org_memory.retrieve(db, q) if r.source == "intelligence"]
    omitted: dict[str, int] = {}
    results = []
    for r in everything:
        if _usable(r):
            results.append(r)
        else:
            omitted[r.meeting.session_id] = omitted.get(r.meeting.session_id, 0) + 1
    # Item order inside one meeting (the run's own `position`) — the tie-breaker after the meeting's date.
    pos: dict[str, int] = {}
    if results:
        res = await db.execute(select(MeetingIntelligenceItem.id, MeetingIntelligenceItem.position).where(
            MeetingIntelligenceItem.id.in_([r.ref.removeprefix("item:") for r in results])))
        pos = {f"item:{i}": p for i, p in res.all()}
    order = lambda r: (r.meeting.started_at, pos.get(r.ref, 0), r.ref)
    titles: dict[str, str] = {}
    booking_ids = [s.scheduled_meeting_id for s in sessions if s.scheduled_meeting_id]
    if booking_ids:
        res = await db.execute(select(ScheduledMeeting.id, ScheduledMeeting.title).where(ScheduledMeeting.id.in_(booking_ids)))
        titles = dict(res.all())
    attended = {s.id: await repo.attended(db, s.id, email) for s in sessions}

    of = lambda t: [r for r in results if r.item_type == t]
    decisions = []
    for r in _pick(of(ITEM_DECISION), MAX_DECISIONS, order):
        e = _entry(r)
        e["rationale"] = r.details.get("rationale")
        e["recordedChange"] = bool(_CHANGE.search(f"{r.text} {e['rationale'] or ''}"))
        decisions.append(e)
    yours = lambda r: (r.details.get("ownerEmail") or "").strip().lower() == email
    commitments = []
    for r in _pick(of(ITEM_COMMITMENT), MAX_COMMITMENTS, order, first=yours):
        e = _entry(r)
        e.update(action=r.details.get("action"), ownerEmail=r.details.get("ownerEmail"),
                 deadline=r.details.get("deadline"), isYours=yours(r))
        commitments.append(e)
    # Open loops: one group per normalized text, each recording meeting kept in order.
    groups: dict[str, list] = {}
    for r in sorted(of(ITEM_OPEN_LOOP), key=order):
        groups.setdefault(_fold(r.text), []).append(r)
    ranked = sorted(
        groups.values(),
        key=lambda g: (all(r.review_state == REVIEW_SUGGESTED for r in g), -g[-1].meeting.started_at.timestamp(), order(g[-1])),
    )[:MAX_OPEN_LOOPS]
    open_loops = []
    for g in sorted(ranked, key=lambda g: order(g[-1])):
        e = _entry(g[-1])  # the latest accessible meeting that recorded it
        e["kind"] = g[-1].details.get("kind")
        e["recorded"] = [{"sessionId": r.meeting.session_id, "itemId": r.ref.removeprefix("item:"),
                          "at": _iso(r.meeting.started_at)} for r in g]
        open_loops.append(e)
    key_context = [_entry(r) for r in _pick(of(ITEM_KEY_POINT), MAX_KEY_CONTEXT, order)]

    return {
        "sources": await _sources(db, sessions, relations, titles, attended, results, omitted),
        "decisions": decisions,
        "commitments": commitments,
        "openLoops": open_loops,
        "keyContext": key_context,
    }


def _useful(body: dict) -> bool:
    return any(body[k] for k in ("decisions", "commitments", "openLoops", "keyContext"))


async def briefing(db: AsyncSession, booking_id: str, email: str, *, now: datetime | None = None) -> dict | None:
    """The caller's briefing for one upcoming booking, or None when they may not see that booking."""
    email = repo.normalize_email(email or "")
    if not email:
        return None
    b = await _booking(db, booking_id, email, now or _now())
    if b is None:
        return None
    body = await _compose(db, b, email)
    return {
        "meeting": {"id": b.id, "title": b.title, "roomId": b.room_id, "startsAt": _iso(b.starts_at),
                    "endsAt": _iso(b.ends_at), "isPrivate": b.is_private},
        "available": _useful(body),
        **body,
    }


async def availability(db: AsyncSession, booking_ids, email: str, *, now: datetime | None = None) -> list[str]:
    """Which of these bookings have a briefing worth opening for the caller. A booking they are not on is
    simply absent — the same answer as one with no useful history."""
    email = repo.normalize_email(email or "")
    at = now or _now()
    out = []
    for bid in list(dict.fromkeys(b for b in booking_ids if isinstance(b, str)))[:MAX_AVAILABILITY_IDS]:
        b = await _booking(db, bid, email, at) if email else None
        if b is not None and _useful(await _compose(db, b, email)):
            out.append(b.id)
    return out
