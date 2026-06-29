"""bookings.deposit_status (none|pending|collected|forfeited)

Revision ID: d1a4c7e90b21
Revises: a4f7c1e80b96
Create Date: 2026-06-29 15:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "d1a4c7e90b21"
down_revision = "a4f7c1e80b96"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("deposit_status", sa.String(), nullable=False, server_default="none"),
    )
    op.create_check_constraint(
        "ck_bookings_deposit_status",
        "bookings",
        "deposit_status IN ('none', 'pending', 'collected', 'forfeited')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_bookings_deposit_status", "bookings", type_="check")
    op.drop_column("bookings", "deposit_status")
