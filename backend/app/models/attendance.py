from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EmployeeAttendance(Base):
    """Server-authoritative attendance (work-session) record — one row per employee, upserted in
    place, mirroring EmployeePosition's natural-key convention rather than BaseModel's uuid PK.

    This is ATTENDANCE, not connection state: a socket disconnect, tab close, or refresh never
    touches it. Only POST /attendance/check-in and POST /attendance/check-out (routers/attendance.py)
    write it, and the frontend reaches check-out only through the existing Log Time flow.

    Status is derived, never stored: CHECKED_IN when `checked_in_at` is set and `checked_out_at`
    is NULL; CHECKED_OUT otherwise. A missing row is CHECKED_OUT too (see repositories/attendance.py
    get_status) — an employee who has never checked in needs no row to be represented."""

    __tablename__ = "employee_attendance"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
