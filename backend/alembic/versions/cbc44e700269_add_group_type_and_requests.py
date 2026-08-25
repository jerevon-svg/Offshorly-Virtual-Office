"""add_group_type_and_requests

Revision ID: cbc44e700269
Revises: 044622847be4
Create Date: 2026-08-22 12:47:45.581667

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cbc44e700269'
down_revision: Union[str, Sequence[str], None] = '044622847be4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type", sa.String(16), nullable=False, server_default="dm"))
        batch_op.add_column(sa.Column("title", sa.String(255), nullable=True))
    op.create_index("ix_conversations_type", "conversations", ["type"])

    op.create_table(
        "conversation_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("requester_email", sa.String(255), nullable=False),
        sa.Column("state", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("resolver_email", sa.String(255), nullable=True),
        sa.Column(
            "result_conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_index("ix_conversation_requests_kind", "conversation_requests", ["kind"])
    op.create_index(
        "ix_conversation_requests_conversation_id", "conversation_requests", ["conversation_id"]
    )
    op.create_index(
        "ix_conversation_requests_requester_email", "conversation_requests", ["requester_email"]
    )
    op.create_index("ix_conversation_requests_state", "conversation_requests", ["state"])

    op.create_index(
        "uq_pending_request",
        "conversation_requests",
        ["kind", "conversation_id", "requester_email"],
        unique=True,
        sqlite_where=sa.text("state = 'pending'"),
        postgresql_where=sa.text("state = 'pending'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_pending_request", table_name="conversation_requests")
    op.drop_index("ix_conversation_requests_state", table_name="conversation_requests")
    op.drop_index("ix_conversation_requests_requester_email", table_name="conversation_requests")
    op.drop_index("ix_conversation_requests_conversation_id", table_name="conversation_requests")
    op.drop_index("ix_conversation_requests_kind", table_name="conversation_requests")
    op.drop_table("conversation_requests")

    op.drop_index("ix_conversations_type", table_name="conversations")
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.drop_column("title")
        batch_op.drop_column("type")
