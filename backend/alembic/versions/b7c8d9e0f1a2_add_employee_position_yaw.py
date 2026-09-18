"""add_employee_position_yaw

Revision ID: b7c8d9e0f1a2
Revises: b2c3d4e5f6a9
Create Date: 2026-09-18 00:00:00.000000

Additive and nullable. The V2 3D office publishes its avatar's exact resting yaw (radians) on
walk_arrived beside V1's four-direction `facing`; persisting it is what lets a reload restore the
exact orientation instead of the nearest compass point. V1 clients never send it and never read it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("employee_positions", sa.Column("yaw", sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("employee_positions", "yaw")
