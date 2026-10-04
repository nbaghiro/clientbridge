"""online shop and booking add-ons

Revision ID: 5d2f8a1c6e93
Revises: 3c7e5a9b1d24
Create Date: 2026-10-04 19:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5d2f8a1c6e93"
down_revision: str | None = "3c7e5a9b1d24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "items", sa.Column("sell_online", sa.Boolean(), server_default="false", nullable=False)
    )
    op.create_check_constraint(
        "ck_items_sell_online_kind", "items", "sell_online = false OR kind = 'product'"
    )
    op.add_column("orders", sa.Column("source", sa.String(), server_default="pos", nullable=False))
    op.create_check_constraint("ck_orders_source", "orders", "source IN ('pos', 'online')")
    op.add_column("orders", sa.Column("pickup_status", sa.String(), nullable=True))
    op.create_check_constraint(
        "ck_orders_pickup_status",
        "orders",
        "pickup_status IS NULL OR pickup_status IN ('unfulfilled', 'ready', 'picked_up')",
    )
    op.create_table(
        "booking_addons",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("booking_id", sa.String(), sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("staff_id", sa.String(), sa.ForeignKey("staff.id"), nullable=True),
        sa.Column("item_id", sa.String(), sa.ForeignKey("items.id"), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_amount_cents", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("quantity > 0", name="ck_booking_addons_quantity"),
    )
    op.create_index("ix_booking_addons_business_id", "booking_addons", ["business_id"])
    op.create_index("ix_booking_addons_booking", "booking_addons", ["business_id", "booking_id"])


def downgrade() -> None:
    op.drop_index("ix_booking_addons_booking", table_name="booking_addons")
    op.drop_index("ix_booking_addons_business_id", table_name="booking_addons")
    op.drop_table("booking_addons")
    op.drop_constraint("ck_orders_pickup_status", "orders", type_="check")
    op.drop_column("orders", "pickup_status")
    op.drop_constraint("ck_orders_source", "orders", type_="check")
    op.drop_column("orders", "source")
    op.drop_constraint("ck_items_sell_online_kind", "items", type_="check")
    op.drop_column("items", "sell_online")
