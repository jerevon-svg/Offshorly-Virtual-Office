"""add_meeting_sessions

Phase 6A — Meeting Session + Access Foundation. One durable row per actual live meeting OCCURRENCE, so a
meeting's future memory belongs to the meeting and never to the room it happened in.

THREE ADDITIVE VO TABLES, NOTHING ELSE TOUCHED (no Atlas table, no existing VO table altered):

  meeting_sessions            one occurrence: the live call's meeting key + room (location only), the
                              booking it belongs to (nullable — instant meetings have none), kind,
                              privacy snapshot, who started it, when, and when/why it ended.

  meeting_session_attendance  actual join/leave intervals per employee — attendance, not permission.

  meeting_session_grants      durable reasons somebody is authorized without attending: the booking's
                              organizer/invitees snapshotted at go-live, and explicit instant invitations.

The only foreign keys point at meeting_sessions itself and at VO's own scheduled_meetings (SET NULL).
Starts empty; before and after this revision every meeting behaves exactly as it did.

Revision ID: a3b4c5d6e7f9
Revises: f2a3b4c5d6e8
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e7f9'
down_revision: Union[str, Sequence[str], None] = 'f2a3b4c5d6e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "meeting_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("meeting_key", sa.String(length=64), nullable=False),
        sa.Column("room_id", sa.String(length=64), nullable=True),
        sa.Column("scheduled_meeting_id", sa.String(length=36), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("is_private", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("started_by_email", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_reason", sa.String(length=24), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["scheduled_meeting_id"], ["scheduled_meetings.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meeting_sessions_key_started", "meeting_sessions", ["meeting_key", "started_at"], unique=False)
    op.create_index(op.f("ix_meeting_sessions_scheduled_meeting_id"), "meeting_sessions", ["scheduled_meeting_id"], unique=False)

    op.create_table(
        "meeting_session_attendance",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["session_id"], ["meeting_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_meeting_session_attendance_session_id"), "meeting_session_attendance", ["session_id"], unique=False)
    op.create_index(op.f("ix_meeting_session_attendance_email"), "meeting_session_attendance", ["email"], unique=False)
    op.create_index(
        "ix_meeting_session_attendance_session_email", "meeting_session_attendance", ["session_id", "email"], unique=False
    )

    op.create_table(
        "meeting_session_grants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["session_id"], ["meeting_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "email", name="uq_meeting_session_grant"),
    )
    op.create_index(op.f("ix_meeting_session_grants_session_id"), "meeting_session_grants", ["session_id"], unique=False)
    op.create_index(op.f("ix_meeting_session_grants_email"), "meeting_session_grants", ["email"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_meeting_session_grants_email"), table_name="meeting_session_grants")
    op.drop_index(op.f("ix_meeting_session_grants_session_id"), table_name="meeting_session_grants")
    op.drop_table("meeting_session_grants")
    op.drop_index("ix_meeting_session_attendance_session_email", table_name="meeting_session_attendance")
    op.drop_index(op.f("ix_meeting_session_attendance_email"), table_name="meeting_session_attendance")
    op.drop_index(op.f("ix_meeting_session_attendance_session_id"), table_name="meeting_session_attendance")
    op.drop_table("meeting_session_attendance")
    op.drop_index(op.f("ix_meeting_sessions_scheduled_meeting_id"), table_name="meeting_sessions")
    op.drop_index("ix_meeting_sessions_key_started", table_name="meeting_sessions")
    op.drop_table("meeting_sessions")
