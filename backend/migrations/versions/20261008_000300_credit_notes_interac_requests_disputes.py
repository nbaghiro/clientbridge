"""Credit notes on refunds, Interac request channel and expiry, dispute state, sale numbers.

Revision ID: d6a3e7c9f124
Revises: c4f2d6b8e013
Create Date: 2026-10-08 00:03:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d6a3e7c9f124"
down_revision: str | None = "c4f2d6b8e013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PAYMENT_COLUMNS = (
    "dispute_respond_by",
    "dispute_reason",
    "dispute_status",
    "expires_at",
    "channel",
    "credit_note",
    "reason",
)


def upgrade() -> None:
    op.add_column("payments", sa.Column("reason", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("credit_note", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("channel", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("payments", sa.Column("dispute_status", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("dispute_reason", sa.String(), nullable=True))
    op.add_column(
        "payments", sa.Column("dispute_respond_by", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        "ck_payments_channel", "payments", "channel IS NULL OR channel IN ('email', 'sms')"
    )
    op.create_check_constraint(
        "ck_payments_dispute_status",
        "payments",
        "dispute_status IS NULL OR dispute_status IN "
        "('needs_response', 'under_review', 'won', 'lost')",
    )
    op.create_index(
        "ux_payments_credit_note",
        "payments",
        ["business_id", "credit_note"],
        unique=True,
        postgresql_where=sa.text("credit_note IS NOT NULL"),
    )
    op.add_column("orders", sa.Column("number", sa.BigInteger(), nullable=True))
    op.execute(
        "UPDATE orders o SET number = n.rn FROM ("
        " SELECT id, row_number() OVER (PARTITION BY business_id ORDER BY created_at, id) AS rn"
        " FROM orders) n WHERE n.id = o.id"
    )
    op.create_unique_constraint("uq_orders_business_number", "orders", ["business_id", "number"])


def downgrade() -> None:
    op.drop_constraint("uq_orders_business_number", "orders", type_="unique")
    op.drop_column("orders", "number")
    op.drop_index("ux_payments_credit_note", table_name="payments")
    op.drop_constraint("ck_payments_dispute_status", "payments", type_="check")
    op.drop_constraint("ck_payments_channel", "payments", type_="check")
    for column in _PAYMENT_COLUMNS:
        op.drop_column("payments", column)
