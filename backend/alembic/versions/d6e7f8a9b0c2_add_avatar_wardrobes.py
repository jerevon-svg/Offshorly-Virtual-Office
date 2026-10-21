"""add avatar_wardrobes (Character Studio EDIT: an employee's saved HumanBase outfit)

One row per employee, keyed by the verified email. Absent = never edited (the character wears its
approved default). Additive only: no existing table is touched, so downgrade is a plain drop.

Revision ID: d6e7f8a9b0c2
Revises: c5d6e7f8a9b1
Create Date: 2026-10-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd6e7f8a9b0c2'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "avatar_wardrobes",
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("nickname", sa.String(length=40), nullable=True),
        sa.Column("outfit", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("avatar_wardrobes")
