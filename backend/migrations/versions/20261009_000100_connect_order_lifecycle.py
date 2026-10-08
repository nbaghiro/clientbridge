"""Add explicit preparation and pickup preferences for Connect orders."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbconnect01"
down_revision: str | None = "a7c2e9d4f018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_orders_pickup_status", "orders", type_="check")
    op.create_check_constraint(
        "ck_orders_pickup_status",
        "orders",
        "pickup_status IS NULL OR pickup_status IN ('unfulfilled', 'preparing', 'ready', 'picked_up')",
    )
    op.add_column("orders", sa.Column("preparing_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("pickup_from", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("pickup_to", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "orders", sa.Column("notify_sms", sa.Boolean(), server_default="true", nullable=False)
    )


def downgrade() -> None:
    op.execute("UPDATE orders SET pickup_status = 'unfulfilled' WHERE pickup_status = 'preparing'")
    op.drop_constraint("ck_orders_pickup_status", "orders", type_="check")
    op.create_check_constraint(
        "ck_orders_pickup_status",
        "orders",
        "pickup_status IS NULL OR pickup_status IN ('unfulfilled', 'ready', 'picked_up')",
    )
    for column in ("notify_sms", "pickup_to", "pickup_from", "preparing_at"):
        op.drop_column("orders", column)
