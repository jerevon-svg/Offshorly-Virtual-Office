"""add_toucan_memory_and_resources

Revision ID: e6b3c5d7a9f1
Revises: d9e1f2a3b4c5
Create Date: 2026-09-02 00:00:00.000000

Toucan T4 — durable important memory, and the metadata foundation for resource references. Two
tables, additive, no backfill and no data migration — nothing existed to migrate from:

  * `toucan_memories` holds facts the user EXPLICITLY asked Toucan to remember. It starts empty
    by definition: T0-T3 never extracted or stored anything about anybody, so there is no prior
    memory to carry forward, and this revision does not manufacture any.

  * `toucan_resources` holds references to things that live elsewhere — a display name, an
    optional locator (URL today; object-storage key once that layer exists), optional links into
    the owner's own conversations/memories. DELIBERATELY NO CONTENT COLUMN: the codebase has no
    object storage at T4, and this table must never become a place file bodies get stuffed into
    SQLite.

Dropping both tables restores exactly the T3 state: Toucan keeps its conversations and its
activity counts, and forgets everything it was explicitly asked to keep.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e6b3c5d7a9f1'
down_revision: Union[str, Sequence[str], None] = 'd9e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "toucan_memories",
        sa.Column("id", sa.String(36), primary_key=True),
        # The permission key — every read and write filters on it. See app/models/toucan.py.
        sa.Column("owner_email", sa.String(255), nullable=False),
        # "fact" | "note" — Python-layer vocabulary, no CHECK, same as toucan_messages.role.
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_toucan_memories_owner_email", "toucan_memories", ["owner_email"])
    # "this owner's memories, newest first" is the only read shape — served directly.
    op.create_index(
        "ix_toucan_memories_owner_created", "toucan_memories", ["owner_email", "created_at"]
    )

    op.create_table(
        "toucan_resources",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_email", sa.String(255), nullable=False),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("toucan_conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "memory_id",
            sa.String(36),
            sa.ForeignKey("toucan_memories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("display_name", sa.String(255), nullable=False),
        # WHERE the thing lives, never WHAT it contains — bounded so a body cannot ride in it.
        sa.Column("locator", sa.String(1024), nullable=True),
        sa.Column("media_type", sa.String(127), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_toucan_resources_owner_email", "toucan_resources", ["owner_email"])
    op.create_index("ix_toucan_resources_conversation_id", "toucan_resources", ["conversation_id"])
    op.create_index("ix_toucan_resources_memory_id", "toucan_resources", ["memory_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_toucan_resources_memory_id", table_name="toucan_resources")
    op.drop_index("ix_toucan_resources_conversation_id", table_name="toucan_resources")
    op.drop_index("ix_toucan_resources_owner_email", table_name="toucan_resources")
    op.drop_table("toucan_resources")
    op.drop_index("ix_toucan_memories_owner_created", table_name="toucan_memories")
    op.drop_index("ix_toucan_memories_owner_email", table_name="toucan_memories")
    op.drop_table("toucan_memories")
