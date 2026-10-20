"""Let staff choose which booking photos the client sees on their visit page."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0027"
down_revision: str | None = "cb0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("files", sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("files", "shared_at")
