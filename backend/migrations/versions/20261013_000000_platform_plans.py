"""Add the platform plan, its status, the trial end and the plan subscription to businesses."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0007"
down_revision: str | None = "cb0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("businesses", sa.Column("plan", sa.String(), nullable=True))
    op.add_column(
        "businesses",
        sa.Column("plan_status", sa.String(), server_default="trialing", nullable=False),
    )
    op.add_column("businesses", sa.Column("trial_ends_at", sa.DateTime(timezone=True)))
    op.add_column("businesses", sa.Column("stripe_subscription_id", sa.String(), nullable=True))
    op.execute(
        "UPDATE businesses SET trial_ends_at = greatest(created_at, now()) + interval '14 days'"
    )
    op.alter_column("businesses", "trial_ends_at", nullable=False)
    op.create_check_constraint(
        "ck_businesses_plan", "businesses", "plan IS NULL OR plan IN ('premium', 'team')"
    )
    op.create_check_constraint(
        "ck_businesses_plan_status",
        "businesses",
        "plan_status IN ('trialing', 'active', 'past_due', 'lapsed')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_businesses_plan_status", "businesses", type_="check")
    op.drop_constraint("ck_businesses_plan", "businesses", type_="check")
    op.drop_column("businesses", "stripe_subscription_id")
    op.drop_column("businesses", "trial_ends_at")
    op.drop_column("businesses", "plan_status")
    op.drop_column("businesses", "plan")
