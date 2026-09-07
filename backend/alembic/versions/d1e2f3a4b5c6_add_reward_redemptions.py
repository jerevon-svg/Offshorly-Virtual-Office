"""add_reward_redemptions

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-09-07 14:00:00.000000

Reward Redemption V1 — workflow record for spending Coins; the Coin movements themselves are rows
in reward_grants. See app/models/redemption.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c0d1e2f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "reward_redemptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_email", sa.String(255), nullable=False),
        sa.Column("item_id", sa.String(64), nullable=False),
        sa.Column("cost", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("idempotency_key", sa.String(32), nullable=False),
        sa.Column("debit_grant_id", sa.String(36), nullable=False),
        sa.Column("refund_grant_id", sa.String(36), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("decided_by", sa.String(255), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ux_reward_redemptions_actor_idem", "reward_redemptions", ["actor_email", "idempotency_key"], unique=True)
    op.create_index("ix_reward_redemptions_actor_email", "reward_redemptions", ["actor_email"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_reward_redemptions_actor_email", table_name="reward_redemptions")
    op.drop_index("ux_reward_redemptions_actor_idem", table_name="reward_redemptions")
    op.drop_table("reward_redemptions")
