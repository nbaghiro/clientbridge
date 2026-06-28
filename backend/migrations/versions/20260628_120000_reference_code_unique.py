"""reference_code unique (Interac auto-match collision guard)

Revision ID: d5a2b7c10f93
Revises: c3f1a9d24e57
Create Date: 2026-06-28 12:00:00

"""

from alembic import op

revision = "d5a2b7c10f93"
down_revision = "c3f1a9d24e57"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_payments_reference_code", table_name="payments")
    op.create_index("ix_payments_reference_code", "payments", ["reference_code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_payments_reference_code", table_name="payments")
    op.create_index("ix_payments_reference_code", "payments", ["reference_code"], unique=False)
