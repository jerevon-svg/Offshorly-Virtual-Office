"""add_message_kind_and_meta

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-09-20 00:00:00.000000

Phase 7D — MISSED CALLS BECOME A ROW IN THE CONVERSATION THEY BELONG TO.

Additive only, and both columns are backward compatible on their own:

  * `kind` is NOT NULL with a server_default of 'text', so every existing row becomes an ordinary
    message with no backfill. Readers that never heard of it keep working; readers that branch on it
    (see models/message.py) get the one fact they need.
  * `meta` is nullable JSON, matching `mentioned_emails` beside it — null and {} mean the same thing.

No index beyond `kind`'s own: the only new read shape is "exclude system rows from a count", which is a
filter on an already-indexed scan, not a lookup.

Reversible by dropping both columns. Nothing is written to them until the application code that does so
ships, so this can be applied ahead of a deploy without changing any behaviour.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("kind", sa.String(length=24), nullable=False, server_default="text"),
    )
    op.create_index(op.f("ix_messages_kind"), "messages", ["kind"], unique=False)
    op.add_column("messages", sa.Column("meta", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "meta")
    op.drop_index(op.f("ix_messages_kind"), table_name="messages")
    op.drop_column("messages", "kind")
