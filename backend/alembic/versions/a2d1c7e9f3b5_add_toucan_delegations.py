"""add_toucan_delegations

Revision ID: a2d1c7e9f3b5
Revises: e6b3c5d7a9f1
Create Date: 2026-09-04 00:00:00.000000

Toucan A2.1 — durable explicit delegation. One additive table, no backfill: nothing existed to
migrate from, because no earlier tier could act on anybody's behalf.

`toucan_delegations` holds the fact that a person explicitly asked Toucan to handle their direct
messages for a bounded time: owner, window, how it ended, a reply counter, and an optional note
the owner typed. No conversation ids, no message content — Toucan's automatic replies are
ordinary chat rows authored by the reserved sender, exactly like A1.4's in-chat answers.

Dropping the table restores the A1.4 state: Toucan forgets every delegation and can no longer
answer on anybody's behalf.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2d1c7e9f3b5'
down_revision: Union[str, Sequence[str], None] = 'e6b3c5d7a9f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "toucan_delegations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_email", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("end_condition", sa.String(16), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hard_cap_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_reason", sa.String(16), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_toucan_delegations_owner_email", "toucan_delegations", ["owner_email"])
    # "this owner's active delegation" is the hot read — served directly.
    op.create_index("ix_toucan_delegations_owner_status", "toucan_delegations", ["owner_email", "status"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_toucan_delegations_owner_status", table_name="toucan_delegations")
    op.drop_index("ix_toucan_delegations_owner_email", table_name="toucan_delegations")
    op.drop_table("toucan_delegations")
