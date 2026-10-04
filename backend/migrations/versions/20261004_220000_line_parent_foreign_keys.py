"""lines point at their estimate, invoice or order through real foreign keys

Revision ID: 3e8b1d6f4a27
Revises: 9c3b7e2f5a14
Create Date: 2026-10-04 22:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3e8b1d6f4a27"
down_revision: str | None = "9c3b7e2f5a14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PARENTS = [("estimate", "estimates"), ("invoice", "invoices"), ("order", "orders")]


def upgrade() -> None:
    for parent, table in _PARENTS:
        op.add_column("lines", sa.Column(f"{parent}_id", sa.String(), nullable=True))
        op.execute(f"UPDATE lines SET {parent}_id = parent_id WHERE parent_type = '{parent}'")
        op.create_foreign_key(f"lines_{parent}_id_fkey", "lines", table, [f"{parent}_id"], ["id"])
        op.create_index(f"ix_lines_{parent}", "lines", [f"{parent}_id"])
    op.create_check_constraint(
        "ck_lines_parent", "lines", "num_nonnulls(estimate_id, invoice_id, order_id) = 1"
    )
    op.drop_index("ix_lines_parent", table_name="lines")
    op.drop_constraint("ck_lines_parent_type", "lines", type_="check")
    op.drop_column("lines", "parent_type")
    op.drop_column("lines", "parent_id")


def downgrade() -> None:
    op.add_column("lines", sa.Column("parent_type", sa.String(), nullable=True))
    op.add_column("lines", sa.Column("parent_id", sa.String(), nullable=True))
    for parent, _ in _PARENTS:
        op.execute(
            f"UPDATE lines SET parent_type = '{parent}', parent_id = {parent}_id"
            f" WHERE {parent}_id IS NOT NULL"
        )
    op.alter_column("lines", "parent_type", nullable=False)
    op.alter_column("lines", "parent_id", nullable=False)
    op.create_check_constraint(
        "ck_lines_parent_type", "lines", "parent_type IN ('invoice', 'estimate', 'order')"
    )
    op.create_index("ix_lines_parent", "lines", ["parent_type", "parent_id"])
    op.drop_constraint("ck_lines_parent", "lines", type_="check")
    for parent, _ in reversed(_PARENTS):
        op.drop_index(f"ix_lines_{parent}", table_name="lines")
        op.drop_constraint(f"lines_{parent}_id_fkey", "lines", type_="foreignkey")
        op.drop_column("lines", f"{parent}_id")
