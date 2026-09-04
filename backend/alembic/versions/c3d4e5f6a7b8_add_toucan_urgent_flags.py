"""add_toucan_urgent_flags

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6
Create Date: 2026-09-04 12:00:00.000000

Toucan A3 — requester-declared urgency under a delegation. One row per (delegation,
conversation, requester); metadata only, never message content.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "toucan_delegation_urgent_flags",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "delegation_id",
            sa.String(36),
            sa.ForeignKey("toucan_delegations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_email", sa.String(255), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("requester_email", sa.String(255), nullable=False),
        sa.Column("message_reference", sa.String(36), nullable=True),
        sa.Column("flagged_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_toucan_delegation_urgent_flags_delegation_id",
        "toucan_delegation_urgent_flags",
        ["delegation_id"],
    )
    op.create_index(
        "ix_toucan_delegation_urgent_flags_owner_email",
        "toucan_delegation_urgent_flags",
        ["owner_email"],
    )
    # Idempotency: a second declaration by the same requester in the same conversation under the
    # same delegation is the same flag.
    op.create_index(
        "ux_toucan_urgent_flags_delegation_conversation_requester",
        "toucan_delegation_urgent_flags",
        ["delegation_id", "conversation_id", "requester_email"],
        unique=True,
    )
    # "this owner's unseen flags" is the hot read — served directly.
    op.create_index(
        "ix_toucan_urgent_flags_owner_seen",
        "toucan_delegation_urgent_flags",
        ["owner_email", "seen_at"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_toucan_urgent_flags_owner_seen", table_name="toucan_delegation_urgent_flags")
    op.drop_index(
        "ux_toucan_urgent_flags_delegation_conversation_requester",
        table_name="toucan_delegation_urgent_flags",
    )
    op.drop_index("ix_toucan_delegation_urgent_flags_owner_email", table_name="toucan_delegation_urgent_flags")
    op.drop_index("ix_toucan_delegation_urgent_flags_delegation_id", table_name="toucan_delegation_urgent_flags")
    op.drop_table("toucan_delegation_urgent_flags")
