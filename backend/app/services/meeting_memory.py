from __future__ import annotations

import base64
import binascii
import json
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_intelligence import (
    ITEM_COMMITMENT,
    ITEM_DECISION,
    ITEM_OPEN_LOOP,
    ITEM_SUMMARY,
    REVIEW_EDITED,
    REVIEW_REJECTED,
    RUN_SUCCEEDED,
    MeetingIntelligenceItem,
    MeetingIntelligenceRun,
)
from app.models.meeting_session import MeetingSession, MeetingSessionAttendance
from app.models.scheduled_meeting import ScheduledMeeting
from app.repositories import meeting_sessions as repo
from app.services import meeting_access
from app.services.meeting_intelligence import current_transcript, effective_content, fingerprint
from app.services.meeting_receipt import _aware, _iso

# PHASE 8A — MEETING MEMORY: the permission-safe way an employee finds and returns to the ended Meeting
# Sessions they may read. The Meeting Receipt stays the atomic memory object; this only DISCOVERS it — a
# page of rows with a compact preview, never a second Receipt.
#
# ACCESS IS meeting_access, NOTHING ELSE. The SQL below runs only over meeting_access.candidate_ids (the
# same rules, as a narrowing query), so filtering, search and paging never touch another employee's
# meetings; then EVERY row of the page goes through meeting_access.readable before any booking,
# attendance or intelligence for it is loaded. Nothing is fetched broadly and hidden later. The room is a
# column you can narrow by (`room_id`, the Room Details seam) and a word you can search — never a grant.
#
# ATTENDED vs SHARED. `viewer.attended` is the attendance intervals only. An invitation is not attendance,
# and an invited-but-absent employee's memory is listed, not hidden.
#
# PREVIEW = the latest SUCCEEDED run, read with the Receipt's effective-content rule (edited → the human's
# wording). Rejected items are not active intelligence: they are neither previewed, counted nor searched.
# `stale` is the Receipt's own fingerprint comparison. No intelligence → `intelligence: None`; nothing is
# generated here.
#
# PAGING is a keyset over (ended_at DESC, id ASC) with an opaque cursor. There is no total count.

PAGE_SIZE = 20
MAX_PAGE = 50
MAX_QUERY = 100
FILTERS = frozenset({"all", "attended", "absent"})
_SUMMARY_CHARS = 220
_LINE_CHARS = 160


