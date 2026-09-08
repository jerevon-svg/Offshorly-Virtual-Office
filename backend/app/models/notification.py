from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Global Notifications V1 — ONE table behind every in-office notification, present and future
# (chat, mentions, calls, Ask-to-Join, quests, missions, badges, Hub, meetings, HR). Deliberately
# NOT activity_events (that table's rule forbids it becoming a general log) and NOT quest_events
# (that ledger answers "what has this person accomplished", is written only by the quest engine,
# and stores no display text).
#
# WHAT MAY BE WRITTEN: one thing that happened which ONE person should be told about — recipient,
# a type discriminator, the words to show, when, whether it has been read, and just enough
# metadata to reopen the thing it is about. Never a second copy of feature state: a notification
# is a POINTER plus a rendered sentence, never the source of truth for what it announces. In
# particular the Kudos/reward ledger (reward_grants) stays authoritative for what was paid — the
# notification only quotes amounts the ledger already granted.
#
# WHO WRITES: services/notifications.py's `notify` (and the typed helpers beside it), and
# nothing else. Feature code never touches this model directly.


class Notification(BaseModel):
    """One notification addressed to one recipient.

    Idempotency is UNIQUE(recipient_email, dedupe_key): the key is a natural handle for the
    thing being announced (`kudos:<post id>`), so a re-click, a retry or a replayed request
    produces the same single row instead of a duplicate bell entry. Callers that have no
    natural key get a generated one, which can never collide.

    `read_at` is the read state (NULL = unread) rather than a boolean, so "when did they see
    this" is answerable later without a schema change.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ux_notifications_recipient_dedupe", "recipient_email", "dedupe_key", unique=True),
        # The panel read: this person's notifications, newest first.
        Index("ix_notifications_recipient_created", "recipient_email", "created_at"),
    )

    recipient_email: Mapped[str] = mapped_column(String(255), nullable=False)
    # Discriminator for the icon/grouping and for future per-type handling. V1 writes only
    # "kudos_received"; every other type in the roadmap is a new value here, not a new table.
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    # Rendered at write time, because it quotes facts that were true then (the Kudos message,
    # the amounts actually granted). Nullable for types that need no second line.
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NAVIGATION. `nav_kind` is the closed set of destinations the client knows how to open
    # (see services/notifications.py's NAV_* constants); `nav_payload` carries the ids that
    # destination needs. A client that does not recognise a kind marks the notification read
    # and does nothing — so adding a destination never breaks an older client.
    nav_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    nav_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
