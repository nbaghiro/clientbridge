"""payments.order_id: link a Terminal payment to its POS order

Revision ID: c3e6a9b42d53
Revises: b2d5f8a31c42
Create Date: 2026-06-29 13:20:00

"""

import sqlalchemy as sa
from alembic import op

revision = "c3e6a9b42d53"
down_revision = "b2d5f8a31c42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("order_id", sa.String(), nullable=True))
    op.create_foreign_key("fk_payments_order", "payments", "orders", ["order_id"], ["id"])
    op.create_index("ix_payments_order", "payments", ["order_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_payments_order", table_name="payments")
    op.drop_constraint("fk_payments_order", "payments", type_="foreignkey")
    op.drop_column("payments", "order_id")
