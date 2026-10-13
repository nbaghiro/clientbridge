"""Drop unread Stripe mirror columns and the refunded payment status; let payloads be cleared."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0008"
down_revision: str | None = "cb0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STATUSES = "status IN ('pending', 'succeeded', 'failed', 'canceled')"
_PREVIOUS_STATUSES = "status IN ('pending', 'succeeded', 'failed', 'refunded', 'canceled')"
_DETAILS_SUBMITTED = """
UPDATE businesses SET stripe_details_submitted = stripe_requirements ? 'currently_due' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(
        coalesce(stripe_requirements -> 'currently_due', '[]'::jsonb)
        || coalesce(stripe_requirements -> 'eventually_due', '[]'::jsonb)
        || coalesce(stripe_requirements -> 'past_due', '[]'::jsonb)
    ) AS code
    WHERE code LIKE 'identity.attestations.terms_of_service%'
)
"""


def _refuse_if_rows(table: str, condition: str) -> None:
    count = op.get_bind().execute(sa.text(f"SELECT count(*) FROM {table} WHERE {condition}"))
    if count.scalar_one():
        raise RuntimeError(f"{table} rows where {condition} exist; refusing to migrate them")


def upgrade() -> None:
    _refuse_if_rows("payments", "status = 'refunded'")
    op.drop_constraint("ck_payments_status", "payments", type_="check")
    op.create_check_constraint("ck_payments_status", "payments", _STATUSES)
    op.drop_column("businesses", "stripe_details_submitted")
    op.drop_column("payment_methods", "provider")
    op.drop_column("payment_methods", "status")
    op.drop_column("subscriptions", "current_period_start")
    op.alter_column(
        "webhooks", "payload", existing_type=postgresql.JSONB(astext_type=sa.Text()), nullable=True
    )


def downgrade() -> None:
    _refuse_if_rows("webhooks", "payload IS NULL")
    op.alter_column(
        "webhooks", "payload", existing_type=postgresql.JSONB(astext_type=sa.Text()), nullable=False
    )
    op.add_column("subscriptions", sa.Column("current_period_start", sa.DateTime(timezone=True)))
    op.add_column(
        "payment_methods",
        sa.Column("status", sa.String(), server_default="active", nullable=False),
    )
    op.alter_column("payment_methods", "status", server_default=None)
    op.add_column("payment_methods", sa.Column("provider", sa.String(), nullable=True))
    op.execute("UPDATE payment_methods SET provider = 'stripe'")
    op.add_column(
        "businesses",
        sa.Column("stripe_details_submitted", sa.Boolean(), server_default="false", nullable=False),
    )
    op.alter_column("businesses", "stripe_details_submitted", server_default=None)
    op.execute(_DETAILS_SUBMITTED)
    op.drop_constraint("ck_payments_status", "payments", type_="check")
    op.create_check_constraint("ck_payments_status", "payments", _PREVIOUS_STATUSES)
