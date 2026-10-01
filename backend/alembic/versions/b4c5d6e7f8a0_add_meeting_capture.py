"""add_meeting_capture

Phase 6B — Capture + Consent + Transcript Evidence Foundation. The provider-independent data layer under a
Meeting Session for future recording/transcription. No audio, no files, no storage references are written.

THREE ADDITIVE VO TABLES, NOTHING ELSE TOUCHED (no Atlas table, no existing VO table altered):

  capture_sessions      one capture run inside a meeting session: who started it, server-UTC start (the
                        zero for every segment offset), when/why it stopped, which source adapter.

  capture_consents      one person's pending/granted/declined decision about ONE capture.

  transcript_segments   accepted utterances only: speaker (from the authenticated source), offsets from the
                        capture's start, text, confidence, source + revision, and a nullable evidence_ref
                        reserved for the future storage integration.

Foreign keys point only at meeting_sessions (Phase 6A) and at these tables. Starts empty.

Revision ID: b4c5d6e7f8a0
Revises: a3b4c5d6e7f9
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4c5d6e7f8a0'
down_revision: Union[str, Sequence[str], None] = 'a3b4c5d6e7f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "capture_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("meeting_session_id", sa.String(length=36), nullable=False),
        sa.Column("started_by_email", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stop_reason", sa.String(length=24), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["meeting_session_id"], ["meeting_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_capture_sessions_meeting_session_id"), "capture_sessions", ["meeting_session_id"], unique=False)
    op.create_index(
        "ix_capture_sessions_session_started", "capture_sessions", ["meeting_session_id", "started_at"], unique=False
    )

    op.create_table(
        "capture_consents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("capture_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["capture_id"], ["capture_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("capture_id", "email", name="uq_capture_consent"),
    )
    op.create_index(op.f("ix_capture_consents_capture_id"), "capture_consents", ["capture_id"], unique=False)
    op.create_index(op.f("ix_capture_consents_email"), "capture_consents", ["email"], unique=False)

    op.create_table(
        "transcript_segments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("capture_id", sa.String(length=36), nullable=False),
        sa.Column("speaker_email", sa.String(length=255), nullable=False),
        sa.Column("speaker_name", sa.String(length=255), nullable=True),
        sa.Column("start_offset_ms", sa.Integer(), nullable=False),
        sa.Column("end_offset_ms", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_segment_ref", sa.String(length=128), nullable=True),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("evidence_ref", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["capture_id"], ["capture_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "capture_id", "source", "source_segment_ref", "revision", name="uq_transcript_segment_rev"
        ),
    )
    op.create_index(op.f("ix_transcript_segments_capture_id"), "transcript_segments", ["capture_id"], unique=False)
    op.create_index(op.f("ix_transcript_segments_speaker_email"), "transcript_segments", ["speaker_email"], unique=False)
    op.create_index(
        "ix_transcript_segments_capture_start", "transcript_segments", ["capture_id", "start_offset_ms"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_transcript_segments_capture_start", table_name="transcript_segments")
    op.drop_index(op.f("ix_transcript_segments_speaker_email"), table_name="transcript_segments")
    op.drop_index(op.f("ix_transcript_segments_capture_id"), table_name="transcript_segments")
    op.drop_table("transcript_segments")
    op.drop_index(op.f("ix_capture_consents_email"), table_name="capture_consents")
    op.drop_index(op.f("ix_capture_consents_capture_id"), table_name="capture_consents")
    op.drop_table("capture_consents")
    op.drop_index("ix_capture_sessions_session_started", table_name="capture_sessions")
    op.drop_index(op.f("ix_capture_sessions_meeting_session_id"), table_name="capture_sessions")
    op.drop_table("capture_sessions")
