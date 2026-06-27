"""invoices/estimates number nullable — assigned sequentially on issue, not while a draft

Revision ID: 5e8a2c1f9b34
Revises: c3f1a9b27d4e
Create Date: 2026-06-27 12:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "5e8a2c1f9b34"
down_revision: str | None = "c3f1a9b27d4e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE invoices ALTER COLUMN number DROP NOT NULL")
    op.execute("ALTER TABLE estimates ALTER COLUMN number DROP NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE estimates ALTER COLUMN number SET NOT NULL")
    op.execute("ALTER TABLE invoices ALTER COLUMN number SET NOT NULL")
