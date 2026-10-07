"""Online booking rules, client manage links, staff shown online and add-ons offered at booking.

Revision ID: f3a8b6c1d907
Revises: e19c7d4b2a65
Create Date: 2026-10-08 10:03:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f3a8b6c1d907"
down_revision: str | None = "e19c7d4b2a65"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column(
            "booking_policy",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )
    op.add_column(
        "staff",
        sa.Column("bookable_online", sa.Boolean(), server_default="true", nullable=False),
    )
    op.add_column("bookings", sa.Column("manage_token", sa.String(), nullable=True))
    op.create_unique_constraint("bookings_manage_token_key", "bookings", ["manage_token"])
    op.add_column(
        "bookings",
        sa.Column("reschedule_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("items", sa.Column("addon", sa.Boolean(), server_default="false", nullable=False))
    op.add_column(
        "items",
        sa.Column("addon_for", postgresql.ARRAY(sa.String()), server_default="{}", nullable=False),
    )
    op.create_check_constraint("ck_items_addon_kind", "items", "addon = false OR kind = 'product'")
    # Until now every product sold online was offered at booking; keep that until the owner chooses.
    op.execute("UPDATE items SET addon = true WHERE kind = 'product' AND sell_online")


def downgrade() -> None:
    op.drop_constraint("ck_items_addon_kind", "items", type_="check")
    op.drop_column("items", "addon_for")
    op.drop_column("items", "addon")
    op.drop_column("bookings", "reschedule_count")
    op.drop_constraint("bookings_manage_token_key", "bookings", type_="unique")
    op.drop_column("bookings", "manage_token")
    op.drop_column("staff", "bookable_online")
    op.drop_column("businesses", "booking_policy")
