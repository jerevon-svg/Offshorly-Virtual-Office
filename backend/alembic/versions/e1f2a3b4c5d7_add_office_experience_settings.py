"""add_office_experience_settings

Phase 9A — the persistent state behind the Office Experience gallery and the Creator Studio.

TWO ADDITIVE TABLES, NOTHING ELSE TOUCHED:

  office_experience_publications  one row per SEASONAL experience the Creator has switched on or
                                  off, with who did it and when. Starts empty, and absent means
                                  unpublished — so this revision publishes nothing.

  company_settings                a narrow key/value pair with attribution. Phase 9A writes exactly
                                  one key, "office_experience.default". Starts empty, and an absent
                                  row means the 3D office — so this revision changes nobody's
                                  office and needs no seed row.

PURELY ADDITIVE. No existing table, column, index or row is touched. Before this revision is
applied, GET /office/experience answers 500 (the tables are not there) and the frontend falls back
to the two permanent offices without writing anything, so an employee's saved preference survives
the gap untouched.

Revision ID: e1f2a3b4c5d7
Revises: d0e1f2a3b4c6
Create Date: 2026-09-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d7'
down_revision: Union[str, Sequence[str], None] = 'd0e1f2a3b4c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "office_experience_publications",
        sa.Column("experience", sa.String(length=32), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False),
        sa.Column("updated_by", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("experience"),
    )
    # No secondary index: this table holds at most one row per seasonal experience and is read
    # whole on every catalog request. An index would cost more to maintain than it could save.
    op.create_table(
        "company_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("company_settings")
    op.drop_table("office_experience_publications")
