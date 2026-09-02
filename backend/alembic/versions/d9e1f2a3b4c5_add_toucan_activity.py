"""add_toucan_activity

Revision ID: d9e1f2a3b4c5
Revises: c8f1a2d3e4b5
Create Date: 2026-09-02 00:00:00.000000

Toucan T2 — durable "while you were away" metadata. Two tables, no backfill and no data
migration, because there is nothing to migrate FROM:

  * `activity_events` records missed calls. Before this revision a missed call existed only in
    app/services/call_invites.py's in-memory registry, which means every missed call that has
    ever happened is already gone. Starting empty is the only honest option.

  * `toucan_attention_cursors` records when each person was last seen. Before this revision no
    durable presence timestamp existed at all (the closest column, employee_positions.updated_at,
    means "last finished walking", not "last seen"), so there is no prior value to derive one
    from. Rows appear as people connect.

DELIBERATELY NOT ADDED HERE: any table mirroring chat or Hub activity. Those questions are
answered by querying `messages`, `conversation_participants`, `hub_items` and `hub_item_states`,
which are already durable and are already the source of truth. A mirror would be a second
answer, free to drift.

Dropping both tables restores exactly the T1 state: Toucan keeps its transcript and loses the
ability to say what you missed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9e1f2a3b4c5'
down_revision: Union[str, Sequence[str], None] = 'c8f1a2d3e4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "activity_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_type", sa.String(32), nullable=False),
        # The permission key — every read filters on it. See app/models/activity_event.py.
        sa.Column("subject_email", sa.String(255), nullable=False),
        sa.Column("actor_email", sa.String(255), nullable=True),
        sa.Column("reference_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_activity_events_event_type", "activity_events", ["event_type"])
    op.create_index("ix_activity_events_subject_email", "activity_events", ["subject_email"])
    # "this viewer's events since <timestamp>" is the ONLY read shape — served directly.
    op.create_index(
        "ix_activity_events_subject_created",
        "activity_events",
        ["subject_email", "created_at"],
    )

    op.create_table(
        "toucan_attention_cursors",
        sa.Column("id", sa.String(36), primary_key=True),
        # One row per person, upserted in place — unique so a second row cannot split a history.
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        # Null until this person's first observed absence.
        sa.Column("away_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_toucan_attention_cursors_email", "toucan_attention_cursors", ["email"], unique=True
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_toucan_attention_cursors_email", table_name="toucan_attention_cursors")
    op.drop_table("toucan_attention_cursors")
    op.drop_index("ix_activity_events_subject_created", table_name="activity_events")
    op.drop_index("ix_activity_events_subject_email", table_name="activity_events")
    op.drop_index("ix_activity_events_event_type", table_name="activity_events")
    op.drop_table("activity_events")
