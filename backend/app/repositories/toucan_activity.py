from __future__ import annotations

from datetime import datetime, timezone
from collections.abc import Iterable
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_event import EVENT_CALL_MISSED, ActivityEvent
from app.models.conversation import Conversation, ConversationParticipant
from app.models.message import Message
from app.models.toucan import ToucanAttentionCursor
from app.repositories import hub as hub_repo

# Toucan T2 — THE VIEWER-SCOPED ACTIVITY QUERY LAYER.
#
# WHERE THIS SITS. The T0/T1 boundary is intentional and unchanged: app/services/toucan/ still
# owns no storage — it cannot import a session, a model or sqlalchemy, and
# tests/test_toucan_privacy.py enforces that statically. So the shape is:
#
#     router  ->  THIS MODULE (viewer-scoped counting)  ->  a content-free snapshot dict
#             ->  services/toucan/activity.py (pure dataclass)
#             ->  services/toucan/office_assistant.py (deterministic wording)
#
# This module is deliberately NOT part of the Toucan answer-building package, because it is the
# one place allowed to touch the chat and Hub tables. That access is why it is quarantined in
# its own module with its own rules, rather than let anywhere near context.py.
#
# THE RULES, in order of importance:
#
#   1. EVERY QUERY IS SCOPED TO ONE VIEWER, in the SQL itself, and the viewer is always the
#      server-derived caller. There is no helper here that omits the viewer, so an unscoped
#      count cannot be written by accident.
#
#   2. ONLY COUNTS AND TIMESTAMPS LEAVE THIS MODULE. `attention_snapshot` returns five integers
#      and two timestamps. No message text, no conversation ids, no titles, no participant
#      lists, no sender names, no Hub item bodies. Nothing that flows out of here could
#      reconstruct WHAT was said, only HOW MUCH there was.
#
#   3. ARRIVAL AND DEPARTURE ARE NOT THE SAME OPERATION. Only an arrival may freeze an absence
#      boundary; a departure only ever records a candidate. See _touch.
#
#   4. NO NEW SOURCE OF TRUTH. Chat and Hub numbers are computed from the tables that already
#      own those facts. The only thing written down specially is a missed call, because nothing
#      else in the system survives a restart knowing one happened (see models/activity_event.py).
#
#   5. NOTHING IS CACHED, LOGGED OR PERSISTED. Every count is derived per request.


# How long a person has to be unseen before their return counts as "coming back from being
# away" rather than a reconnect. A page refresh, a dropped wifi second, a laptop lid closed for
# a minute — none of those should throw away the real absence boundary and reset the window to
# "nothing happened". Five minutes is comfortably longer than any reconnect and far shorter
# than any real absence.
ABSENCE_GAP_SECONDS = 300

# Hub priorities that count as needing attention. Mirrors app/repositories/hub.py's ranking —
# "normal" is ordinary content, the other two are what the Hub itself treats as pressing.
_ATTENTION_HUB_PRIORITIES = frozenset({"required", "important"})

