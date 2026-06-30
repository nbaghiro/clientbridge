"""review requests: at most one open request per booking

Revision ID: a7e2c9f1d3b5
Revises: f3c8a1d2e904
Create Date: 2026-06-29 17:00:00

"""

from alembic import op
import sqlalchemy as sa

revision = "a7e2c9f1d3b5"
down_revision = "f3c8a1d2e904"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_review_requests_open_booking",
        "review_requests",
        ["business_id", "booking_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('sent', 'opened') AND booking_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_review_requests_open_booking", table_name="review_requests")
