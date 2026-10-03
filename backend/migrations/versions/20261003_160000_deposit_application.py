"""deposit applied to the booking's invoice

Revision ID: 9b1d4c2e7a10
Revises: 6e57a3a70c5f
Create Date: 2026-10-03 16:00:00

"""

from collections.abc import Sequence

from alembic import op

revision: str = "9b1d4c2e7a10"
down_revision: str | None = "6e57a3a70c5f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENTRY_TYPES = (
    "'invoice', 'sale', 'payment', 'fee', 'refund', 'dispute', 'payout', 'redemption', "
    "'consumption', 'forfeit', 'breakage', 'remittance', 'earning', 'approval', "
    "'staff_payment', 'adjustment', 'reversal'"
)
DEPOSIT_STATUSES = "'none', 'pending', 'collected', 'forfeited', 'refunded'"


def _checks(entry_types: str, deposit_statuses: str) -> None:
    op.drop_constraint("ck_entries_type", "entries", type_="check")
    op.create_check_constraint("ck_entries_type", "entries", f"type IN ({entry_types})")
    op.drop_constraint("ck_bookings_deposit_status", "bookings", type_="check")
    op.create_check_constraint(
        "ck_bookings_deposit_status", "bookings", f"deposit_status IN ({deposit_statuses})"
    )


def upgrade() -> None:
    _checks(f"{ENTRY_TYPES}, 'application'", f"{DEPOSIT_STATUSES}, 'applied'")


def downgrade() -> None:
    _checks(ENTRY_TYPES, DEPOSIT_STATUSES)
