"""add_employee_feed

Revision ID: f3a7c1d9e8b2
Revises: a1c9e2f4b7d3
Create Date: 2026-08-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a7c1d9e8b2'
down_revision: Union[str, Sequence[str], None] = 'a1c9e2f4b7d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("hub_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("target_employee_email", sa.String(255), nullable=True))
    op.create_index("ix_hub_items_target_employee_email", "hub_items", ["target_employee_email"])

    op.create_table(
        "feed_posts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("target_email", sa.String(255), nullable=False),
        sa.Column("author_email", sa.String(255), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "source_hub_item_id",
            sa.String(36),
            sa.ForeignKey("hub_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_feed_posts_target_email", "feed_posts", ["target_email"])
    op.create_index("ix_feed_posts_author_email", "feed_posts", ["author_email"])
    op.create_index("ix_feed_posts_type", "feed_posts", ["type"])
    op.create_index("ix_feed_posts_source_hub_item_id", "feed_posts", ["source_hub_item_id"])
    op.create_index(
        "uq_feed_hub_activity",
        "feed_posts",
        ["source_hub_item_id", "author_email"],
        unique=True,
        sqlite_where=sa.text("source_hub_item_id IS NOT NULL"),
        postgresql_where=sa.text("source_hub_item_id IS NOT NULL"),
    )

    op.create_table(
        "feed_reactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "post_id", sa.String(36), sa.ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("employee_email", sa.String(255), nullable=False),
        sa.Column("emoji", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_feed_reactions_post_id", "feed_reactions", ["post_id"])
    op.create_index("ix_feed_reactions_employee_email", "feed_reactions", ["employee_email"])
    op.create_index(
        "uq_feed_reaction", "feed_reactions", ["post_id", "employee_email"], unique=True
    )

    op.create_table(
        "feed_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "post_id", sa.String(36), sa.ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "parent_comment_id",
            sa.String(36),
            sa.ForeignKey("feed_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("author_email", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_feed_comments_post_id", "feed_comments", ["post_id"])
    op.create_index("ix_feed_comments_parent_comment_id", "feed_comments", ["parent_comment_id"])
    op.create_index("ix_feed_comments_author_email", "feed_comments", ["author_email"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_feed_comments_author_email", table_name="feed_comments")
    op.drop_index("ix_feed_comments_parent_comment_id", table_name="feed_comments")
    op.drop_index("ix_feed_comments_post_id", table_name="feed_comments")
    op.drop_table("feed_comments")

    op.drop_index("uq_feed_reaction", table_name="feed_reactions")
    op.drop_index("ix_feed_reactions_employee_email", table_name="feed_reactions")
    op.drop_index("ix_feed_reactions_post_id", table_name="feed_reactions")
    op.drop_table("feed_reactions")

    op.drop_index("uq_feed_hub_activity", table_name="feed_posts")
    op.drop_index("ix_feed_posts_source_hub_item_id", table_name="feed_posts")
    op.drop_index("ix_feed_posts_type", table_name="feed_posts")
    op.drop_index("ix_feed_posts_author_email", table_name="feed_posts")
    op.drop_index("ix_feed_posts_target_email", table_name="feed_posts")
    op.drop_table("feed_posts")

    op.drop_index("ix_hub_items_target_employee_email", table_name="hub_items")
    with op.batch_alter_table("hub_items", schema=None) as batch_op:
        batch_op.drop_column("target_employee_email")
