"""Store when an order was paid, for staff devices that sync orders without the ledger."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0017"
down_revision: str | None = "cb0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "paid_at")
