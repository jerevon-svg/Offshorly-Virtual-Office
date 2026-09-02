"""add_toucan_conversations

Revision ID: c8f1a2d3e4b5
Revises: b7d2e4f6a801
Create Date: 2026-09-02 00:00:00.000000

Toucan T1 — persistent conversations. Two tables, no backfill: before this revision Toucan
held no data at all, so there is nothing to migrate. Dropping them restores exactly the T0
state (an assistant whose transcript dies with the panel).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8f1a2d3e4b5'
down_revision: Union[str, Sequence[str], None] = 'b7d2e4f6a801'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "toucan_conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_email", sa.String(255), nullable=False),
        sa.Column("title", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_toucan_conversations_owner_email", "toucan_conversations", ["owner_email"])

    op.create_table(
        "toucan_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("toucan_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_toucan_messages_conversation_id", "toucan_messages", ["conversation_id"])
    # Reading one conversation is always "this conversation, oldest turn first" — the composite
    # index serves that ORDER BY directly instead of sorting the conversation's rows each read.
    op.create_index(
        "ix_toucan_messages_conversation_created",
        "toucan_messages",
        ["conversation_id", "created_at"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_toucan_messages_conversation_created", table_name="toucan_messages")
    op.drop_index("ix_toucan_messages_conversation_id", table_name="toucan_messages")
    op.drop_table("toucan_messages")
    op.drop_index("ix_toucan_conversations_owner_email", table_name="toucan_conversations")
    op.drop_table("toucan_conversations")
