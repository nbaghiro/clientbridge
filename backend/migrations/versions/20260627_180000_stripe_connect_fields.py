"""Stripe Connect fields: businesses.stripe_charges_enabled + clients.stripe_customer_id

Revision ID: b7d4e2f8a1c6
Revises: 5e8a2c1f9b34
Create Date: 2026-06-27 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d4e2f8a1c6"
down_revision: str | None = "5e8a2c1f9b34"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column(
            "stripe_charges_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column("clients", sa.Column("stripe_customer_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("clients", "stripe_customer_id")
    op.drop_column("businesses", "stripe_charges_enabled")
