"""items.stripe_price_id (cached recurring Stripe Price per subscription item)

Revision ID: e7c2d4a9f110
Revises: d6a1f8b3e927
Create Date: 2026-06-29 12:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "e7c2d4a9f110"
down_revision = "d6a1f8b3e927"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("stripe_price_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("items", "stripe_price_id")
