"""add_employee_attendance

Revision ID: b1c2d3e4f5a6
Revises: e6b3c5d7a9f1
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = 'e6b3c5d7a9f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "employee_attendance",
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("employee_attendance")