# Why the snapshot's `since` is what it is. Surfaced so the wording layer can be honest about
# which of the three it is looking at instead of claiming "while you were away" in every case.
#   "last_active"      -> a real observed absence; since = when they were last seen before it
#   "tracking_started" -> we have seen them, but never yet observed an absence; since = the
#                         moment this person's cursor row was first created
#   "no_history"       -> we have never seen them at all (no cursor row); since = now, so every
#                         count is honestly zero rather than invented
SINCE_LAST_ACTIVE = "last_active"
SINCE_TRACKING_STARTED = "tracking_started"
SINCE_NO_HISTORY = "no_history"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(dt: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes for DateTime(timezone=True) columns; Postgres hands
    back aware ones. Same normalization app/repositories/chat.py does for its watermarks."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def normalize_email(email: str) -> str:
    return email.strip().lower()


# --- the absence window --------------------------------------------------------------------


async def _get_cursor(session: AsyncSession, email: str) -> ToucanAttentionCursor | None:
    result = await session.execute(
        select(ToucanAttentionCursor).where(ToucanAttentionCursor.email == email)
    )
    return result.scalar_one_or_none()


async def _touch(
    session: AsyncSession, *, email: str, moment: datetime, detect_gap: bool
) -> dict[str, Any]:
    """Move a person's cursor to `moment`, optionally freezing the absence boundary first.

    `detect_gap` is the whole difference between the two public helpers below, and it is a
    difference of DIRECTION, not of degree:

      * On ARRIVAL, the distance between the stored last_seen_at and now IS the absence. Long
        distance, real absence, freeze the boundary.
      * On DEPARTURE, that same distance is just how long the person was HERE. An eight-hour
        working day and an eight-hour absence look identical to the arithmetic, so a departure
        must never be allowed to run it — doing so would freeze away_since at the moment the
        session STARTED and report a whole day's activity as missed."""
    row = await _get_cursor(session, email)
    absence_detected = False
    if row is None:
        # First sighting ever. There is no absence to record — we cannot claim somebody was
        # away during a period we were not watching them.
        row = ToucanAttentionCursor(email=email, last_seen_at=moment, away_since=None)
        session.add(row)
    else:
        if detect_gap:
            previous = _as_aware_utc(row.last_seen_at)
            if previous is not None and (moment - previous).total_seconds() >= ABSENCE_GAP_SECONDS:
                row.away_since = previous
                absence_detected = True
        row.last_seen_at = moment

    await session.flush()
    return {
        "email": row.email,
        "last_seen_at": _as_aware_utc(row.last_seen_at),
        "away_since": _as_aware_utc(row.away_since),
        # A2.3: True only on THIS arrival, only when the gap cleared ABSENCE_GAP_SECONDS — the
        # one presence fact strong enough to count as "the owner came back".
        "absence_detected": absence_detected,
    }


async def record_arrival(
    session: AsyncSession, *, email: str, now: datetime | None = None
) -> dict[str, Any]:
    """This person has just turned up: a socket connected, or they checked back in.

    THE ONLY PLACE AN ABSENCE IS EVER FROZEN. If the gap since we last saw them is at least
    ABSENCE_GAP_SECONDS, the stored last_seen_at becomes `away_since` — the durable answer to
    "when did you actually stop being here" — before the cursor moves to now.

    Idempotent under the ~10 sockets one browser opens: the first connect of a returning session
    detects the gap and freezes the boundary; the rest see no gap and only move last_seen_at.
    Two connects racing each other read the same stale last_seen_at and therefore compute the
    same boundary, so the outcome does not depend on which wins."""
    return await _touch(
        session, email=normalize_email(email), moment=now or _utc_now(), detect_gap=True
    )


async def record_departure(
    session: AsyncSession, *, email: str, now: datetime | None = None
) -> dict[str, Any]:
    """This person has just stopped being here: their LAST socket went away, or they explicitly
    checked out.

    Writes a DEPARTURE CANDIDATE and nothing else — last_seen_at moves to now, and no boundary
    is frozen (see _touch on why a departure must never gap-detect). The candidate only becomes
    an absence if they stay gone: the next record_arrival compares against it, and a return
    inside ABSENCE_GAP_SECONDS — a refresh, a flaky second of network, a reconnect — simply
    moves the cursor forward again with no absence recorded.

    This is what makes "closed the laptop at 17:00, came back the next morning" measure from
    17:00 rather than from whenever that session happened to start. Note it needs no heartbeat
    of its own: engine.io already tears a dead connection down on its own ping timeout, so a
    lid-close reaches the socket layer's disconnect handler by itself."""
    return await _touch(
        session, email=normalize_email(email), moment=now or _utc_now(), detect_gap=False
    )


async def attention_window(
    session: AsyncSession, *, viewer_email: str, now: datetime | None = None
) -> tuple[datetime, str]:
    """The (since, reason) pair every count below is measured against. See the SINCE_* constants
    for exactly what each reason means — the reason travels all the way to the wording layer so
    a user is never told "while you were away" about a window that means something else."""
    moment = now or _utc_now()
    row = await _get_cursor(session, normalize_email(viewer_email))
    if row is None:
        return moment, SINCE_NO_HISTORY
    away_since = _as_aware_utc(row.away_since)
    if away_since is not None:
        return away_since, SINCE_LAST_ACTIVE
    created_at = _as_aware_utc(row.created_at) or moment
    return created_at, SINCE_TRACKING_STARTED


# --- the counts ----------------------------------------------------------------------------


def _viewer_message_conditions(viewer_email: str, since: datetime) -> list[Any]:
    """The one predicate that makes chat counting safe: a message is only counted when the
    viewer is a PARTICIPANT of its conversation, checked against conversation_participants in
    the same statement. A viewer can therefore never be handed a number derived from a
    conversation they are not in, and — because only counts leave this module — a number they
    are entitled to tells them nothing about its contents."""
    return [
        Message.sender_email != viewer_email,
        Message.sent_at > since,
        Message.conversation_id.in_(
            select(ConversationParticipant.conversation_id).where(
                ConversationParticipant.participant_email == viewer_email
            )
        ),
    ]


async def _chat_count(session: AsyncSession, viewer_email: str, since: datetime) -> int:
    """Messages from OTHER people, in the viewer's own conversations, since the window opened.

    Deliberately time-window based rather than read-receipt based: `last_read_at` is per
    conversation and answers "what is still unread", which is a different question from "what
    arrived while I was gone" (a message read on a phone would vanish from the count, and a
    conversation never opened would count messages from months ago)."""
    result = await session.execute(
        select(func.count())
        .select_from(Message)
        .where(and_(*_viewer_message_conditions(viewer_email, since)))
    )
    return int(result.scalar_one())


async def _mention_count(session: AsyncSession, viewer_email: str, since: datetime) -> int:
    """The subset of the above that named the viewer.

    Reads ONE column — the server-validated mentioned_emails list written at insert time (see
    repositories/chat.py's insert_message), never the message text — and filters it in Python
    rather than with a DB-specific JSON containment operator, keeping this portable across
    SQLite and Postgres exactly as chat.py's own _compute_mention_count does.

    THE PYTHON GUARD IS THE AUTHORITY, not the SQL. A JSON column stores a Python None as the
    JSON value `null`, not as SQL NULL (SQLAlchemy's none_as_null defaults to False), so an
    `IS NOT NULL` predicate here would filter out almost nothing — only the genuinely-NULL rows
    written before @mentions existed. It is left off rather than left in with a comment claiming
    a narrowing it does not perform; the falsy check below is what actually excludes a message
    that mentioned nobody, and it is correct for both storage shapes."""
    conditions = _viewer_message_conditions(viewer_email, since)
    result = await session.execute(select(Message.mentioned_emails).where(and_(*conditions)))
    return sum(1 for (mentioned,) in result.all() if mentioned and viewer_email in mentioned)


async def _missed_call_count(session: AsyncSession, viewer_email: str, since: datetime) -> int:
    """Rings that ended without the viewer answering — the one fact with no other durable home.
    Scoped to `subject_email`, which is the permission key: an event about somebody else is
    unreachable from here."""
    result = await session.execute(
        select(func.count())
        .select_from(ActivityEvent)
        .where(
            ActivityEvent.subject_email == viewer_email,
            ActivityEvent.event_type == EVENT_CALL_MISSED,
            ActivityEvent.created_at > since,
        )
    )
    return int(result.scalar_one())


async def _hub_counts(
    session: AsyncSession, viewer_email: str, since: datetime, now: datetime
) -> tuple[int, int]:
    """(new Hub items, of which pressing) — items that appeared during the window and that the
    viewer has not opened.

    AUDIENCE IS NOT RE-IMPLEMENTED. repositories/hub.py's list_active_items_for is the existing
    authority on what a given employee may see (active date range, audience_email IS NULL or
    theirs) and is called here rather than copied, so a future change to Hub visibility cannot
    leave Toucan counting items the Hub itself would hide.

    Two further narrowings on top of that: the item must have STARTED inside the window, and the
    viewer must have no hub_item_states row for it — something they already looked at during a
    brief return is not something they need telling about."""
    items = await hub_repo.list_active_items_for(session, viewer_email, now=now)
    fresh = [i for i in items if (_as_aware_utc(i["start_at"]) or now) > since]
    if not fresh:
        return 0, 0

    seen_ids = set(
        (await hub_repo.get_states_for(session, viewer_email, [i["id"] for i in fresh])).keys()
    )
    unseen = [i for i in fresh if i["id"] not in seen_ids]
    pressing = sum(1 for i in unseen if i["priority"] in _ATTENTION_HUB_PRIORITIES)
    return len(unseen), pressing


async def attention_snapshot(
    session: AsyncSession, *, viewer_email: str, now: datetime | None = None
) -> dict[str, Any]:
    """Everything Toucan is allowed to know about what the viewer missed, as plain numbers.

    Returns a dict rather than a dataclass to match this codebase's repository house style, and
    so the pure dataclass in services/toucan/activity.py can stay storage-free. What comes back
    is the COMPLETE payload — there is no second call that returns detail, because there is no
    detail to return.

    `important_count` is a DERIVED ROLL-UP, not a fifth independent query: mentions + missed
    calls + pressing Hub items. It is the answer to "is there anything I need to check?", and
    ordinary chat volume is deliberately excluded — a busy group conversation is not by itself
    something demanding the viewer's attention."""
    moment = now or _utc_now()
    viewer = normalize_email(viewer_email)
    since, since_reason = await attention_window(session, viewer_email=viewer, now=moment)

    chats = await _chat_count(session, viewer, since)
    mentions = await _mention_count(session, viewer, since)
    missed_calls = await _missed_call_count(session, viewer, since)
    hub_items, pressing_hub_items = await _hub_counts(session, viewer, since, moment)

    return {
        "since": since,
        "since_reason": since_reason,
        "until": moment,
        "chat_count": chats,
        "mention_count": mentions,
        "missed_call_count": missed_calls,
        "hub_count": hub_items,
        "pressing_hub_count": pressing_hub_items,
        "important_count": mentions + missed_calls + pressing_hub_items,
    }


# --- the one write that is not a query -----------------------------------------------------


async def record_missed_call(
    session: AsyncSession,
    *,
    subject_email: str,
    actor_email: str | None = None,
    reference_id: str | None = None,
) -> dict[str, Any]:
    """Record that somebody rang `subject_email` and the ring ended unanswered.

    Called ONLY from app/realtime/socket.py, and only where the recipient demonstrably did not
    answer: the ring timed out, the caller hung up or vanished mid-ring, or the recipient was
    not connected to be rung at all. A decline is NOT a missed call — the recipient was there
    and made a choice — and neither, obviously, is an accept.

    Both emails come from server-held invite state, never from a client payload."""
    row = ActivityEvent(
        event_type=EVENT_CALL_MISSED,
        subject_email=normalize_email(subject_email),
        actor_email=normalize_email(actor_email) if actor_email else None,
        reference_id=reference_id,
    )
    session.add(row)
    await session.flush()
    return {
        "id": row.id,
        "event_type": row.event_type,
        "subject_email": row.subject_email,
        "actor_email": row.actor_email,
        "reference_id": row.reference_id,
        "created_at": _as_aware_utc(row.created_at),
    }


# --- A5: the per-conversation catch-up breakdown -------------------------------------------
#
# Return / Catch-Up asks one thing T2 refused: WHICH conversations, so the owner can open them.
# The refusal stands for the wording layer — services/toucan/ still sees only counts — and the
# ids below travel beside the text at the router, exactly as A3's urgent flags do. What leaves
# here per conversation is metadata only: the id, its type and title, who else is in it (for a
# label), and four numbers. No text, no sender of any particular message, no preview.
#
# COUNTS ARE WINDOW-BASED, exactly as _chat_count's are, and for the same reason (see its
# docstring): the read cursor is a different question, and the Toucan surface deliberately never
# reads or writes it (tests/test_toucan_privacy.py). The chat window's own badge answers "what is
# still unopened"; this answers "what arrived while you were gone". Nothing here writes anything.


async def _viewer_conversation_ids(
    session: AsyncSession, viewer_email: str, candidate_ids: Iterable[str]
) -> set[str]:
    """Of the given ids, the ones the viewer actually participates in. The membership check
    for conversations reached by some route other than a window message (an urgent flag)."""
    ids = [i for i in set(candidate_ids) if i]
    if not ids:
        return set()
    result = await session.execute(
        select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.participant_email == viewer_email,
            ConversationParticipant.conversation_id.in_(ids),
        )
    )
    return {row[0] for row in result.all()}


