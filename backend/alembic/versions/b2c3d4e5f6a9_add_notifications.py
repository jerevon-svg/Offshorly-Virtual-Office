"""add_notifications

Revision ID: b2c3d4e5f6a9
Revises: a1b2c3d4e5f7
Create Date: 2026-09-08 10:00:00.000000

Global Notifications V1 — the single notifications table every notification type (now Kudos,
later chat/mentions/calls/quests/badges/Hub/HR) writes into. See app/models/notification.py for
the storage rules. No existing table is touched.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a9'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("recipient_email", sa.String(255), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("dedupe_key", sa.String(255), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("nav_kind", sa.String(32), nullable=True),
        sa.Column("nav_payload", sa.JSON(), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ux_notifications_recipient_dedupe", "notifications", ["recipient_email", "dedupe_key"], unique=True
    )
    op.create_index("ix_notifications_recipient_created", "notifications", ["recipient_email", "created_at"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_notifications_recipient_created", table_name="notifications")
    op.drop_index("ux_notifications_recipient_dedupe", table_name="notifications")
    op.drop_table("notifications")
