"""payments concurrency guards: unique provider_ref, one-refund-per-payment, unique allocation, unique payout ref

Revision ID: e7c4f9a36b21
Revises: d5a2b7c10f93
Create Date: 2026-06-28 14:00:00

"""

from alembic import op

revision = "e7c4f9a36b21"
down_revision = "d5a2b7c10f93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_payments_provider_ref", "payments", ["provider_ref"], unique=True)
    op.create_index("ix_payments_refund_parent", "payments", ["parent_payment_id"], unique=True)
    op.drop_index("ix_payout_alloc_source", table_name="payout_allocations")
    op.create_index(
        "ix_payout_alloc_source",
        "payout_allocations",
        ["source_type", "source_id", "staff_id"],
        unique=True,
    )
    op.create_index(
        "ix_payouts_provider_ref", "payouts", ["business_id", "provider_ref"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_payouts_provider_ref", table_name="payouts")
    op.drop_index("ix_payout_alloc_source", table_name="payout_allocations")
    op.create_index(
        "ix_payout_alloc_source", "payout_allocations", ["source_type", "source_id"], unique=False
    )
    op.drop_index("ix_payments_refund_parent", table_name="payments")
    op.drop_index("ix_payments_provider_ref", table_name="payments")