async def covered_conversation_count(
    session: AsyncSession, *, viewer_email: str, since: datetime, toucan_sender: str
) -> int:
    """How many of the viewer's conversations Toucan itself replied in during the window — the
    one delegation fact that is durably grounded (the replies are ordinary message rows)."""
    viewer = normalize_email(viewer_email)
    conditions = _viewer_message_conditions(viewer, since)
    conditions.append(Message.sender_email == toucan_sender)
    result = await session.execute(
        select(func.count(func.distinct(Message.conversation_id))).where(and_(*conditions))
    )
    return int(result.scalar_one())


async def catchup_rows(
    session: AsyncSession,
    *,
    viewer_email: str,
    since: datetime,
    toucan_sender: str,
    extra_conversation_ids: Iterable[str] = (),
) -> list[dict[str, Any]]:
    """One row per conversation with activity for the viewer since `since`, plus the given extra
    conversations (membership re-verified here) so a flagged conversation is never dropped.

    Each row: conversation_id, type, title, other_participants (emails minus the viewer and
    Toucan), new_count and mention_count (messages from others inside the window), toucan_covered,
    and last_relevant_at (newest message from somebody else in the window, or None). Unordered
    and unfiltered — the router decides relevance and order."""
    viewer = normalize_email(viewer_email)
    conditions = _viewer_message_conditions(viewer, since)
    messages = (
        await session.execute(
            select(
                Message.conversation_id,
                Message.sender_email,
                Message.mentioned_emails,
                Message.sent_at,
            ).where(and_(*conditions))
        )
    ).all()

    conv_ids = {row[0] for row in messages}
    conv_ids |= await _viewer_conversation_ids(session, viewer, extra_conversation_ids)
    if not conv_ids:
        return []

    participants = (
        await session.execute(
            select(ConversationParticipant).where(
                ConversationParticipant.conversation_id.in_(list(conv_ids))
            )
        )
    ).scalars().all()
    others: dict[str, list[str]] = {cid: [] for cid in conv_ids}
    for part in participants:
        if part.participant_email not in (viewer, toucan_sender):
            others[part.conversation_id].append(part.participant_email)

    conversations = (
        await session.execute(select(Conversation).where(Conversation.id.in_(list(conv_ids))))
    ).scalars().all()

    rows: dict[str, dict[str, Any]] = {}
    for conv in conversations:
        rows[conv.id] = {
            "conversation_id": conv.id,
            "type": conv.type,
            "title": conv.title,
            "other_participants": sorted(others.get(conv.id, [])),
            "new_count": 0,
            "mention_count": 0,
            "toucan_covered": False,
            "last_relevant_at": None,
        }

    for conversation_id, sender, mentioned, sent_at in messages:
        row = rows.get(conversation_id)
        if row is None:
            continue
        moment = _as_aware_utc(sent_at)
        if moment is not None and (row["last_relevant_at"] is None or moment > row["last_relevant_at"]):
            row["last_relevant_at"] = moment
        if sender == toucan_sender:
            row["toucan_covered"] = True
        row["new_count"] += 1
        if mentioned and viewer in mentioned:
            row["mention_count"] += 1

    return list(rows.values())
