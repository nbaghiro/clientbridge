"""entitlement purchase: gift_cards.payment_id + pending status on packages/gift_cards

Revision ID: f3c8a1d2e904
Revises: d1a4c7e90b21
Create Date: 2026-06-29 16:00:00

"""

from alembic import op
import sqlalchemy as sa

revision = "f3c8a1d2e904"
down_revision = "d1a4c7e90b21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("gift_cards", sa.Column("payment_id", sa.String(), nullable=True))
    op.create_foreign_key("fk_gift_cards_payment", "gift_cards", "payments", ["payment_id"], ["id"])
    op.drop_constraint("ck_gift_cards_status", "gift_cards", type_="check")
    op.create_check_constraint(
        "ck_gift_cards_status",
        "gift_cards",
        "status IN ('active', 'redeemed', 'expired', 'void', 'pending')",
    )
    op.create_check_constraint(
        "ck_packages_status",
        "packages",
        "status IN ('active', 'used', 'expired', 'canceled', 'pending')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_packages_status", "packages", type_="check")
    op.drop_constraint("ck_gift_cards_status", "gift_cards", type_="check")
    op.create_check_constraint(
        "ck_gift_cards_status",
        "gift_cards",
        "status IN ('active', 'redeemed', 'expired', 'void')",
    )
    op.drop_constraint("fk_gift_cards_payment", "gift_cards", type_="foreignkey")
    op.drop_column("gift_cards", "payment_id")
