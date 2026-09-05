"""add_quest_foundation

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a7b8
Create Date: 2026-09-05 12:00:00.000000

Quest Foundation — a filtered ledger of validated quest events plus materialized per-actor
progress. Metadata only, never message content. See app/models/quest.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "quest_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("dedupe_key", sa.String(255), nullable=False),
        sa.Column("target_email", sa.String(255), nullable=True),
        sa.Column("reference_id", sa.String(64), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # Idempotency, namespaced per event domain: a retry / duplicate emit / reconnect re-assert
    # of the same natural key is the same event.
    op.create_index("ux_quest_events_type_dedupe", "quest_events", ["event_type", "dedupe_key"], unique=True)
    op.create_index("ix_quest_events_actor_type", "quest_events", ["actor_email", "event_type"])

    op.create_table(
        "quest_progress",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("quest_id", sa.String(64), nullable=False),
        sa.Column("period_key", sa.String(32), nullable=False, server_default=""),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_quest_progress_actor_email", "quest_progress", ["actor_email"])
    op.create_index(
        "ux_quest_progress_actor_quest_period",
        "quest_progress",
        ["actor_email", "quest_id", "period_key"],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ux_quest_progress_actor_quest_period", table_name="quest_progress")
    op.drop_index("ix_quest_progress_actor_email", table_name="quest_progress")
    op.drop_table("quest_progress")
    op.drop_index("ix_quest_events_actor_type", table_name="quest_events")
    op.drop_index("ux_quest_events_type_dedupe", table_name="quest_events")
    op.drop_table("quest_events")
