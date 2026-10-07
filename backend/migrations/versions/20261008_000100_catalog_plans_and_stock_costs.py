"""Plan details on catalog items, and a unit cost and correction reason on stock movements.

Revision ID: b3e1c5a7d902
Revises: 9d4f6a8c2e31
Create Date: 2026-10-08 00:01:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b3e1c5a7d902"
down_revision: str | None = "9d4f6a8c2e31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("items", sa.Column("covers_item_id", sa.String(), nullable=True))
    op.create_foreign_key("items_covers_item_id_fkey", "items", "items", ["covers_item_id"], ["id"])
    op.add_column("items", sa.Column("visits_per_period", sa.Integer(), nullable=True))
    op.add_column("items", sa.Column("member_discount_bps", sa.Integer(), nullable=True))
    op.add_column(
        "items", sa.Column("gift_amounts", postgresql.ARRAY(sa.BigInteger()), nullable=True)
    )
    op.add_column("inventory", sa.Column("unit_cost_cents", sa.BigInteger(), nullable=True))
    op.drop_constraint("ck_inventory_reason", "inventory", type_="check")
    op.create_check_constraint(
        "ck_inventory_reason", "inventory", "reason IN ('sale', 'refund', 'restock', 'correction')"
    )


def downgrade() -> None:
    op.execute("UPDATE inventory SET reason = 'restock' WHERE reason = 'correction'")
    op.drop_constraint("ck_inventory_reason", "inventory", type_="check")
    op.create_check_constraint(
        "ck_inventory_reason", "inventory", "reason IN ('sale', 'refund', 'restock')"
    )
    op.drop_column("inventory", "unit_cost_cents")
    op.drop_column("items", "gift_amounts")
    op.drop_column("items", "member_discount_bps")
    op.drop_column("items", "visits_per_period")
    op.drop_constraint("items_covers_item_id_fkey", "items", type_="foreignkey")
    op.drop_column("items", "covers_item_id")
