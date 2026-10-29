"""Record the membership that covered a visit, so its included visits per period can be counted."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0037"
down_revision: str | None = "cb0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("subscription_id", sa.String(), sa.ForeignKey("subscriptions.id"), nullable=True),
    )
    op.create_index("ix_bookings_subscription", "bookings", ["subscription_id"])


def downgrade() -> None:
    op.drop_index("ix_bookings_subscription", table_name="bookings")
    op.drop_column("bookings", "subscription_id")
