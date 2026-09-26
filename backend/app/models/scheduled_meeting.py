from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# SCHEDULED MEETINGS V1 — a BOOKING of one Meeting Floor room for a time window, and who is invited.
#
# WHAT THIS IS NOT: the live meeting. Whether a room's meeting is running, who is in it and who hosts
# it stay owned by call_registry / meeting_hosts (in-memory, per process). Nothing here records
# "started" or "ended" — those are derived from this window plus the live session, so there is one
# source of truth for liveness. `status` only says whether the booking still stands.
#
# TIMES ARE UTC. Every writer normalises to UTC before storing (services/scheduled_meetings.py);
# SQLite hands them back naive, and naive == UTC here, as everywhere else in this app.


class ScheduledMeeting(BaseModel):
    __tablename__ = "scheduled_meetings"
    __table_args__ = (
        # The conflict check and the "which booking governs this room now" read: one room, by time.
        Index("ix_scheduled_meetings_room_starts", "room_id", "starts_at"),
    )

    title: Mapped[str] = mapped_column(String(120), nullable=False)
    # The Meeting Floor's stable room id, `floor-2/<slug>` — services/meeting_floor_rooms.py.
    room_id: Mapped[str] = mapped_column(String(64), nullable=False)
    organizer_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # "scheduled" | "cancelled". A cancelled booking is kept (history) and ignored by every check.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled", server_default="scheduled")


class ScheduledMeetingInvitee(BaseModel):
    """One invited employee. The organizer is ALSO a row (response "accepted"), so "who may enter a
    private meeting" is one query against one table."""

    __tablename__ = "scheduled_meeting_invitees"
    __table_args__ = (UniqueConstraint("meeting_id", "email", name="uq_scheduled_meeting_invitee"),)

    meeting_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("scheduled_meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # "pending" | "accepted" | "declined". Display only in V1: a decline does not revoke access.
    response: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
