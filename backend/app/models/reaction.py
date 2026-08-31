from __future__ import annotations

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class MessageReaction(BaseModel):
    """One emoji reaction by one person on one message. Unlike FeedReaction (one row per
    (post, employee) — re-reacting REPLACES the emoji), a chat message allows the SAME user to
    hold SEVERAL different emoji at once, so the uniqueness key includes `emoji`. Adding an
    emoji the user already holds is a no-op, not a replacement.

    Deliberately its own table rather than JSON on Message: add/remove are independent
    operations, so a read-modify-write column would race between two people reacting at the
    same time. It also keeps reactions structurally incapable of touching the message-derived
    counters — unread/mention counts and the delivery/read watermarks all derive from rows in
    `messages` (see repositories/chat.py's _compute_unread / compute_message_receipts), which
    this table never writes to.
    """

    __tablename__ = "message_reactions"

    __table_args__ = (
        # DB-level guarantee that one user can never hold the same emoji twice on one message.
        # The repo layer additionally swallows the IntegrityError (see add_reaction) so a
        # double-click converges instead of 500-ing — same savepoint idiom as
        # add_participant_if_missing.
        Index("uq_message_reaction", "message_id", "reactor_email", "emoji", unique=True),
    )

    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("messages.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Atlas identity string, canonically lowercased — same convention as Message.sender_email
    # and ConversationParticipant.participant_email. Always the server-verified session email,
    # never a client-supplied value.
    reactor_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    emoji: Mapped[str] = mapped_column(String(8), nullable=False)
