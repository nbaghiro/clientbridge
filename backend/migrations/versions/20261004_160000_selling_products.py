"""selling products: tax class, product fields, stock, retail commission, walk-in receipts

Revision ID: 3c7e5a9b1d24
Revises: 9b1d4c2e7a10
Create Date: 2026-10-04 16:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3c7e5a9b1d24"
down_revision: str | None = "9b1d4c2e7a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TAX_CLASSES = "'standard', 'federal_only', 'exempt'"


def upgrade() -> None:
    op.execute("UPDATE items SET online_bookable = false WHERE kind NOT IN ('service', 'class')")
    op.create_check_constraint(
        "ck_items_online_bookable_kind",
        "items",
        "online_bookable = false OR kind IN ('service', 'class')",
    )
    op.add_column(
        "items", sa.Column("tax_class", sa.String(), server_default="standard", nullable=False)
    )
    op.create_check_constraint("ck_items_tax_class", "items", f"tax_class IN ({TAX_CLASSES})")
    op.add_column("items", sa.Column("sku", sa.String(), nullable=True))
    op.add_column("items", sa.Column("cost_cents", sa.BigInteger(), nullable=True))
    op.add_column(
        "items", sa.Column("track_stock", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column("items", sa.Column("stock_on_hand", sa.Integer(), nullable=True))
    op.add_column("items", sa.Column("low_stock_at", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_items_stock_kind", "items", "track_stock = false OR kind = 'product'"
    )
    op.create_index(
        "ux_items_business_sku",
        "items",
        ["business_id", "sku"],
        unique=True,
        postgresql_where=sa.text("sku IS NOT NULL"),
    )

    op.add_column(
        "lines", sa.Column("tax_class", sa.String(), server_default="standard", nullable=False)
    )
    op.create_check_constraint("ck_lines_tax_class", "lines", f"tax_class IN ({TAX_CLASSES})")

    op.add_column("orders", sa.Column("receipt_email", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("receipt_phone", sa.String(), nullable=True))
    op.add_column("staff", sa.Column("retail_rate_bps", sa.Integer(), nullable=True))

    op.create_table(
        "stock_movements",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("item_id", sa.String(), sa.ForeignKey("items.id"), nullable=False),
        sa.Column("line_id", sa.String(), sa.ForeignKey("lines.id"), nullable=True),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "reason IN ('sale', 'refund', 'restock')", name="ck_stock_movements_reason"
        ),
    )
    op.create_index("ix_stock_movements_business_id", "stock_movements", ["business_id"])
    op.create_index("ix_stock_movements_item", "stock_movements", ["business_id", "item_id"])
    op.create_index(
        "ux_stock_movements_line_reason",
        "stock_movements",
        ["line_id", "reason"],
        unique=True,
        postgresql_where=sa.text("line_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_table("stock_movements")
    op.drop_column("staff", "retail_rate_bps")
    op.drop_column("orders", "receipt_phone")
    op.drop_column("orders", "receipt_email")
    op.drop_constraint("ck_lines_tax_class", "lines", type_="check")
    op.drop_column("lines", "tax_class")
    op.drop_index("ux_items_business_sku", table_name="items")
    op.drop_constraint("ck_items_stock_kind", "items", type_="check")
    for col in ("low_stock_at", "stock_on_hand", "track_stock", "cost_cents", "sku"):
        op.drop_column("items", col)
    op.drop_constraint("ck_items_tax_class", "items", type_="check")
    op.drop_column("items", "tax_class")
    op.drop_constraint("ck_items_online_bookable_kind", "items", type_="check")
