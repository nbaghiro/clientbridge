"""Account settings: setup list dismissal, PST number, invite times, removed members.

Revision ID: b7d2f4a96c13
Revises: a1c3e5f70b21
Create Date: 2026-10-08 00:20:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d2f4a96c13"
down_revision: str | None = "a1c3e5f70b21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "businesses", sa.Column("setup_dismissed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("businesses", sa.Column("pst_number", sa.String(), nullable=True))
    op.add_column("staff", sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "staff", sa.Column("invited_by", sa.String(), sa.ForeignKey("users.id"), nullable=True)
    )
    op.execute("UPDATE staff SET invited_at = created_at WHERE status = 'invited'")
    op.drop_constraint("ck_staff_status", "staff", type_="check")
    op.create_check_constraint(
        "ck_staff_status", "staff", "status IN ('active', 'invited', 'removed')"
    )


def downgrade() -> None:
    op.execute("UPDATE staff SET status = 'invited' WHERE status = 'removed'")
    op.drop_constraint("ck_staff_status", "staff", type_="check")
    op.create_check_constraint("ck_staff_status", "staff", "status IN ('active', 'invited')")
    op.drop_column("staff", "invited_by")
    op.drop_column("staff", "invited_at")
    op.drop_column("businesses", "pst_number")
    op.drop_column("businesses", "setup_dismissed_at")
