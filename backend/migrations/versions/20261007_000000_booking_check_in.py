"""Record when a client checks in for a booking.

Revision ID: 5e1a7c3d9b20
Revises: 3c7d1e9a2b40
Create Date: 2026-10-07 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5e1a7c3d9b20"
down_revision: str | None = "3c7d1e9a2b40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "checked_in_at")
