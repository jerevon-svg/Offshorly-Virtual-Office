from __future__ import annotations

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class FeedPost(BaseModel):
    """One activity/post on an employee's feed. `type` is a plain string, not a DB enum, so new
    activity types (see Company Hub V1's extensibility goal) never need a schema migration.
    `source_hub_item_id` links a Hub-triggered post (birthday/congratulation) back to the Hub
    item that created it — see `uq_feed_hub_activity` below for the dedup this enables."""

    __tablename__ = "feed_posts"

    __table_args__ = (
        # Partial unique index — same idiom as ConversationRequest.uq_pending_request. Lets the
        # SAME hub item generate at most one activity PER AUTHOR (so Bon double-clicking "Wish
        # Happy Birthday" doesn't create two posts), while still letting different colleagues
        # each create their own activity off the same hub item.
        Index(
            "uq_feed_hub_activity",
            "source_hub_item_id",
            "author_email",
            unique=True,
            sqlite_where=text("source_hub_item_id IS NOT NULL"),
            postgresql_where=text("source_hub_item_id IS NOT NULL"),
        ),
    )

    target_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    author_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_hub_item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("hub_items.id", ondelete="SET NULL"), nullable=True, index=True
    )


class FeedReaction(BaseModel):
    """One employee's reaction to one post — unique per (post, employee) so reacting again just
    changes the emoji rather than creating a duplicate (see upsert_reaction)."""

    __tablename__ = "feed_reactions"

    __table_args__ = (
        Index("uq_feed_reaction", "post_id", "employee_email", unique=True),
    )

    post_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    emoji: Mapped[str] = mapped_column(String(8), nullable=False)


class FeedComment(BaseModel):
    """A comment on a post, or a reply to a top-level comment. `parent_comment_id` is
    self-referential; V1 enforces exactly one level of nesting at the repository layer (a
    comment whose own parent is set can never be used as a parent — see
    repositories/feed.py's create_comment), not via a DB constraint, so the check can carry a
    clear error message."""

    __tablename__ = "feed_comments"

    post_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_comment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("feed_comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    author_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
