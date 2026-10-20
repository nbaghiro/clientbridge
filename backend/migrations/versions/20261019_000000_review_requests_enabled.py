"""Let a business turn off the review requests sent the morning after a completed visit."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0024"
down_revision: str | None = "cb0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column("review_requests_enabled", sa.Boolean(), server_default="true", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("businesses", "review_requests_enabled")