class MemoryQueryError(ValueError):
    """A malformed request (bad cursor/filter/query) — a stable code, never data."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _encode_cursor(ended_at: datetime, session_id: str) -> str:
    raw = json.dumps([_iso(ended_at), session_id], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        ended, sid = json.loads(raw)
        at = datetime.fromisoformat(ended)
        if not isinstance(sid, str) or not sid:
            raise ValueError
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        raise MemoryQueryError("invalid_cursor") from None
    return (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).astimezone(timezone.utc), sid


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _clip(text: str | None, n: int) -> str | None:
    if not text:
        return None
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _effective_text_sql():
    """The item's effective `text` in SQL — edited → the human's, else the generated (see effective_content)."""
    generated = MeetingIntelligenceItem.content["text"].as_string()
    reviewed = MeetingIntelligenceItem.reviewed_content["text"].as_string()
    return case(
        (MeetingIntelligenceItem.review_state == REVIEW_EDITED, func.coalesce(reviewed, generated)),
        else_=generated,
    )


def _search_clause(pattern: str):
    """A session matches on its booking title, its room, an ACTUAL attendee, or the effective text of an
    active item in its latest succeeded run. Correlated to MeetingSession; only ever evaluated inside the
    candidate set."""
    title = exists().where(
        ScheduledMeeting.id == MeetingSession.scheduled_meeting_id,
        func.lower(ScheduledMeeting.title).like(pattern, escape="\\"),
    )
    attendee = exists().where(
        MeetingSessionAttendance.session_id == MeetingSession.id,
        func.lower(MeetingSessionAttendance.email).like(pattern, escape="\\"),
    )
    latest = (
        select(func.max(MeetingIntelligenceRun.version))
        .where(
            MeetingIntelligenceRun.meeting_session_id == MeetingSession.id,
            MeetingIntelligenceRun.status == RUN_SUCCEEDED,
        )
        .correlate(MeetingSession)
        .scalar_subquery()
    )
    intelligence = exists().where(
        MeetingIntelligenceRun.meeting_session_id == MeetingSession.id,
        MeetingIntelligenceRun.status == RUN_SUCCEEDED,
        MeetingIntelligenceRun.version == latest,
        MeetingIntelligenceItem.run_id == MeetingIntelligenceRun.id,
        MeetingIntelligenceItem.review_state != REVIEW_REJECTED,
        func.lower(_effective_text_sql()).like(pattern, escape="\\"),
    )
    room = func.lower(func.coalesce(MeetingSession.room_id, "")).like(pattern, escape="\\")
    return or_(title, room, attendee, intelligence)


async def _page_ids(
    db: AsyncSession, email: str, *, q: str, filter: str, room_id: str | None, after: tuple[datetime, str] | None, limit: int
) -> list[tuple[str, datetime]]:
    candidates = meeting_access.candidate_ids(email)
    stmt = select(MeetingSession.id, MeetingSession.ended_at).where(
        MeetingSession.id.in_(select(candidates.c.sid)), MeetingSession.ended_at.is_not(None)
    )
    if room_id:
        stmt = stmt.where(MeetingSession.room_id == room_id)
    mine = exists().where(
        MeetingSessionAttendance.session_id == MeetingSession.id, MeetingSessionAttendance.email == email
    )
    if filter == "attended":
        stmt = stmt.where(mine)
    elif filter == "absent":
        stmt = stmt.where(~mine)
    if q:
        stmt = stmt.where(_search_clause(_like(q.lower())))
    if after is not None:
        at, sid = after
        stmt = stmt.where(
            or_(MeetingSession.ended_at < at, and_(MeetingSession.ended_at == at, MeetingSession.id > sid))
        )
    rows = await db.execute(stmt.order_by(MeetingSession.ended_at.desc(), MeetingSession.id).limit(limit + 1))
    return [(r[0], _aware(r[1])) for r in rows.all()]


def _preview(run: MeetingIntelligenceRun, items: list[MeetingIntelligenceItem], stale: bool) -> dict:
    active = [i for i in items if i.review_state != REVIEW_REJECTED]
    summary = next((i for i in active if i.item_type == ITEM_SUMMARY), None)
    decisions = [i for i in active if i.item_type == ITEM_DECISION]
    return {
        "runVersion": run.version,
        "generatedAt": _iso(run.completed_at),
        "stale": stale,
        "summary": (
            {"text": _clip(effective_content(summary).get("text"), _SUMMARY_CHARS), "reviewState": summary.review_state}
            if summary is not None
            else None
        ),
        "decisions": [
            {"text": _clip(effective_content(d).get("text"), _LINE_CHARS), "reviewState": d.review_state}
            for d in decisions[:2]
        ],
        "counts": {
            "decisions": len(decisions),
            "commitments": sum(1 for i in active if i.item_type == ITEM_COMMITMENT),
            "openLoops": sum(1 for i in active if i.item_type == ITEM_OPEN_LOOP),
        },
        # How much of the active intelligence a human has confirmed or edited; the rest is VO-suggested.
        "reviewedCount": sum(1 for i in active if i.review_state != "suggested"),
        "activeCount": len(active),
    }


def _match(q: str, title: str | None, room_id: str | None, emails: list[str], items: list[MeetingIntelligenceItem]):
    """Why a searched row matched — the same dimensions as the SQL, most meaningful first."""
    if not q:
        return None
    if title and q in title.lower():
        return {"kind": "title"}
    for i in items:
        if i.review_state == REVIEW_REJECTED:
            continue
        text = effective_content(i).get("text") or ""
        if q in text.lower():
            return {"kind": "intelligence", "itemType": i.item_type, "reviewState": i.review_state,
                    "text": _clip(text, _LINE_CHARS)}
    who = next((e for e in emails if q in e.lower()), None)
    if who:
        return {"kind": "attendee", "email": who}
    if room_id and q in room_id.lower():
        return {"kind": "room"}
    return None


async def library(
    db: AsyncSession,
    email: str,
    *,
    q: str = "",
    filter: str = "all",
    room_id: str | None = None,
    cursor: str | None = None,
    limit: int = PAGE_SIZE,
) -> dict:
    """One page of the caller's Meeting Memory, newest ended first. `nextCursor` is None on the last page."""
    email = repo.normalize_email(email or "")
    q = " ".join((q or "").split())
    if filter not in FILTERS:
        raise MemoryQueryError("invalid_filter")
    if len(q) > MAX_QUERY:
        raise MemoryQueryError("invalid_query")
    after = _decode_cursor(cursor) if cursor else None
    limit = max(1, min(int(limit), MAX_PAGE))
    if not email:
        return {"sessions": [], "nextCursor": None}

    page = await _page_ids(db, email, q=q, filter=filter, room_id=(room_id or "").strip() or None, after=after, limit=limit)
    more = len(page) > limit
    page = page[:limit]
    # The cursor follows the last row the SQL gave, not the last one the gate kept, so a row the gate
    # refuses can never pin a caller on the same page.
    next_cursor = _encode_cursor(page[-1][1], page[-1][0]) if more and page else None

    # THE GATE, per row, before anything about the session is loaded.
    sessions: list[MeetingSession] = []
    for sid, _ in page:
        s = await meeting_access.readable(db, sid, email)
        if s is not None:
            sessions.append(s)
    if not sessions:
        return {"sessions": [], "nextCursor": next_cursor}
    ids = [s.id for s in sessions]

    # Content for approved ids only, one query per kind (no per-row N+1 except the stale fingerprint).
    booking_ids = [s.scheduled_meeting_id for s in sessions if s.scheduled_meeting_id]
    titles: dict[str, str] = {}
    if booking_ids:
        rows = await db.execute(select(ScheduledMeeting.id, ScheduledMeeting.title).where(ScheduledMeeting.id.in_(booking_ids)))
        titles = {r[0]: r[1] for r in rows.all()}
    attendance: dict[str, list[str]] = defaultdict(list)
    rows = await db.execute(
        select(MeetingSessionAttendance.session_id, MeetingSessionAttendance.email)
        .where(MeetingSessionAttendance.session_id.in_(ids))
        .order_by(MeetingSessionAttendance.joined_at)
    )
    for sid, who in rows.all():
        if who not in attendance[sid]:
            attendance[sid].append(who)
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
            .where(MeetingIntelligenceItem.run_id.in_([r.id for r in latest.values()]))
            .order_by(MeetingIntelligenceItem.position)
        )
        for it in rows.scalars():
            items[it.run_id].append(it)

    ql = q.lower()
    out = []
    for s in sessions:
        run = latest.get(s.id)
        run_items = items.get(run.id, []) if run is not None else []
        stale = run is not None and fingerprint(await current_transcript(db, s.id)) != run.source_fingerprint
        started, ended = _aware(s.started_at), _aware(s.ended_at)
        title = titles.get(s.scheduled_meeting_id) if s.scheduled_meeting_id else None
        emails = attendance.get(s.id, [])
        out.append(
            {
                "sessionId": s.id,
                "kind": s.kind,
                "isPrivate": s.is_private,
                "roomId": s.room_id,
                "title": title,
                "startedAt": _iso(started),
                "endedAt": _iso(ended),
                "durationMs": int((ended - started).total_seconds() * 1000),
                "attendeeCount": len(emails),
                "viewer": {"attended": email in emails},
                "intelligence": _preview(run, run_items, stale) if run is not None else None,
                "match": _match(ql, title, s.room_id, emails, run_items),
            }
        )
    return {"sessions": out, "nextCursor": next_cursor}
