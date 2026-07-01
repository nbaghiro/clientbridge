"""bookings.deposit_amount_cents (computed deposit owed)

Revision ID: c4f7e2a9d810
Revises: b9e3f1a7d540
Create Date: 2026-06-28 22:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "c4f7e2a9d810"
down_revision = "b9e3f1a7d540"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("deposit_amount_cents", sa.BigInteger(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("bookings", "deposit_amount_cents")
