"""Record when an online order was marked ready and when it was picked up.

Revision ID: 9d4f6a8c2e31
Revises: 7b2c4e6f8a10
Create Date: 2026-10-07 00:02:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9d4f6a8c2e31"
down_revision: str | None = "7b2c4e6f8a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("picked_up_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "picked_up_at")
    op.drop_column("orders", "ready_at")
