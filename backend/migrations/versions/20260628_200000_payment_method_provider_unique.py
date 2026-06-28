"""unique index on payment_methods (business_id, provider_ref) — saved-card dedup

Revision ID: b9e3f1a7d540
Revises: a2d6e1b94c30
Create Date: 2026-06-28 20:00:00

"""

from alembic import op

revision = "b9e3f1a7d540"
down_revision = "a2d6e1b94c30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_payment_methods_provider",
        "payment_methods",
        ["business_id", "provider_ref"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_payment_methods_provider", table_name="payment_methods")
