from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# PHASE 7A — MEETING INTELLIGENCE FOUNDATION, owned by the Meeting Session (Phase 6A), grounded in its
# transcript (Phase 6B).
#
#   Meeting Session → Intelligence Run (one generation, versioned) → Intelligence Item → Evidence → Segment
#
# THE MEETING SESSION OWNS IT, NEVER THE ROOM. Who may READ any of this is services/meeting_access.py only;
# who may GENERATE or REVIEW is services/meeting_intelligence.py's (narrower) decision.
#
# RUNS ARE HISTORY. Regenerating inserts a new run with the next `version`; nothing is overwritten and old
# runs stay readable. "The latest intelligence" is the succeeded run with the highest version — a failed or
# still-running run never displaces it.
#
# SNAPSHOT. A run records exactly which transcript segment rows (ids, in transcript order) it analyzed, and
# a fingerprint over their id/revision/speaker/timing/text. Segments are append-only rows (a corrected STT
# result is a NEW row with a higher revision), so the id list answers "what did this run see?" without
# copying any words, and comparing fingerprints says whether the transcript has moved on since.
#
# GENERATED ≠ CONFIRMED. `content` is what the generator produced and is never modified. A human review
# sets `review_state` and, for an edit, stores the human version in `reviewed_content` beside it — so the
# AI original and the human decision are both always there. Nothing here is a task, an assignment or any
# other business state; a confirmed commitment is still just a reviewed meeting item.
#
# EVIDENCE cites real transcript_segments rows by id; the words are read from the segment, not copied.
# services/meeting_intelligence.py only attaches a segment that is in the run's own snapshot, which is
# built from the same Meeting Session's captures — cross-meeting evidence cannot be written.
#
# TIMES ARE UTC.

RUN_RUNNING = "running"
RUN_SUCCEEDED = "succeeded"
RUN_FAILED = "failed"

#: stable failure codes — never an exception message (it could carry transcript text)
FAIL_GENERATOR_ERROR = "generator_error"
FAIL_TIMEOUT = "timeout"
FAIL_INVALID_OUTPUT = "invalid_output"
FAIL_SERVER_RESTART = "server_restart"

ITEM_SUMMARY = "summary"
ITEM_TOPIC = "topic"
ITEM_DECISION = "decision"
ITEM_COMMITMENT = "commitment"
ITEM_OPEN_LOOP = "open_loop"
ITEM_KEY_POINT = "key_point"
ITEM_TYPES = frozenset({ITEM_SUMMARY, ITEM_TOPIC, ITEM_DECISION, ITEM_COMMITMENT, ITEM_OPEN_LOOP, ITEM_KEY_POINT})
#: every type but the whole-meeting summary must cite at least one transcript segment
EVIDENCE_OPTIONAL = frozenset({ITEM_SUMMARY})

ORIGIN_GENERATED = "generated"

REVIEW_SUGGESTED = "suggested"  # generated, no human has looked — never authoritative
REVIEW_CONFIRMED = "confirmed"
REVIEW_EDITED = "edited"  # confirmed with the human's wording in reviewed_content
REVIEW_REJECTED = "rejected"


class MeetingIntelligenceRun(BaseModel):
    """One generation over one Meeting Session's transcript. `created_at` (TimestampMixin) is the insert."""

    __tablename__ = "meeting_intelligence_runs"
    __table_args__ = (
        # The per-session version is the identity of a generation and the "latest" tie-breaker; two
        # concurrent requests cannot both claim the same one.
        UniqueConstraint("meeting_session_id", "version", name="uq_meeting_intelligence_run_version"),
        Index("ix_meeting_intelligence_runs_session_status", "meeting_session_id", "status"),
    )

    meeting_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # RUN_* above.
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # Which generator produced it ("fake-v2" in development) — provider-neutral, recorded for audit.
    generator: Mapped[str] = mapped_column(String(64), nullable=False)
    requested_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # FAIL_* above; None unless failed.
    failure_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # ---- the transcript snapshot this run analyzed -------------------------------------------------------
    # transcript_segments ids, in transcript order (current revision of each utterance only).
    source_segment_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    source_segment_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # sha256 over each analyzed segment's id, revision, speaker, offsets and text (see the service).
    source_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    # Server receive time of the newest analyzed segment — a human-readable boundary, not the identity.
    source_through_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MeetingIntelligenceItem(BaseModel):
    """One structured output of a run. It belongs to its Meeting Session through the run."""

    __tablename__ = "meeting_intelligence_items"
    __table_args__ = (Index("ix_meeting_intelligence_items_run_position", "run_id", "position"),)

    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_intelligence_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # ITEM_* above.
    item_type: Mapped[str] = mapped_column(String(16), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    # ORIGIN_GENERATED only in this phase (a human-added item would be a later origin).
    origin: Mapped[str] = mapped_column(
        String(16), nullable=False, default=ORIGIN_GENERATED, server_default=ORIGIN_GENERATED
    )
    # What the generator produced. Never modified after the run completes.
    content: Mapped[dict] = mapped_column(JSON, nullable=False)
    # 0..1 as the generator reported it, or None when it gave none.
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    # The generator's own statement of what it is unsure about (ambiguous owner, no date said, …).
    uncertainty: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ---- human review --------------------------------------------------------------------------------
    # REVIEW_* above; starts "suggested".
    review_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default=REVIEW_SUGGESTED, server_default=REVIEW_SUGGESTED
    )
    # The human's version, only for "edited"; `content` keeps the AI original.
    reviewed_content: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reviewed_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MeetingIntelligenceEvidence(BaseModel):
    """Item → the transcript segment that supports it. `position` orders citations within the item."""

    __tablename__ = "meeting_intelligence_evidence"
    __table_args__ = (UniqueConstraint("item_id", "segment_id", name="uq_meeting_intelligence_evidence"),)

    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meeting_intelligence_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    segment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("transcript_segments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
