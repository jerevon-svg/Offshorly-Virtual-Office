"""add the avatar generation authority: consents, spending ledger, runs

Additive only (three new tables, no existing table touched), so downgrade is a plain drop of the three.

Revision ID: e7f8a9b0c1d3
Revises: d6e7f8a9b0c2
Create Date: 2026-10-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e7f8a9b0c1d3'
down_revision: Union[str, Sequence[str], None] = 'd6e7f8a9b0c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "avatar_generation_consents",
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("photo_sha256", sa.String(length=64), nullable=False),
        sa.Column("statement", sa.String(length=32), nullable=False),
        sa.Column("attested_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email", "photo_sha256"),
    )
    op.create_table(
        "avatar_spend_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("person_id", sa.String(length=64), nullable=False),
        sa.Column("stage", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=True),
        sa.Column("unit", sa.String(length=16), nullable=True),
        sa.Column("input_sha256", sa.String(length=64), nullable=False),
        sa.Column("photo_sha256", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("approved_by", sa.String(length=255), nullable=True),
        sa.Column("consent", sa.String(length=255), nullable=False),
        sa.Column("estimate", sa.Float(), nullable=False),
        sa.Column("actual", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.JSON(), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_avatar_spend_records_email_stage", "avatar_spend_records", ["email", "stage"])
    op.create_index("ix_avatar_spend_records_created_at", "avatar_spend_records", ["created_at"])
    op.create_table(
        "avatar_generation_runs",
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("photo_sha256", sa.String(length=64), nullable=False),
        sa.Column("person_id", sa.String(length=64), nullable=False),
        sa.Column("stage", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("artifacts", sa.JSON(), nullable=False),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email", "photo_sha256"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("avatar_generation_runs")
    op.drop_index("ix_avatar_spend_records_created_at", table_name="avatar_spend_records")
    op.drop_index("ix_avatar_spend_records_email_stage", table_name="avatar_spend_records")
    op.drop_table("avatar_spend_records")
    op.drop_table("avatar_generation_consents")
