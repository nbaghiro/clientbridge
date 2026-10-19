"""Record when the member set off for a visit, so the client can be told they're on the way."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0021"
down_revision: str | None = "cb0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("departed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "departed_at")
