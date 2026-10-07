"""Hold a waitlist on class bookings and give rooms and stations a capacity and an on/off switch.

Revision ID: e19c7d4b2a65
Revises: d82b5e3a9c14
Create Date: 2026-10-08 10:02:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e19c7d4b2a65"
down_revision: str | None = "d82b5e3a9c14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STATUSES = "'pending', 'confirmed', 'completed', 'canceled', 'no_show'"


def upgrade() -> None:
    op.drop_constraint("ck_bookings_status", "bookings", type_="check")
    op.create_check_constraint(
        "ck_bookings_status", "bookings", f"status IN ({_STATUSES}, 'waitlisted')"
    )
    op.add_column(
        "resources", sa.Column("capacity", sa.Integer(), server_default="1", nullable=False)
    )
    op.add_column(
        "resources", sa.Column("active", sa.Boolean(), server_default="true", nullable=False)
    )
    op.create_check_constraint("ck_resources_capacity", "resources", "capacity > 0")
    op.drop_constraint("ck_resources_category", "resources", type_="check")
    op.create_check_constraint(
        "ck_resources_category", "resources", "category IN ('room', 'station', 'equipment')"
    )


def downgrade() -> None:
    op.execute("UPDATE resources SET category = 'equipment' WHERE category = 'station'")
    op.drop_constraint("ck_resources_category", "resources", type_="check")
    op.create_check_constraint(
        "ck_resources_category", "resources", "category IN ('room', 'equipment')"
    )
    op.drop_constraint("ck_resources_capacity", "resources", type_="check")
    op.drop_column("resources", "active")
    op.drop_column("resources", "capacity")
    op.execute("UPDATE bookings SET status = 'canceled' WHERE status = 'waitlisted'")
    op.drop_constraint("ck_bookings_status", "bookings", type_="check")
    op.create_check_constraint("ck_bookings_status", "bookings", f"status IN ({_STATUSES})")
