"""deposit status, partial refunds, remittance and breakage entries

Revision ID: 6e57a3a70c5f
Revises: 7027f8f3446b
Create Date: 2026-10-03 14:54:07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6e57a3a70c5f"
down_revision: str | None = "7027f8f3446b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENTRY_TYPES = (
    "'invoice', 'sale', 'payment', 'fee', 'refund', 'dispute', 'payout', 'redemption', "
    "'consumption', 'forfeit', 'earning', 'approval', 'staff_payment', 'adjustment', "
    "'reversal'"
)
DEPOSIT_STATUSES = "'none', 'pending', 'collected', 'forfeited', 'refunded'"


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("deposit_status", sa.String(), server_default="none", nullable=False),
    )
    op.create_check_constraint(
        "ck_bookings_deposit_status", "bookings", f"deposit_status IN ({DEPOSIT_STATUSES})"
    )
    op.execute(
        """
        UPDATE bookings b SET deposit_status = CASE
            WHEN EXISTS (SELECT 1 FROM entries e WHERE e.ref = 'forfeit:' || b.id) THEN 'forfeited'
            WHEN (SELECT -sum(e.amount_cents) FROM entries e JOIN accounts a ON a.id = e.account_id
                  WHERE a.kind = 'deposit' AND e.subject_type = 'booking' AND e.subject_id = b.id) > 0
                THEN 'collected'
            WHEN EXISTS (SELECT 1 FROM entries e WHERE e.subject_type = 'booking'
                         AND e.subject_id = b.id AND e.type = 'refund') THEN 'refunded'
            WHEN b.deposit_required AND b.deposit_amount_cents > 0
                 AND b.status NOT IN ('completed', 'canceled') THEN 'pending'
            ELSE 'none'
        END
        """
    )
    op.drop_index("ix_payments_refund_parent", table_name="payments")
    op.create_index("ix_payments_refund_parent", "payments", ["parent_payment_id"])
    op.drop_constraint("ck_entries_type", "entries", type_="check")
    op.create_check_constraint(
        "ck_entries_type", "entries", f"type IN ({ENTRY_TYPES}, 'breakage', 'remittance')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_entries_type", "entries", type_="check")
    op.create_check_constraint("ck_entries_type", "entries", f"type IN ({ENTRY_TYPES})")
    op.drop_index("ix_payments_refund_parent", table_name="payments")
    op.create_index("ix_payments_refund_parent", "payments", ["parent_payment_id"], unique=True)
    op.drop_constraint("ck_bookings_deposit_status", "bookings", type_="check")
    op.drop_column("bookings", "deposit_status")
