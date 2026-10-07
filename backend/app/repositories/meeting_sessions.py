from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_session import MeetingSession, MeetingSessionAttendance, MeetingSessionGrant

# PHASE 6A — plain persistence for Meeting Sessions. No rules live here: WHEN a session opens or closes is
# services/meeting_sessions.py's decision, and WHO may read one is services/meeting_access.py's. Nothing in
# this module commits; the caller owns the transaction.


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def get(session: AsyncSession, session_id: str) -> MeetingSession | None:
    return await session.get(MeetingSession, session_id)


async def create(
    session: AsyncSession,
    *,
    session_id: str,
    meeting_key: str,
    room_id: str | None,
    scheduled_meeting_id: str | None,
    kind: str,
    is_private: bool,
    started_by_email: str,
    started_at: datetime,
) -> MeetingSession:
    row = MeetingSession(
        id=session_id,
        meeting_key=meeting_key,
        room_id=room_id,
        scheduled_meeting_id=scheduled_meeting_id,
        kind=kind,
        is_private=is_private,
        started_by_email=normalize_email(started_by_email),
        started_at=started_at,
    )
    session.add(row)
    await session.flush()
    return row


async def close(session: AsyncSession, session_id: str, *, at: datetime, reason: str) -> None:
    """Close the session and every attendance interval still open in it. Idempotent: a session already
    closed keeps its original end."""
    await session.execute(
        update(MeetingSessionAttendance)
        .where(MeetingSessionAttendance.session_id == session_id, MeetingSessionAttendance.left_at.is_(None))
        .values(left_at=at)
    )
    await session.execute(
        update(MeetingSession)
        .where(MeetingSession.id == session_id, MeetingSession.ended_at.is_(None))
        .values(ended_at=at, end_reason=reason)
    )


async def close_all_open(session: AsyncSession, *, at: datetime, reason: str) -> int:
    """Startup recovery: every session still open belongs to a process that no longer exists."""
    ids = list((await session.execute(select(MeetingSession.id).where(MeetingSession.ended_at.is_(None)))).scalars())
    for session_id in ids:
        await close(session, session_id, at=at, reason=reason)
    return len(ids)


# ---- attendance ----------------------------------------------------------------------------------


async def open_attendance(session: AsyncSession, session_id: str, email: str, *, at: datetime) -> None:
    """Start an interval, unless this person already has one open here (never two at once)."""
    email = normalize_email(email)
    existing = await session.execute(
        select(MeetingSessionAttendance.id).where(
            MeetingSessionAttendance.session_id == session_id,
            MeetingSessionAttendance.email == email,
            MeetingSessionAttendance.left_at.is_(None),
        )
    )
    if existing.first() is None:
        session.add(MeetingSessionAttendance(session_id=session_id, email=email, joined_at=at))


async def close_attendance(session: AsyncSession, session_id: str, email: str, *, at: datetime) -> None:
    await session.execute(
        update(MeetingSessionAttendance)
        .where(
            MeetingSessionAttendance.session_id == session_id,
            MeetingSessionAttendance.email == normalize_email(email),
            MeetingSessionAttendance.left_at.is_(None),
        )
        .values(left_at=at)
    )


async def attendance(session: AsyncSession, session_id: str) -> list[MeetingSessionAttendance]:
    rows = await session.execute(
        select(MeetingSessionAttendance)
        .where(MeetingSessionAttendance.session_id == session_id)
        .order_by(MeetingSessionAttendance.joined_at, MeetingSessionAttendance.email)
    )
    return list(rows.scalars())


async def attended(session: AsyncSession, session_id: str, email: str) -> bool:
    row = await session.execute(
        select(MeetingSessionAttendance.id).where(
            MeetingSessionAttendance.session_id == session_id,
            MeetingSessionAttendance.email == normalize_email(email),
        ).limit(1)
    )
    return row.first() is not None


# ---- grants --------------------------------------------------------------------------------------


async def add_grant(session: AsyncSession, session_id: str, email: str, *, reason: str) -> None:
    """Idempotent: the first reason somebody was authorized for wins."""
    email = normalize_email(email)
    existing = await session.execute(
        select(MeetingSessionGrant.id).where(
            MeetingSessionGrant.session_id == session_id, MeetingSessionGrant.email == email
        )
    )
    if existing.first() is None:
        session.add(MeetingSessionGrant(session_id=session_id, email=email, reason=reason))
        await session.flush()


async def has_grant(session: AsyncSession, session_id: str, email: str) -> bool:
    row = await session.execute(
        select(MeetingSessionGrant.id).where(
            MeetingSessionGrant.session_id == session_id,
            MeetingSessionGrant.email == normalize_email(email),
        )
    )
    return row.first() is not None
