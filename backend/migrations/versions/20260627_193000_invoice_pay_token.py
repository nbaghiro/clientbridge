"""invoice pay_token (public pay-link key)

Revision ID: c3f1a9d24e57
Revises: b7d4e2f8a1c6
Create Date: 2026-06-27 19:30:00

"""

import sqlalchemy as sa
from alembic import op

revision = "c3f1a9d24e57"
down_revision = "b7d4e2f8a1c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("pay_token", sa.String(), nullable=True))
    op.create_unique_constraint("uq_invoices_pay_token", "invoices", ["pay_token"])


def downgrade() -> None:
    op.drop_constraint("uq_invoices_pay_token", "invoices", type_="unique")
    op.drop_column("invoices", "pay_token")
