"""Record the accepted estimate a visit was booked from, so it is booked only once."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0023"
down_revision: str | None = "cb0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("estimate_id", sa.String(), sa.ForeignKey("estimates.id"), nullable=True),
    )
    op.create_index("ix_bookings_estimate", "bookings", ["business_id", "estimate_id"])


def downgrade() -> None:
    op.drop_index("ix_bookings_estimate", table_name="bookings")
    op.drop_column("bookings", "estimate_id")
