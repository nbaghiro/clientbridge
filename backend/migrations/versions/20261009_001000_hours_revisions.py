"""Track the current staff-week revision for optimistic concurrency."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbsync04"
down_revision: str | None = "cbsync03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "staff", sa.Column("hours_revision", sa.BigInteger(), nullable=False, server_default="0")
    )
    op.create_check_constraint("ck_staff_hours_revision", "staff", "hours_revision >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_staff_hours_revision", "staff", type_="check")
    op.drop_column("staff", "hours_revision")
