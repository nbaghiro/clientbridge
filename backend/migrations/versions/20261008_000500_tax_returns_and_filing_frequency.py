"""Tax returns per family with input tax credits, and a filing frequency per business.

Revision ID: f1c7a9d3b246
Revises: e8b4f0a2c635
Create Date: 2026-10-08 00:05:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1c7a9d3b246"
down_revision: str | None = "e8b4f0a2c635"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CATEGORIES = (
    "stripe",
    "bank",
    "cash",
    "receivable",
    "tax",
    "gift_card",
    "deposit",
    "deferred",
    "payable",
    "revenue",
    "fee_revenue",
    "processing_fee",
    "platform_fee",
    "staff_cost",
)


def _categories(*extra: str) -> str:
    return "category IN (" + ", ".join(f"'{c}'" for c in (*_CATEGORIES, *extra)) + ")"


def upgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column(
            "filing_frequency", sa.String(), nullable=False, server_default=sa.text("'quarterly'")
        ),
    )
    op.create_check_constraint(
        "ck_businesses_filing_frequency",
        "businesses",
        "filing_frequency IN ('monthly', 'quarterly', 'annual')",
    )
    op.drop_constraint("ck_accounts_category", "accounts", type_="check")
    op.create_check_constraint("ck_accounts_category", "accounts", _categories("itc"))


def downgrade() -> None:
    op.drop_constraint("ck_accounts_category", "accounts", type_="check")
    op.create_check_constraint("ck_accounts_category", "accounts", _categories())
    op.drop_constraint("ck_businesses_filing_frequency", "businesses", type_="check")
    op.drop_column("businesses", "filing_frequency")
