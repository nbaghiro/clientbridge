"""Assign one distinct SMS destination per business without shared-number backfill."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0011"
down_revision: str | None = "cb0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("businesses", sa.Column("sms_number", sa.String(), nullable=True))
    op.create_unique_constraint("uq_businesses_sms_number", "businesses", ["sms_number"])


def downgrade() -> None:
    raise RuntimeError("SMS ownership must be retained; disable sends and use a forward migration")
