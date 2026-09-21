"""add_employee_permissions

Phase 7F Step 2 — the permission foundation for the Executive Access Pass. One additive table,
`employee_permissions`: a named capability granted to an employee, with who granted it, when, and
an optional revocation that keeps the row (see app/models/employee_permission.py).

PURELY ADDITIVE. No existing table, column, index or row is touched, and nothing in the running
product reads the new table yet — attendance, checkout, Zoho submission and quest XP are all
unchanged by this revision.

Revision ID: d0e1f2a3b4c6
Revises: c9d0e1f2a3b4
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd0e1f2a3b4c6'
down_revision: Union[str, Sequence[str], None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "employee_permissions",
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("permission", sa.String(length=64), nullable=False),
        sa.Column("granted_by", sa.String(length=255), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("email", "permission"),
    )
    # The only query shape this table has: "what does this one person hold right now"
    # (repositories/employee_permissions.list_active). The composite PK already covers the
    # single-permission lookup.
    op.create_index(
        "ix_employee_permissions_email",
        "employee_permissions",
        ["email"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_employee_permissions_email", table_name="employee_permissions")
    op.drop_table("employee_permissions")
