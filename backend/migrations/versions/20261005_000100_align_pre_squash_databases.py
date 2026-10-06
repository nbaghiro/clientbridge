"""Bring databases created before the squash in line with the baseline; a no-op on fresh ones.

Revision ID: 3c7d1e9a2b40
Revises: 8f2d5b7a1c94
Create Date: 2026-10-05 00:01:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "3c7d1e9a2b40"
down_revision: str | None = "8f2d5b7a1c94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RENAMES = [
    ("audits", "audits_actor_user_id_fkey", "audits_performed_by_fkey"),
    ("messages", "messages_sender_user_id_fkey", "messages_sent_by_fkey"),
    ("notes", "notes_author_user_id_fkey", "notes_created_by_fkey"),
    ("gift_cards", "fk_gift_cards_payment", "gift_cards_payment_id_fkey"),
    ("payments", "fk_payments_order", "payments_order_id_fkey"),
    ("invoices", "uq_invoices_pay_token", "invoices_pay_token_key"),
]

_DEFAULTS = {
    "bookings": ["deposit_amount_cents", "deposit_status"],
    "businesses": [
        "stripe_charges_enabled",
        "stripe_details_submitted",
        "stripe_payouts_enabled",
        "stripe_requirements",
    ],
    "items": ["sell_online", "tax_class", "track_stock"],
    "lines": ["tax_class"],
    "orders": ["source"],
}

_CHECKS = {
    ("bookings", "ck_bookings_deposit_status"): (
        "deposit_status IN ('none', 'pending', 'collected', 'applied', 'forfeited', 'refunded')"
    ),
    ("entries", "ck_entries_event"): (
        "event IN ('invoice', 'sale', 'payment', 'fee', 'refund', 'dispute', 'payout', "
        "'redemption', 'consumption', 'forfeit', 'application', 'breakage', 'remittance', "
        "'earning', 'approval', 'staff_payment', 'adjustment', 'reversal')"
    ),
}


def upgrade() -> None:
    for table, old, new in _RENAMES:
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{old}') THEN
                    ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
                END IF;
            END $$;
            """
        )
    for table, columns in _DEFAULTS.items():
        drops = ", ".join(f"ALTER COLUMN {c} DROP DEFAULT" for c in columns)
        op.execute(f"ALTER TABLE {table} {drops}")
    for (table, name), condition in _CHECKS.items():
        op.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT {name}, ADD CONSTRAINT {name} CHECK ({condition})"
        )


def downgrade() -> None:
    pass
