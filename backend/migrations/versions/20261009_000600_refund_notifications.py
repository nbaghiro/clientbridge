"""Preserve the receipt choice while a refund is processing."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbpayments02"
down_revision: str | None = "cbpayments01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column("refund_notify", sa.Boolean(), server_default=sa.true(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("payments", "refund_notify")
