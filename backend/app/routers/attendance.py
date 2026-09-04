from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.realtime.state import offline_lineup, sio
from app.repositories import attendance as attendance_repo
from app.schemas.attendance import AttendanceOut

# Attendance = work-session state, server-authoritative and independent of socket connection
# state (see app/models/attendance.py). These routes are the ONLY writers. They also keep the
# in-memory offline lineup (the peers-see-you-on-the-sidewalk signal) in step, so a checked-out
# person stays on the sidewalk for everyone regardless of which tab/socket they later open.
# The socket's go_offline/come_online handlers are left untouched: the client still emits them
# alongside these calls for the presence-cursor bookkeeping they already own.

router = APIRouter(tags=["attendance"])


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
    record = await attendance_repo.check_in(db, email)
    offline_lineup.remove(record["email"])
    await _broadcast_lineup()
    return AttendanceOut.from_dict(record)


@router.post("/attendance/check-out", response_model=AttendanceOut)
async def check_out(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> AttendanceOut:
    record = await attendance_repo.check_out(db, email)
    offline_lineup.add(record["email"])
    await _broadcast_lineup()
    return AttendanceOut.from_dict(record)
