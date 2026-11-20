"""Record when a membership stops renewing, so an archive's scheduled end and a cancel's date show."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0043"
down_revision: str | None = "cb0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("subscriptions", sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True))
    # a mid-period cancel ended when the row last changed, never at a period still to come
    op.execute(
        "UPDATE subscriptions SET ends_at = LEAST(current_period_end, updated_at)"
        " WHERE status = 'canceled'"
    )
    # an archive scheduled the end that a restore has not undone
    op.execute(
        "UPDATE subscriptions s SET ends_at = s.current_period_end WHERE s.status <> 'canceled'"
        " AND (SELECT a.action FROM audits a WHERE a.business_id = s.business_id"
        " AND a.entity_id = s.id"
        " AND a.action IN ('subscription.cancel_at_period_end', 'subscription.keep')"
        " ORDER BY a.id DESC LIMIT 1) = 'subscription.cancel_at_period_end'"
    )


def downgrade() -> None:
    op.drop_column("subscriptions", "ends_at")
