"""unique index on businesses.stripe_account_id (webhook lookup + one business per account)

Revision ID: f1b8c3d57e02
Revises: e7c4f9a36b21
Create Date: 2026-06-28 16:00:00

"""

from alembic import op

revision = "f1b8c3d57e02"
down_revision = "e7c4f9a36b21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_businesses_stripe_account", "businesses", ["stripe_account_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_businesses_stripe_account", table_name="businesses")
