"""Desk sales: tips, discounts with approval, receipts, held-sale notes, charged visits, pickup lines.

Revision ID: e8b4f0a2c635
Revises: d6a3e7c9f124
Create Date: 2026-10-08 00:04:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "e8b4f0a2c635"
down_revision: str | None = "d6a3e7c9f124"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DOCUMENTS = ("orders", "invoices", "estimates")
_EVENTS = (
    "invoice",
    "sale",
    "payment",
    "fee",
    "refund",
    "dispute",
    "payout",
    "redemption",
    "consumption",
    "forfeit",
    "application",
    "breakage",
    "remittance",
    "earning",
    "approval",
    "staff_payment",
    "adjustment",
    "reversal",
)


def _events(*extra: str) -> str:
    return "event IN (" + ", ".join(f"'{n}'" for n in (*_EVENTS, *extra)) + ")"


def _discount_columns(table: str) -> None:
    op.add_column(table, sa.Column("discount_kind", sa.String(), nullable=True))
    op.add_column(table, sa.Column("discount_value", sa.BigInteger(), nullable=True))
    op.add_column(table, sa.Column("discount_reason", sa.String(), nullable=True))
    op.create_check_constraint(
        f"ck_{table}_discount_kind",
        table,
        "discount_kind IS NULL OR discount_kind IN ('percent', 'amount')",
    )


def upgrade() -> None:
    for table in (*_DOCUMENTS, "lines"):
        _discount_columns(table)
    op.add_column(
        "lines",
        sa.Column("discount_cents", sa.BigInteger(), server_default="0", nullable=False),
    )
    op.add_column(
        "lines",
        sa.Column("sale_discount_cents", sa.BigInteger(), server_default="0", nullable=False),
    )
    op.add_column("lines", sa.Column("staff_id", sa.String(), nullable=True))
    op.create_foreign_key("fk_lines_staff", "lines", "staff", ["staff_id"], ["id"])
    op.add_column(
        "lines", sa.Column("for_pickup", sa.Boolean(), server_default="false", nullable=False)
    )
    op.execute(
        "UPDATE lines SET for_pickup = true WHERE order_id IN"
        " (SELECT id FROM orders WHERE source = 'online')"
    )
    op.add_column("orders", sa.Column("note", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("approved_by", sa.String(), nullable=True))
    op.create_foreign_key("fk_orders_approved_by", "orders", "users", ["approved_by"], ["id"])
    op.add_column("orders", sa.Column("receipt_token", sa.String(), nullable=True))
    op.create_unique_constraint("uq_orders_receipt_token", "orders", ["receipt_token"])
    op.add_column("orders", sa.Column("receipt_channel", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("receipt_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "ck_orders_receipt_channel",
        "orders",
        "receipt_channel IS NULL OR receipt_channel IN ('email', 'sms')",
    )
    # pickup_status now marks a paid online order, so the staff pickup queue never shows unpaid ones
    op.execute(
        "UPDATE orders o SET pickup_status = NULL WHERE o.source = 'online'"
        " AND o.pickup_status = 'unfulfilled' AND NOT EXISTS (SELECT 1 FROM entries e"
        " JOIN accounts a ON a.id = e.account_id WHERE e.subject_type = 'order'"
        " AND e.subject_id = o.id AND e.event = 'payment'"
        " AND a.category IN ('stripe', 'bank', 'cash'))"
    )
    op.add_column(
        "businesses",
        sa.Column("staff_discount_limit_bps", sa.Integer(), server_default="1500", nullable=False),
    )
    op.add_column("users", sa.Column("pin_hash", sa.String(), nullable=True))
    op.add_column(
        "payments", sa.Column("tip_cents", sa.BigInteger(), server_default="0", nullable=False)
    )
    op.add_column("payments", sa.Column("tip_split", JSONB(), nullable=True))
    op.add_column("bookings", sa.Column("order_id", sa.String(), nullable=True))
    op.create_foreign_key("fk_bookings_order", "bookings", "orders", ["order_id"], ["id"])
    op.add_column("bookings", sa.Column("charged_at", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint("ck_entries_event", "entries", type_="check")
    op.create_check_constraint("ck_entries_event", "entries", _events("tip"))


def downgrade() -> None:
    op.drop_constraint("ck_entries_event", "entries", type_="check")
    op.create_check_constraint("ck_entries_event", "entries", _events())
    op.drop_column("bookings", "charged_at")
    op.drop_constraint("fk_bookings_order", "bookings", type_="foreignkey")
    op.drop_column("bookings", "order_id")
    op.drop_column("payments", "tip_split")
    op.drop_column("payments", "tip_cents")
    op.drop_column("users", "pin_hash")
    op.drop_column("businesses", "staff_discount_limit_bps")
    op.drop_constraint("ck_orders_receipt_channel", "orders", type_="check")
    op.drop_column("orders", "receipt_sent_at")
    op.drop_column("orders", "receipt_channel")
    op.drop_constraint("uq_orders_receipt_token", "orders", type_="unique")
    op.drop_column("orders", "receipt_token")
    op.drop_constraint("fk_orders_approved_by", "orders", type_="foreignkey")
    op.drop_column("orders", "approved_by")
    op.drop_column("orders", "note")
    op.drop_column("lines", "for_pickup")
    op.drop_constraint("fk_lines_staff", "lines", type_="foreignkey")
    for column in ("staff_id", "sale_discount_cents", "discount_cents"):
        op.drop_column("lines", column)
    for table in (*_DOCUMENTS, "lines"):
        op.drop_constraint(f"ck_{table}_discount_kind", table, type_="check")
        for column in ("discount_reason", "discount_value", "discount_kind"):
            op.drop_column(table, column)
