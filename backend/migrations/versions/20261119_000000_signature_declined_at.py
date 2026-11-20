"""Date a declined contract request by its own column, so a later write to the row can't move it."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0042"
down_revision: str | None = "cb0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("signatures", sa.Column("declined_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE signatures SET declined_at = updated_at WHERE status = 'declined'")


def downgrade() -> None:
    op.drop_column("signatures", "declined_at")
