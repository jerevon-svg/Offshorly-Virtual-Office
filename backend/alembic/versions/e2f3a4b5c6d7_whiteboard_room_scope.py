"""whiteboard_room_scope

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-09-07 13:00:00.000000

Whiteboard W4 — a board belongs to exactly one scope: a conversation (existing) OR an office room
(`room_id`, new). `conversation_id` becomes nullable and a CHECK enforces the XOR. Every existing row
has a conversation_id, so no backfill is needed. Batch mode because the rigs run SQLite (no ALTER
COLUMN there); on Postgres the same calls run as plain ALTERs. See app/models/whiteboard.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("whiteboards", schema=None) as batch_op:
        batch_op.alter_column("conversation_id", existing_type=sa.String(36), nullable=True)
        batch_op.add_column(sa.Column("room_id", sa.String(64), nullable=True))
        batch_op.create_index("ix_whiteboards_room_id", ["room_id"])
        batch_op.create_check_constraint(
            "ck_whiteboards_one_scope", "(conversation_id IS NULL) <> (room_id IS NULL)"
        )


def downgrade() -> None:
    """Downgrade schema. Room boards cannot survive a NOT NULL conversation_id — drop them first."""
    op.execute("DELETE FROM whiteboards WHERE conversation_id IS NULL")
    with op.batch_alter_table("whiteboards", schema=None) as batch_op:
        batch_op.drop_constraint("ck_whiteboards_one_scope", type_="check")
        batch_op.drop_index("ix_whiteboards_room_id")
        batch_op.drop_column("room_id")
        batch_op.alter_column("conversation_id", existing_type=sa.String(36), nullable=False)
