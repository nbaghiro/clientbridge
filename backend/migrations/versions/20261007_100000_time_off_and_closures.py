"""Store time off and business closures as hours exceptions with a window and a reason.

Revision ID: c4a1f0d7b301
Revises: 9d4f6a8c2e31
Create Date: 2026-10-07 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4a1f0d7b301"
down_revision: str | None = "9d4f6a8c2e31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("hours", sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("hours", sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("hours", sa.Column("reason", sa.String(), nullable=True))
    op.alter_column("hours", "staff_id", existing_type=sa.String(), nullable=True)
    op.drop_constraint("ck_hours_basis", "hours", type_="check")
    op.create_check_constraint(
        "ck_hours_basis", "hours", "basis IN ('recurring', 'date', 'exception')"
    )
    op.create_check_constraint(
        "ck_hours_exception_window",
        "hours",
        "basis != 'exception' OR (starts_at IS NOT NULL AND ends_at > starts_at)",
    )
    op.create_check_constraint(
        "ck_hours_staff", "hours", "basis = 'exception' OR staff_id IS NOT NULL"
    )
    op.create_index("ix_hours_exception", "hours", ["business_id", "basis", "starts_at"])


def downgrade() -> None:
    op.execute("DELETE FROM hours WHERE basis = 'exception'")
    op.drop_index("ix_hours_exception", table_name="hours")
    op.drop_constraint("ck_hours_staff", "hours", type_="check")
    op.drop_constraint("ck_hours_exception_window", "hours", type_="check")
    op.drop_constraint("ck_hours_basis", "hours", type_="check")
    op.create_check_constraint("ck_hours_basis", "hours", "basis IN ('recurring', 'date')")
    op.alter_column("hours", "staff_id", existing_type=sa.String(), nullable=False)
    op.drop_column("hours", "reason")
    op.drop_column("hours", "ends_at")
    op.drop_column("hours", "starts_at")
