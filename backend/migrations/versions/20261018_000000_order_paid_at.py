"""Store when an order was paid, for staff devices that sync orders without the ledger."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0009"
down_revision: str | None = "cb0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BACKFILL = """
UPDATE orders o SET paid_at = paid.at
FROM (
    SELECT order_id, max(coalesce(paid_at, created_at)) AS at, sum(amount_cents) AS cents
    FROM payments
    WHERE kind = 'payment' AND status = 'succeeded' AND order_id IS NOT NULL
    GROUP BY order_id
) paid
WHERE paid.order_id = o.id AND o.status <> 'void' AND paid.cents >= o.total_cents
"""


def upgrade() -> None:
    op.add_column("orders", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(_BACKFILL)


def downgrade() -> None:
    op.drop_column("orders", "paid_at")
