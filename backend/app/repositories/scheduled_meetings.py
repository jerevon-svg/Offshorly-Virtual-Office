from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_meeting import ScheduledMeeting, ScheduledMeetingInvitee

# Queries only. Every rule (validation, conflicts, privacy, authorization) lives in
# services/scheduled_meetings.py; every datetime handed in here is already UTC.

SCHEDULED = "scheduled"
CANCELLED = "cancelled"


async def get(session: AsyncSession, meeting_id: str) -> ScheduledMeeting | None:
    return await session.get(ScheduledMeeting, meeting_id)


async def invitees_by_meeting(session: AsyncSession, meeting_ids: list[str]) -> dict[str, list[ScheduledMeetingInvitee]]:
    out: dict[str, list[ScheduledMeetingInvitee]] = {mid: [] for mid in meeting_ids}
    if not meeting_ids:
        return out
    rows = await session.execute(
        select(ScheduledMeetingInvitee)
        .where(ScheduledMeetingInvitee.meeting_id.in_(meeting_ids))
        .order_by(ScheduledMeetingInvitee.created_at, ScheduledMeetingInvitee.email)
    )
    for inv in rows.scalars():
        out[inv.meeting_id].append(inv)
    return out


async def invitee(session: AsyncSession, meeting_id: str, email: str) -> ScheduledMeetingInvitee | None:
    row = await session.execute(
        select(ScheduledMeetingInvitee).where(
            ScheduledMeetingInvitee.meeting_id == meeting_id, ScheduledMeetingInvitee.email == email
        )
    )
    return row.scalar_one_or_none()


async def first_conflict(
    session: AsyncSession, *, room_id: str, starts_at: datetime, ends_at: datetime, exclude_id: str | None = None
) -> ScheduledMeeting | None:
    """A standing booking of this room that OVERLAPS [starts_at, ends_at). Half-open on both sides,
    so a booking that ends exactly when another starts is not a conflict."""
    q = select(ScheduledMeeting).where(
        ScheduledMeeting.room_id == room_id,
        ScheduledMeeting.status == SCHEDULED,
        ScheduledMeeting.starts_at < ends_at,
        ScheduledMeeting.ends_at > starts_at,
    )
    if exclude_id is not None:
        q = q.where(ScheduledMeeting.id != exclude_id)
    row = await session.execute(q.order_by(ScheduledMeeting.starts_at).limit(1))
    return row.scalar_one_or_none()


async def booked_room_ids(session: AsyncSession, *, starts_at: datetime, ends_at: datetime) -> set[str]:
    rows = await session.execute(
        select(ScheduledMeeting.room_id).where(
            ScheduledMeeting.status == SCHEDULED,
            ScheduledMeeting.starts_at < ends_at,
            ScheduledMeeting.ends_at > starts_at,
        )
    )
    return set(rows.scalars())


async def standing_in_window(session: AsyncSession, *, starts_at: datetime, ends_at: datetime) -> list[ScheduledMeeting]:
    """Every standing booking on the floor that overlaps the window, by room then time."""
    rows = await session.execute(
        select(ScheduledMeeting)
        .where(
            ScheduledMeeting.status == SCHEDULED,
            ScheduledMeeting.starts_at < ends_at,
            ScheduledMeeting.ends_at > starts_at,
        )
        .order_by(ScheduledMeeting.starts_at, ScheduledMeeting.room_id)
    )
    return list(rows.scalars())


async def mine(
    session: AsyncSession, *, email: str, starts_at: datetime, ends_at: datetime | None
) -> list[ScheduledMeeting]:
    """Standing meetings this person is invited to (organizer included) that have not ended by
    `starts_at`, optionally bounded above."""
    q = (
        select(ScheduledMeeting)
        .join(ScheduledMeetingInvitee, ScheduledMeetingInvitee.meeting_id == ScheduledMeeting.id)
        .where(
            ScheduledMeetingInvitee.email == email,
            ScheduledMeeting.status == SCHEDULED,
            ScheduledMeeting.ends_at > starts_at,
        )
    )
    if ends_at is not None:
        q = q.where(ScheduledMeeting.starts_at < ends_at)
    rows = await session.execute(q.order_by(ScheduledMeeting.starts_at))
    return list(rows.scalars())


async def governing(session: AsyncSession, *, room_id: str, at: datetime, lead_from: datetime) -> ScheduledMeeting | None:
    """The standing booking whose ACCESS WINDOW contains `at`: it has not ended, and it starts no later
    than `lead_from` (= at + the access lead). With back-to-back bookings the earlier one wins until it
    ends — a booking never takes a room from the one before it."""
    row = await session.execute(
        select(ScheduledMeeting)
        .where(
            ScheduledMeeting.room_id == room_id,
            ScheduledMeeting.status == SCHEDULED,
            ScheduledMeeting.starts_at <= lead_from,
            ScheduledMeeting.ends_at > at,
        )
        .order_by(ScheduledMeeting.starts_at)
        .limit(1)
    )
    return row.scalar_one_or_none()


async def starting_between(session: AsyncSession, *, after: datetime, until: datetime) -> list[ScheduledMeeting]:
    """Standing bookings that start in (after, until] — the reminder sweep's window."""
    rows = await session.execute(
        select(ScheduledMeeting)
        .where(
            ScheduledMeeting.status == SCHEDULED,
            ScheduledMeeting.starts_at > after,
            ScheduledMeeting.starts_at <= until,
        )
        .order_by(ScheduledMeeting.starts_at)
    )
    return list(rows.scalars())
