"""add last_delivered_at

Revision ID: 044622847be4
Revises: 0cda7ceb4522
Create Date: 2026-08-14 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '044622847be4'
down_revision: Union[str, Sequence[str], None] = '0cda7ceb4522'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('conversation_participants', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_delivered_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('conversation_participants', schema=None) as batch_op:
        batch_op.drop_column('last_delivered_at')
