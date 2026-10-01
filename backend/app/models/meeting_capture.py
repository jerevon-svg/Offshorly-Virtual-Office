from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# PHASE 6B — CAPTURE, CONSENT AND TRANSCRIPT EVIDENCE, underneath the Meeting Session (Phase 6A).
#
#   Meeting Session → Capture Session → Capture Consent (per person, per capture)
#                                     → Transcript Segment → (future) evidence reference
#
# A capture belongs to a MEETING SESSION, never to a room. Who may READ any of this is decided only by
# services/meeting_access.py — there is no capture-level permission system; services/meeting_capture.py
# decides who may START/STOP a capture and what a transcript segment must prove before it is accepted.
#
# NOTHING HERE HOLDS MEDIA. No audio, no file path, no object-store URL. `evidence_ref` stays NULL until a
# real storage integration exists; it is a column so that integration can attach a reference to a segment
# without redesigning the segment.
#
# TIMES ARE UTC. A capture's `started_at` is the server's clock and the authoritative zero for every
# segment offset under it.

#: the only source this phase supports — in-process fake/test input. Real adapters add their own ids.
SOURCE_FAKE = "fake"

#: consent states — a person's decision about ONE capture
CONSENT_PENDING = "pending"
CONSENT_GRANTED = "granted"
CONSENT_DECLINED = "declined"

#: why a capture stopped
STOP_STOPPED = "stopped"  # the host/organizer stopped it
STOP_MEETING_ENDED = "meeting_ended"  # End Meeting
STOP_MEETING_EMPTIED = "meeting_emptied"  # the last participant left (after the session's reconnect grace)
STOP_SERVER_RESTART = "server_restart"  # the process went away while it was active; closed at startup


class CaptureSession(BaseModel):
    """One capture run inside a Meeting Session. A session may hold several over its lifetime (stop, then
    start again) but at most one is active at a time — services/meeting_capture.py enforces that."""

    __tablename__ = "capture_sessions"
    __table_args__ = (Index("ix_capture_sessions_session_started", "meeting_session_id", "started_at"),)

    meeting_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    # Authoritative server UTC; the zero point for every segment offset.
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # STOP_* above; None while active.
    stop_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # Which capture/transcription adapter produces this capture's segments ("fake" only, for now).
    source: Mapped[str] = mapped_column(String(32), nullable=False)


class CaptureConsent(BaseModel):
    """One person's decision about one capture. Consent is NOT inferred from joining, accepting the
    invitation, an open microphone, standing in the room, or being allowed to read the meeting's memory —
    a row starts `pending` and only the person themself moves it. It never carries across captures."""

    __tablename__ = "capture_consents"
    __table_args__ = (UniqueConstraint("capture_id", "email", name="uq_capture_consent"),)

    capture_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("capture_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TranscriptSegment(BaseModel):
    """One accepted utterance. Written ONLY by services/meeting_capture.ingest_segment, after it has proven
    the capture is active and the speaker — identified by the authenticated source, never by the payload —
    belongs to it and has granted consent. `created_at` (TimestampMixin) is the server receive time."""

    __tablename__ = "transcript_segments"
    __table_args__ = (
        Index("ix_transcript_segments_capture_start", "capture_id", "start_offset_ms"),
        # A provider re-delivering the same segment revision is a duplicate, not a second utterance.
        # NULL source_segment_ref never collides (SQL NULLs are distinct), so ref-less sources are unaffected.
        UniqueConstraint("capture_id", "source", "source_segment_ref", "revision", name="uq_transcript_segment_rev"),
    )

    capture_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("capture_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    speaker_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # Display-name snapshot at receive time (best-effort; this app has no users table).
    speaker_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Milliseconds from the capture's started_at.
    start_offset_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    end_offset_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    # The source's own id for this segment, so a corrected STT result can arrive as revision 2 of it.
    source_segment_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # Future: the stored-evidence reference (an object key, not a URL). Always NULL in Phase 6B.
    evidence_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
