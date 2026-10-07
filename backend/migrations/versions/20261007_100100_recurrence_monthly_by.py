"""Let a monthly series repeat on the same weekday (the 2nd Tuesday) as well as the same date.

Revision ID: d82b5e3a9c14
Revises: c4a1f0d7b301
Create Date: 2026-10-07 10:01:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d82b5e3a9c14"
down_revision: str | None = "c4a1f0d7b301"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recurrences",
        sa.Column("monthly_by", sa.String(), server_default="date", nullable=False),
    )
    op.create_check_constraint(
        "ck_recurrences_monthly_by", "recurrences", "monthly_by IN ('date', 'weekday')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_recurrences_monthly_by", "recurrences", type_="check")
    op.drop_column("recurrences", "monthly_by")
