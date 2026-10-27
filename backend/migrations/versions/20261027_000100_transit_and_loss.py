"""Book payouts through transit until they arrive, and money lost twice as a loss."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0034"
down_revision: str | None = "cb0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREVIOUS = (
    "'stripe', 'bank', 'cash', 'receivable', 'tax', 'gift_card', 'deposit', 'deferred', "
    "'payable', 'revenue', 'fee_revenue', 'processing_fee', 'platform_fee', 'staff_cost', 'itc'"
)
_CATEGORY = (
    "'stripe', 'bank', 'transit', 'cash', 'receivable', 'tax', 'gift_card', 'deposit', "
    "'deferred', 'payable', 'revenue', 'fee_revenue', 'processing_fee', 'platform_fee', "
    "'staff_cost', 'itc', 'loss'"
)


def upgrade() -> None:
    op.drop_constraint("ck_accounts_category", "accounts", type_="check")
    op.create_check_constraint("ck_accounts_category", "accounts", f"category IN ({_CATEGORY})")


def downgrade() -> None:
    count = op.get_bind().execute(
        sa.text("SELECT count(*) FROM accounts WHERE category IN ('transit', 'loss')")
    )
    if count.scalar_one():
        raise RuntimeError("transit or loss accounts exist; refusing to migrate them")
    op.drop_constraint("ck_accounts_category", "accounts", type_="check")
    op.create_check_constraint("ck_accounts_category", "accounts", f"category IN ({_PREVIOUS})")
