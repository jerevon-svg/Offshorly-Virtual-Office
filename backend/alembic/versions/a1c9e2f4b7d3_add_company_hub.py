"""add_company_hub

Revision ID: a1c9e2f4b7d3
Revises: cbc44e700269
Create Date: 2026-08-25 00:00:00.000000

"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c9e2f4b7d3'
down_revision: Union[str, Sequence[str], None] = 'cbc44e700269'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


hub_items_table = sa.table(
    "hub_items",
    sa.column("id", sa.String),
    sa.column("type", sa.String),
    sa.column("title", sa.String),
    sa.column("description", sa.Text),
    sa.column("image_url", sa.String),
    sa.column("start_at", sa.DateTime(timezone=True)),
    sa.column("end_at", sa.DateTime(timezone=True)),
    sa.column("priority", sa.String),
    sa.column("cta_label", sa.String),
    sa.column("cta_action", sa.String),
    sa.column("audience_email", sa.String),
    sa.column("created_by", sa.String),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "hub_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("image_url", sa.String(1000), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("priority", sa.String(10), nullable=False, server_default="normal"),
        sa.Column("cta_label", sa.String(80), nullable=True),
        sa.Column("cta_action", sa.String(255), nullable=True),
        sa.Column("audience_email", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_hub_items_type", "hub_items", ["type"])
    op.create_index("ix_hub_items_priority", "hub_items", ["priority"])
    op.create_index("ix_hub_items_audience_email", "hub_items", ["audience_email"])

    op.create_table(
        "hub_item_states",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "hub_item_id",
            sa.String(36),
            sa.ForeignKey("hub_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("employee_email", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="seen"),
        sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_hub_item_states_hub_item_id", "hub_item_states", ["hub_item_id"])
    op.create_index("ix_hub_item_states_employee_email", "hub_item_states", ["employee_email"])
    op.create_index(
        "uq_hub_item_state", "hub_item_states", ["hub_item_id", "employee_email"], unique=True
    )

    # Seed a few V1 demo items so the Hub has real content to show/test immediately after
    # deploy, rather than shipping an always-empty feed with no admin UI yet to populate it.
    now = datetime.now(timezone.utc)
    op.bulk_insert(
        hub_items_table,
        [
            {
                "id": str(uuid.uuid4()),
                "type": "whatsnew",
                "title": "Welcome to the Company Hub",
                "description": "Announcements, birthdays, recognitions, and surveys now show up "
                "here whenever you check in. Reopen this anytime with the Hub button.",
                "image_url": None,
                "start_at": now,
                "end_at": None,
                "priority": "normal",
                "cta_label": "See What's New",
                "cta_action": None,
                "audience_email": None,
                "created_by": "system",
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": str(uuid.uuid4()),
                "type": "announcement",
                "title": "Company Hub V1 is live",
                "description": "Required items must be acknowledged before you can enter the "
                "office — everything else you can dismiss whenever you're ready.",
                "image_url": None,
                "start_at": now,
                "end_at": now + timedelta(days=30),
                "priority": "required",
                "cta_label": "Read More",
                "cta_action": None,
                "audience_email": None,
                "created_by": "system",
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": str(uuid.uuid4()),
                "type": "recognition",
                "title": "Employee of the Month",
                "description": "Congratulate this month's top performer for going above and "
                "beyond for the team.",
                "image_url": None,
                "start_at": now,
                "end_at": now + timedelta(days=14),
                "priority": "important",
                "cta_label": "Congratulate",
                "cta_action": None,
                "audience_email": None,
                "created_by": "system",
                "created_at": now,
                "updated_at": now,
            },
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_hub_item_state", table_name="hub_item_states")
    op.drop_index("ix_hub_item_states_employee_email", table_name="hub_item_states")
    op.drop_index("ix_hub_item_states_hub_item_id", table_name="hub_item_states")
    op.drop_table("hub_item_states")

    op.drop_index("ix_hub_items_audience_email", table_name="hub_items")
    op.drop_index("ix_hub_items_priority", table_name="hub_items")
    op.drop_index("ix_hub_items_type", table_name="hub_items")
    op.drop_table("hub_items")
