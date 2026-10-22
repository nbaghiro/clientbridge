"""Let a business book vehicles, cars worked on where they're parked, besides the client."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0028"
down_revision: str | None = "cb0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SUBJECT = "subject IS NULL OR subject IN ('pet', 'student', 'property', 'site', 'vehicle')"
_PREVIOUS = "subject IS NULL OR subject IN ('pet', 'student', 'property', 'site')"


def _refuse_if_rows(table: str, condition: str) -> None:
    count = op.get_bind().execute(sa.text(f"SELECT count(*) FROM {table} WHERE {condition}"))
    if count.scalar_one():
        raise RuntimeError(f"{table} rows where {condition} exist; refusing to migrate them")


def upgrade() -> None:
    op.drop_constraint("ck_businesses_subject", "businesses", type_="check")
    op.create_check_constraint("ck_businesses_subject", "businesses", _SUBJECT)


def downgrade() -> None:
    _refuse_if_rows("businesses", "subject = 'vehicle'")
    op.drop_constraint("ck_businesses_subject", "businesses", type_="check")
    op.create_check_constraint("ck_businesses_subject", "businesses", _PREVIOUS)
