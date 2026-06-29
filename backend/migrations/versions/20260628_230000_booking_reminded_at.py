"""bookings.reminded_at (booking-reminder dedup for the job runner)

Revision ID: d6a1f8b3e927
Revises: c4f7e2a9d810
Create Date: 2026-06-28 23:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "d6a1f8b3e927"
down_revision = "c4f7e2a9d810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bookings", sa.Column("reminded_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("bookings", "reminded_at")
