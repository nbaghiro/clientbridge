"""lines.parent_type: allow 'order' (POS sale line items)

Revision ID: b2d5f8a31c42
Revises: a1c4e7f20b31
Create Date: 2026-06-29 13:10:00

"""

from alembic import op

revision = "b2d5f8a31c42"
down_revision = "a1c4e7f20b31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_lines_parent_type", "lines", type_="check")
    op.create_check_constraint(
        "ck_lines_parent_type", "lines", "parent_type IN ('invoice', 'estimate', 'order')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_lines_parent_type", "lines", type_="check")
    op.create_check_constraint(
        "ck_lines_parent_type", "lines", "parent_type IN ('invoice', 'estimate')"
    )
