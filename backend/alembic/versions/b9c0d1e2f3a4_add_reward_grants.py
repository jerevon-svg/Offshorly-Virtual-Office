"""add_reward_grants

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-09-06 10:00:00.000000

Progression & Rewards V1 — the claim ledger. One row per claimed (actor, quest_id, period_key);
XP/Coin balances are sums over it. See app/models/reward.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9c0d1e2f3a4'
down_revision: Union[str, Sequence[str], None] = 'a8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "reward_grants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("quest_id", sa.String(64), nullable=False),
        sa.Column("period_key", sa.String(32), nullable=False, server_default=""),
        sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("coins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ux_reward_grants_actor_quest_period", "reward_grants", ["actor_email", "quest_id", "period_key"], unique=True
    )
    op.create_index("ix_reward_grants_actor_email", "reward_grants", ["actor_email"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_reward_grants_actor_email", table_name="reward_grants")
    op.drop_index("ux_reward_grants_actor_quest_period", table_name="reward_grants")
    op.drop_table("reward_grants")
