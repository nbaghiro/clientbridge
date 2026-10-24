"""Name the staff who offer a service or class; an empty list means every member."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0029"
down_revision: str | None = "cb0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "items",
        sa.Column("staff_ids", postgresql.ARRAY(sa.String()), server_default="{}", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("items", "staff_ids")
