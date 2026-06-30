"""businesses.stripe_terminal_location_id

Revision ID: e9d2a4c7b318
Revises: c4f8a1b2e7d9
Create Date: 2026-06-30 12:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "e9d2a4c7b318"
down_revision = "c4f8a1b2e7d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "businesses", sa.Column("stripe_terminal_location_id", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("businesses", "stripe_terminal_location_id")
