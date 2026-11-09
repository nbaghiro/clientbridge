"""Record when a client last moved a visit from their manage link, for staff's feed and history."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0040"
down_revision: str | None = "cb0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "bookings", sa.Column("rescheduled_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("bookings", "rescheduled_at")
