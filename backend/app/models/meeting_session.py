from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# PHASE 6A — THE MEETING SESSION: one row per actual live meeting OCCURRENCE.
#
# WHY IT EXISTS. The live call is keyed by its room ("meeting:mf-foxtrot"), so every meeting ever held in
# Foxtrot shares one key. That is fine for routing media and wrong for anything durable: Monday's Product
# Sync and Tuesday's HR meeting in Foxtrot are different meetings, and whatever is later remembered about
# one must never be reachable from the other — or from the room. So each activation of a live meeting mints
# its own id here, and everything that will belong to a meeting (capture, transcript, evidence, memory)
# hangs off THIS id, never off a room id.
#
# WHAT IT IS NOT. Not the live meeting: call_registry / meeting_hosts still own who is connected and who
# hosts, in memory, exactly as before. This is the durable record layered above them
# (services/meeting_sessions.py writes it).
#
# THE ROOM IS LOCATION, NEVER ACCESS. `meeting_key` and `room_id` say where the meeting happened. Nothing
# reads them to decide who may see a session — services/meeting_access.py is the only gate and it never
# looks at either.
#
# TIMES ARE UTC, as everywhere in this app (SQLite hands them back naive; naive == UTC).

KIND_SCHEDULED = "scheduled"
KIND_INSTANT = "instant"

#: the last participant left (after the reconnect grace — services/meeting_sessions.py)
END_EMPTIED = "emptied"
#: the host or the booking's organizer pressed End Meeting
END_ENDED = "ended"
#: the process restarted while the session was open; found and closed at startup
END_SERVER_RESTART = "server_restart"

#: why somebody holds a durable grant on a session (attendance is its own table, not a grant)
GRANT_ORGANIZER = "organizer"
GRANT_INVITEE = "invitee"
GRANT_INVITED = "invited"


class MeetingSession(BaseModel):
    __tablename__ = "meeting_sessions"
    __table_args__ = (Index("ix_meeting_sessions_key_started", "meeting_key", "started_at"),)

    # The live call's bare meeting id (`mf-foxtrot`, `cave-all-hands`) — runtime/location metadata only.
    meeting_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # The Meeting Floor room id (`floor-2/foxtrot`), or None for a meeting that is not in one (the Cave).
    room_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # The booking this occurrence belongs to, or None for an instant meeting.
    scheduled_meeting_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("scheduled_meetings.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # "scheduled" | "instant" — derived from scheduled_meeting_id at activation, stored for plain reads.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # PRIVACY SNAPSHOT: the booking's private flag at the moment the meeting went live.
    is_private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    started_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "emptied" | "ended" | "server_restart"; None while open.
    end_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)


class MeetingSessionAttendance(BaseModel):
    """One interval during which an employee was actually CONNECTED to the session's call. Join → leave →
    rejoin is two rows, so history is never overwritten. Per EMAIL, not per socket: two tabs are one person.
    Attendance is a fact about what happened, not a permission — see MeetingSessionGrant for invitations."""

    __tablename__ = "meeting_session_attendance"
    __table_args__ = (Index("ix_meeting_session_attendance_session_email", "session_id", "email"),)

    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MeetingSessionGrant(BaseModel):
    """A durable reason somebody is authorized for a session WITHOUT having attended it: the booking's
    organizer and invitees (snapshotted when the meeting goes live, so a later edit to the booking cannot
    silently revoke them), or an employee a participant explicitly invited into an instant meeting (whose
    invitation itself only ever lived in memory)."""

    __tablename__ = "meeting_session_grants"
    __table_args__ = (UniqueConstraint("session_id", "email", name="uq_meeting_session_grant"),)

    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # "organizer" | "invitee" | "invited" — the first reason recorded wins.
    reason: Mapped[str] = mapped_column(String(16), nullable=False)
