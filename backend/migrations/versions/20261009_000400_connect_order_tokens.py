"""Separate order management credentials from shareable receipt links."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbconnect04"
down_revision: str | None = "cbconnect03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("status_token", sa.String(), nullable=True))
    op.create_unique_constraint("uq_orders_status_token", "orders", ["status_token"])


def downgrade() -> None:
    op.drop_constraint("uq_orders_status_token", "orders", type_="unique")
    op.drop_column("orders", "status_token")
