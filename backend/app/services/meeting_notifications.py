from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app import database as app_db
from app.models.scheduled_meeting import ScheduledMeeting
from app.repositories import scheduled_meetings as repo
from app.services import notifications
from app.services.meeting_floor_rooms import room_by_id

# SCHEDULED MEETINGS V1 — what the bell says about a meeting, and the ONE periodic task that sends the
# 5-minute reminder. Everything goes through services/notifications.py's `notify`, so persistence, the
# live push and — above all — dedupe are the existing ones:
#
#   invited     meeting_invited:<id>                      once per person per meeting
#   updated     meeting_updated:<id>:<updated_at>         once per edit
#   cancelled   meeting_cancelled:<id>                    once
#   reminder    meeting_reminder:<id>:<starts_at>         once per start time — a restart or a second
#                                                          sweep collapses onto the same row, and a
#                                                          meeting moved to a new time reminds again
#
# PRIVACY: every notification here goes only to that meeting's own invitees, and navigates by meeting id
# alone. Nothing about a meeting is ever written to anybody who is not in it.
#
# TIMES ARE NOT RENDERED INTO THE TEXT. The server does not know the reader's timezone; the client shows
# the time from the meeting itself (and so always shows the CURRENT time, not the one at write time).

logger = logging.getLogger(__name__)

REMINDER_LEAD = timedelta(minutes=5)
SWEEP_SECONDS = 20.0


def _room(meeting: ScheduledMeeting) -> str:
    room = room_by_id(meeting.room_id)
    return room.name if room else meeting.room_id


def _iso(dt: datetime) -> str:
    dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    return dt.isoformat(timespec="seconds")


def _nav(meeting: ScheduledMeeting) -> dict:
    return {"meetingId": meeting.id}


async def _each(session: AsyncSession, meeting: ScheduledMeeting, emails: list[str], **kw) -> None:
    for email in emails:
        await notifications.notify(session, recipient=email, nav_kind=notifications.NAV_MEETING, nav_payload=_nav(meeting), **kw)


async def invited(session: AsyncSession, meeting: ScheduledMeeting, emails: list[str]) -> None:
    await _each(
        session, meeting, [e for e in emails if e != meeting.organizer_email],
        type=notifications.TYPE_MEETING_INVITED,
        title=f"Meeting invite: {meeting.title}",
        body=f"{notifications._display_name(meeting.organizer_email)} · Room {_room(meeting)}",
        dedupe_key=f"{notifications.TYPE_MEETING_INVITED}:{meeting.id}",
    )


async def updated(session: AsyncSession, meeting: ScheduledMeeting, emails: list[str]) -> None:
    await _each(
        session, meeting, [e for e in emails if e != meeting.organizer_email],
        type=notifications.TYPE_MEETING_UPDATED,
        title=f"Meeting updated: {meeting.title}",
        body=f"Room {_room(meeting)} · open it for the latest time",
        dedupe_key=f"{notifications.TYPE_MEETING_UPDATED}:{meeting.id}:{_iso(meeting.updated_at)}",
    )


async def cancelled(session: AsyncSession, meeting: ScheduledMeeting, emails: list[str]) -> None:
    await _each(
        session, meeting, [e for e in emails if e != meeting.organizer_email],
        type=notifications.TYPE_MEETING_CANCELLED,
        title=f"Meeting cancelled: {meeting.title}",
        body=f"Room {_room(meeting)} is no longer booked for it",
        dedupe_key=f"{notifications.TYPE_MEETING_CANCELLED}:{meeting.id}",
    )


# ---- the 5-minute reminder -----------------------------------------------------------------------


async def sweep_once(now: datetime | None = None) -> int:
    """Remind every attendee of every standing meeting starting within REMINDER_LEAD. Declined invitees
    and cancelled meetings are never reminded. Returns how many reminders were newly written; a repeat
    sweep writes none (the dedupe key holds the start time)."""
    now = now or datetime.now(timezone.utc)
    sent = 0
    async with app_db.async_session_maker() as session:
        meetings = await repo.starting_between(session, after=now, until=now + REMINDER_LEAD)
        people = await repo.invitees_by_meeting(session, [m.id for m in meetings])
        for m in meetings:
            for inv in people[m.id]:
                if inv.response == "declined":
                    continue
                row = await notifications.notify(
                    session,
                    recipient=inv.email,
                    type=notifications.TYPE_MEETING_REMINDER,
                    title=f"Starting soon: {m.title}",
                    body=f"Room {_room(m)} · Meeting Floor",
                    nav_kind=notifications.NAV_MEETING,
                    nav_payload=_nav(m),
                    dedupe_key=f"{notifications.TYPE_MEETING_REMINDER}:{m.id}:{_iso(m.starts_at)}",
                )
                sent += row is not None
        await session.commit()
    if sent:
        logger.info("meeting reminder sweep sent %d reminder(s)", sent)
    return sent


class MeetingReminderSweeper:
    """The one periodic task, in DelegationSweeper's exact shape. start() is idempotent."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self, interval_seconds: float = SWEEP_SECONDS) -> None:
        if interval_seconds <= 0 or self.running:
            return
        self._task = asyncio.create_task(self._run(interval_seconds), name="meeting-reminder-sweep")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            logger.debug("meeting reminder sweep stopped")
        except Exception:
            logger.exception("meeting reminder sweep task ended with an error")

    async def _run(self, interval: float) -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                await sweep_once()
            except Exception:
                logger.exception("meeting reminder sweep failed")


meeting_reminder_sweeper = MeetingReminderSweeper()
