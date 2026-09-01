"""add_message_reactions

Revision ID: b7d2e4f6a801
Revises: a2b3c4d5e6f7
Create Date: 2026-08-31 00:00:00.000000

Purely additive: creates one new table. No ALTER of `messages`, no column drops, no backfill —
every existing message row is untouched and keeps serializing with `reactions: []`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d2e4f6a801'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "message_reactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("reactor_email", sa.String(length=255), nullable=False),
        sa.Column("emoji", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_message_reactions_message_id"), "message_reactions", ["message_id"], unique=False
    )
    op.create_index(
        op.f("ix_message_reactions_reactor_email"), "message_reactions", ["reactor_email"], unique=False
    )
    op.create_index(
        "uq_message_reaction", "message_reactions", ["message_id", "reactor_email", "emoji"], unique=True
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_message_reaction", table_name="message_reactions")
    op.drop_index(op.f("ix_message_reactions_reactor_email"), table_name="message_reactions")
    op.drop_index(op.f("ix_message_reactions_message_id"), table_name="message_reactions")
    op.drop_table("message_reactions")
