"""add_room_entry_requests

Revision ID: d4e5f6a7b8c9
Revises: f3a7c1d9e8b2
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'f3a7c1d9e8b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "room_entry_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("room_id", sa.String(64), nullable=False),
        sa.Column("requester_email", sa.String(255), nullable=False),
        sa.Column("state", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("resolver_email", sa.String(255), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_index("ix_room_entry_requests_room_id", "room_entry_requests", ["room_id"])
    op.create_index(
        "ix_room_entry_requests_requester_email", "room_entry_requests", ["requester_email"]
    )
    op.create_index("ix_room_entry_requests_state", "room_entry_requests", ["state"])

    op.create_index(
        "uq_pending_room_request",
        "room_entry_requests",
        ["room_id", "requester_email"],
        unique=True,
        sqlite_where=sa.text("state = 'pending'"),
        postgresql_where=sa.text("state = 'pending'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_pending_room_request", table_name="room_entry_requests")
    op.drop_index("ix_room_entry_requests_state", table_name="room_entry_requests")
    op.drop_index("ix_room_entry_requests_requester_email", table_name="room_entry_requests")
    op.drop_index("ix_room_entry_requests_room_id", table_name="room_entry_requests")
    op.drop_table("room_entry_requests")
