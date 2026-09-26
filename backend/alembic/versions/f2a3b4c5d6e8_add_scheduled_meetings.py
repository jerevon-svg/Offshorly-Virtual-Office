"""add_scheduled_meetings

Scheduled Meetings V1, Phase 1 — persistent bookings of Meeting Floor rooms.

TWO ADDITIVE TABLES, NOTHING ELSE TOUCHED:

  scheduled_meetings          one booking: title, Meeting Floor room id, organizer, UTC window,
                              private flag, and scheduled | cancelled. No live/started/ended state —
                              the in-memory call registry stays the authority for that.

  scheduled_meeting_invitees  who is invited (the organizer included), with a display-only response.

PURELY ADDITIVE. Starts empty, so before and after this revision every room behaves exactly as it
did: with no booking there is no private window, and the meeting token endpoint answers as before.

Revision ID: f2a3b4c5d6e8
Revises: e1f2a3b4c5d7
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a3b4c5d6e8'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "scheduled_meetings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("room_id", sa.String(length=64), nullable=False),
        sa.Column("organizer_email", sa.String(length=255), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_private", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="scheduled", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scheduled_meetings_room_starts", "scheduled_meetings", ["room_id", "starts_at"], unique=False)
    op.create_index(op.f("ix_scheduled_meetings_organizer_email"), "scheduled_meetings", ["organizer_email"], unique=False)

    op.create_table(
        "scheduled_meeting_invitees",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("meeting_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("response", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["meeting_id"], ["scheduled_meetings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("meeting_id", "email", name="uq_scheduled_meeting_invitee"),
    )
    op.create_index(op.f("ix_scheduled_meeting_invitees_meeting_id"), "scheduled_meeting_invitees", ["meeting_id"], unique=False)
    op.create_index(op.f("ix_scheduled_meeting_invitees_email"), "scheduled_meeting_invitees", ["email"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_scheduled_meeting_invitees_email"), table_name="scheduled_meeting_invitees")
    op.drop_index(op.f("ix_scheduled_meeting_invitees_meeting_id"), table_name="scheduled_meeting_invitees")
    op.drop_table("scheduled_meeting_invitees")
    op.drop_index(op.f("ix_scheduled_meetings_organizer_email"), table_name="scheduled_meetings")
    op.drop_index("ix_scheduled_meetings_room_starts", table_name="scheduled_meetings")
    op.drop_table("scheduled_meetings")
