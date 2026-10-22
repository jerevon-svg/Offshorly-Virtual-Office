from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.realtime.state import offline_lineup, sio
from app.repositories import attendance as attendance_repo
from app.repositories import toucan_delegation as toucan_delegation_repo
from app.repositories.attendance import CHECKED_IN, CHECKED_OUT
from app.schemas.attendance import AttendanceOut
from app.services.delegation_events import emit_delegation_ended
from app.services.quests import EVENT_CHECK_IN, EVENT_CHECK_OUT, record_quest_event

# Attendance = work-session state, server-authoritative and independent of socket connection
# state (see app/models/attendance.py). These routes are the ONLY writers. They also keep the
# in-memory offline lineup (the peers-see-you-on-the-sidewalk signal) in step, so a checked-out
# person stays on the sidewalk for everyone regardless of which tab/socket they later open.
# The socket's go_offline/come_online handlers are left untouched: the client still emits them
# alongside these calls for the presence-cursor bookkeeping they already own.

router = APIRouter(tags=["attendance"])
logger = logging.getLogger(__name__)


async def _broadcast_lineup() -> None:
    await sio.emit("offline_lineup", {"entries": offline_lineup.snapshot()})


@router.get("/attendance/me", response_model=AttendanceOut)
async def get_my_attendance(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> AttendanceOut:
    return AttendanceOut.from_dict(await attendance_repo.get_status(db, email))


@router.post("/attendance/check-in", response_model=AttendanceOut)
async def check_in(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> AttendanceOut:
    before = await attendance_repo.get_status(db, email)
    record = await attendance_repo.check_in(db, email)
    offline_lineup.remove(record["email"])
    await _broadcast_lineup()
    # Quest Foundation: only a REAL CHECKED_OUT → CHECKED_IN transition is an event. A repeated
    # POST (double click, retry) leaves the row untouched above and records nothing here; the key
    # is the session's own start timestamp, so even a replay after a reconnect collapses.
    if before["status"] == CHECKED_OUT and record["status"] == CHECKED_IN and record["checked_in_at"]:
        await record_quest_event(
            db,
            actor_email=record["email"],
            event_type=EVENT_CHECK_IN,
            dedupe_key=f"{record['email']}:{record['checked_in_at'].isoformat()}",
            occurred_at=record["checked_in_at"],
        )
    return AttendanceOut.from_dict(record)


@router.post("/attendance/check-out", response_model=AttendanceOut)
async def check_out(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> AttendanceOut:
    before = await attendance_repo.get_status(db, email)
    record = await attendance_repo.check_out(db, email)
    offline_lineup.add(record["email"])
    await _broadcast_lineup()
    # Quest Foundation: a real CHECKED_IN → CHECKED_OUT transition is the current VO proxy for
    # "completed a time log" (check-out is only reachable through the Log Time flow). Checking
    # out without ever having checked in is not a transition and records nothing.
    if before["status"] == CHECKED_IN and record["status"] == CHECKED_OUT and record["checked_out_at"]:
        await record_quest_event(
            db,
            actor_email=record["email"],
            event_type=EVENT_CHECK_OUT,
            dedupe_key=f"{record['email']}:{record['checked_out_at'].isoformat()}",
            occurred_at=record["checked_out_at"],
        )
    if record["status"] == CHECKED_OUT:
        await _end_delegation_on_checkout(db, record["email"])
    return AttendanceOut.from_dict(record)


async def _end_delegation_on_checkout(db: AsyncSession, email: str) -> None:
    """Away Mode V1 — a successful checkout ends the owner's Toucan delegation (reason
    "checked_out"), so nobody gets "they're away" replies from someone who has gone home.

    Only THIS route does it: a socket go_offline, a refresh or a dropped connection is not a
    checkout, and an employee stays Away while disconnected. Idempotent (nothing active → no-op).
    Never fails the checkout: if ending the row fails, the reply path's own guard
    (chat_delegation._checked_out_since) still refuses to answer for someone who checked out
    after delegating, and no delegation_ended event is sent for a row that did not end."""
    try:
        await toucan_delegation_repo.end_delegation(
            db,
            owner_email=email,
            reason=toucan_delegation_repo.ENDED_CHECKED_OUT,
            on_ended=emit_delegation_ended,
        )
    except Exception:  # noqa: BLE001
        logger.exception("ending the Toucan delegation at checkout failed: owner=%s", email)
