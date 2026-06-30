"""broadcasts.body for scheduled fan-out

Revision ID: c4f8a1b2e7d9
Revises: d5b1e7a3c9f2
Create Date: 2026-06-30 10:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "c4f8a1b2e7d9"
down_revision = "d5b1e7a3c9f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("broadcasts", sa.Column("body", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("broadcasts", "body")
