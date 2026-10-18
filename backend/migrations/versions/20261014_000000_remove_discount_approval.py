"""Drop the staff discount limit, the desk approval PIN and the order approver."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0009"
down_revision: str | None = "cb0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("orders", "approved_by")
    op.drop_column("users", "pin_hash")
    op.drop_column("businesses", "staff_discount_limit_bps")


def downgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column("staff_discount_limit_bps", sa.Integer(), server_default="1500", nullable=False),
    )
    op.add_column("users", sa.Column("pin_hash", sa.String(), nullable=True))
    op.add_column(
        "orders",
        sa.Column("approved_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
    )
