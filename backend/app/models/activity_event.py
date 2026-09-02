from __future__ import annotations

from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Toucan T2 — THE ONE DURABLE EVENT TABLE, and the rule that keeps it from becoming a general
# purpose activity log.
#
# WHY IT EXISTS AT ALL: every other "while you were away" question is answered by querying
# durable records that already exist — chat counts and mentions come from `messages` +
# `conversation_participants`, Hub items from `hub_items` + `hub_item_states`. Calls are the one
# exception. A ring lives entirely in app/services/call_invites.py's in-memory
# CallInviteRegistry, so "somebody called you and you weren't there" is erased by a backend
# restart, a redeploy, or simply by the recipient never having been connected. There is no
# existing row to query, so a row has to be written.
#
# WHAT MAY BE WRITTEN HERE: the semantic fact that something happened to somebody. An event
# type, who it was for, who caused it, and when. That is all.
#
# WHAT MUST NEVER BE WRITTEN HERE, however convenient:
#   * message text, call audio, transcripts, or any other content — this table exists to make
#     COUNTING possible across a restart, not to reconstruct what was said
#   * chat activity. `messages` is already durable and already the source of truth; mirroring it
#     here would create a second, silently-diverging answer to "how many did I miss"
#   * Hub activity, for the same reason (`hub_items` + `hub_item_states` already answer it)
#   * anything Atlas- or Cliq-derived, and never a bearer token
#
# WRITERS: app/realtime/socket.py, at the three points a ring ends without the recipient having
# answered it. READERS: app/repositories/toucan_activity.py, scoped to one viewer. Nothing else.


# The only event type T2 defines. Kept as a constant rather than an enum column so adding a
# second type later is a one-line change with no migration — but note the module rule above:
# a new type is only justified when NO existing durable table can answer the question.
EVENT_CALL_MISSED = "call_missed"


class ActivityEvent(BaseModel):
    """One thing that happened to one person, recorded because nothing else records it.

    `subject_email` is the PERMISSION KEY: it is the person the event is about and the only
    person who may ever read it (see repositories/toucan_activity.py, where every read filters
    on it). It is written from server-derived identity — the recipient of a ring the server
    itself minted — never from anything a client supplied."""

    __tablename__ = "activity_events"

    # "this viewer's events, newest first, since <timestamp>" is the ONLY read shape, and this
    # index serves it directly. Declared here as well as in the migration so
    # `alembic revision --autogenerate` sees no phantom drift.
    __table_args__ = (
        Index("ix_activity_events_subject_created", "subject_email", "created_at"),
    )

    # See EVENT_CALL_MISSED. No DB CHECK constraint — this codebase validates enums at the
    # Python layer only (same as Conversation.type and ToucanMessage.role).
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    # WHO THE EVENT IS FOR. Every query filters on this; there is deliberately no read helper
    # that omits it.
    subject_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # WHO CAUSED IT — the caller, for a missed call. Safe to store and to surface back to the
    # subject: they would have seen the incoming ring carry this same name had they been there
    # (see socket.py's call_invite_incoming payload). Nullable for server-initiated events that
    # have no human actor.
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Opaque correlation handle — the invite id for a missed call. Not shown to users and not
    # required to be resolvable; it exists so a duplicate write can be spotted in support/debug
    # work. Never a conversation id, never a LiveKit room.
    reference_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
