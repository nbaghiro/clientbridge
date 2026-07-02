"""backfill clients.lifetime_value_cents from settled payments

Revision ID: b7e4f2a9c1d3
Revises: f1a3c8e520d9
Create Date: 2026-07-02 12:00:00

"""

from alembic import op

revision = "b7e4f2a9c1d3"
down_revision = "f1a3c8e520d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # lifetime_value_cents was never written before this; seed it from settled payments
    # (payments + deposits, less refunds). Kept correct going forward by _recompute_client_ltv.
    op.execute(
        """
        UPDATE clients c SET lifetime_value_cents = COALESCE((
            SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_cents ELSE p.amount_cents END)
            FROM payments p
            WHERE p.client_id = c.id AND p.status = 'succeeded'
        ), 0)
        """
    )


def downgrade() -> None:
    # Pure data backfill on a pre-existing column — nothing to reverse.
    pass
