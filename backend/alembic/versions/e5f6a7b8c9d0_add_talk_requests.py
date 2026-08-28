"""add_talk_requests

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "talk_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("target_email", sa.String(255), nullable=False),
        sa.Column("requester_email", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="chat"),
        sa.Column("state", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("resolver_email", sa.String(255), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_index("ix_talk_requests_target_email", "talk_requests", ["target_email"])
    op.create_index("ix_talk_requests_requester_email", "talk_requests", ["requester_email"])
    op.create_index("ix_talk_requests_state", "talk_requests", ["state"])

    op.create_index(
        "uq_pending_talk_request",
        "talk_requests",
        ["target_email", "requester_email"],
        unique=True,
        sqlite_where=sa.text("state = 'pending'"),
        postgresql_where=sa.text("state = 'pending'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_pending_talk_request", table_name="talk_requests")
    op.drop_index("ix_talk_requests_state", table_name="talk_requests")
    op.drop_index("ix_talk_requests_requester_email", table_name="talk_requests")
    op.drop_index("ix_talk_requests_target_email", table_name="talk_requests")
    op.drop_table("talk_requests")
