"""Keep invitation history and remove internal review collection."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0022"
down_revision: str | None = "cb0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "review_requests",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("client_id", sa.String(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("booking_id", sa.String(), sa.ForeignKey("bookings.id")),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_review_requests_business_id", "review_requests", ["business_id"])
    op.create_index("ix_review_requests_booking", "review_requests", ["business_id", "booking_id"])
    op.execute(
        "INSERT INTO review_requests "
        "(id, business_id, client_id, booking_id, requested_at, created_at, updated_at) "
        "SELECT id, business_id, client_id, booking_id, requested_at, created_at, updated_at "
        "FROM reviews WHERE requested_at IS NOT NULL"
    )
    op.execute("DELETE FROM commands WHERE scope LIKE 'review.%'")
    op.drop_table("reviews")
    op.drop_constraint("ck_businesses_review_hold_at", "businesses", type_="check")
    op.drop_column("businesses", "review_hold_at")


def downgrade() -> None:
    raise RuntimeError("internal feedback removal is irreversible; restore a backup to recover it")
