from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WorkingTodayShare(Base):
    """Global Team Map V1.1 — one employee's voluntary, temporary "working today" EXACT location.

    STORES THE PRECISE COORDINATE THE EMPLOYEE CHOSE TO SHARE. The browser asks for geolocation
    only after the employee clicks "Share my exact location today" and approves the permission
    prompt; the fix is POSTed to /team-map/working-today and written here as-is. While the share
    is active every coworker with map access sees this exact point (the UI says so before and
    during sharing). It is never sent to Atlas, and it is unrelated to Atlas's home_address /
    profile geocode, which stays coarsened (services/team_map/coarse_geo.py).

    `label`, `country_code` and `timezone` are DERIVED context from the nearest known city — used
    for bucketing (PH / Elsewhere) and local time, never as the displayed position.

    Natural key = normalised email (mirrors EmployeeAttendance): exactly one row per person,
    upserted in place. Lifecycle (repositories/working_today.py):
      * ACTIVE  — `stopped_at` is NULL and `expires_at` (shared_at + 12h) is in the future: shown
                  to coworkers as "Working today".
      * SAVED   — `stopped_at` set (by Stop sharing, or lazily at expiry): the last shared point is
                  kept and shown as "Last shared <ago>", explicitly not live.
      * FORGOTTEN — row deleted (explicit "Forget saved location"): Atlas base location applies.
    A new share overwrites the row and clears `stopped_at`."""

    __tablename__ = "working_today_shares"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    shared_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
