"""add_badges

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-09-07 10:00:00.000000

Badge Progression V1 — per-actor badge metric/tier read model plus the append-only tier award
ledger. See app/models/badge.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, Sequence[str], None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "badge_progress",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("badge_id", sa.String(64), nullable=False),
        sa.Column("metric", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ux_badge_progress_actor_badge", "badge_progress", ["actor_email", "badge_id"], unique=True)
    op.create_index("ix_badge_progress_actor_email", "badge_progress", ["actor_email"])

    op.create_table(
        "badge_awards",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("badge_id", sa.String(64), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column("metric", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ux_badge_awards_actor_badge_tier", "badge_awards", ["actor_email", "badge_id", "tier"], unique=True)
    op.create_index("ix_badge_awards_actor_email", "badge_awards", ["actor_email"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_badge_awards_actor_email", table_name="badge_awards")
    op.drop_index("ux_badge_awards_actor_badge_tier", table_name="badge_awards")
    op.drop_table("badge_awards")
    op.drop_index("ix_badge_progress_actor_email", table_name="badge_progress")
    op.drop_index("ux_badge_progress_actor_badge", table_name="badge_progress")
    op.drop_table("badge_progress")
