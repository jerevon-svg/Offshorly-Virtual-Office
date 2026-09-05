"""add_mission_assignments

Revision ID: a8b9c0d1e2f3
Revises: e7f8a9b0c1d2
Create Date: 2026-09-05 18:00:00.000000

Daily/Weekly Missions — the per-actor, per-period pinned draw from the mission pool. Progress
reuses quest_progress (period_key = "d:YYYY-MM-DD" / "w:YYYY-Www") and events reuse
quest_events. See app/models/mission.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, Sequence[str], None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "mission_assignments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("cadence", sa.String(8), nullable=False),
        sa.Column("period_key", sa.String(32), nullable=False),
        sa.Column("mission_id", sa.String(64), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ux_mission_assignments_actor_period_mission",
        "mission_assignments",
        ["actor_email", "period_key", "mission_id"],
        unique=True,
    )
    op.create_index("ix_mission_assignments_actor_period", "mission_assignments", ["actor_email", "period_key"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_mission_assignments_actor_period", table_name="mission_assignments")
    op.drop_index("ux_mission_assignments_actor_period_mission", table_name="mission_assignments")
    op.drop_table("mission_assignments")
