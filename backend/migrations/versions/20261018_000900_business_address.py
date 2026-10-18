"""Add the business's legal address and phone, apart from its public profile."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0018"
down_revision: str | None = "cb0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = ("unit", "street_number", "street_name", "city", "postal_code", "legal_phone")


def upgrade() -> None:
    for column in _COLUMNS:
        op.add_column("businesses", sa.Column(column, sa.String(), nullable=True))
    op.create_check_constraint(
        "ck_businesses_postal_code",
        "businesses",
        "postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'",
    )
    op.create_check_constraint(
        "ck_businesses_legal_phone", "businesses", "legal_phone ~ '^\\+[1-9][0-9]{6,14}$'"
    )


def downgrade() -> None:
    op.drop_constraint("ck_businesses_legal_phone", "businesses", type_="check")
    op.drop_constraint("ck_businesses_postal_code", "businesses", type_="check")
    for column in reversed(_COLUMNS):
        op.drop_column("businesses", column)
