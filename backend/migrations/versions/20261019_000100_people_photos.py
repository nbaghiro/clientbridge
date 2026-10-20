"""Let a client or a team member have a photo, kept as a file on the client or the user."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0025"
down_revision: str | None = "cb0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PARENTS = (
    "parent_type IN ('business', 'subject', 'item', 'signature', 'form_response', 'booking',"
    " 'client', 'user')"
)
_PREVIOUS = (
    "parent_type IN ('business', 'subject', 'item', 'signature', 'form_response', 'booking')"
)


def _refuse_if_rows(table: str, condition: str) -> None:
    count = op.get_bind().execute(sa.text(f"SELECT count(*) FROM {table} WHERE {condition}"))
    if count.scalar_one():
        raise RuntimeError(f"{table} rows where {condition} exist; refusing to migrate them")


def upgrade() -> None:
    op.drop_constraint("ck_files_parent_type", "files", type_="check")
    op.create_check_constraint("ck_files_parent_type", "files", _PARENTS)


def downgrade() -> None:
    _refuse_if_rows("files", "parent_type IN ('client', 'user')")
    op.drop_constraint("ck_files_parent_type", "files", type_="check")
    op.create_check_constraint("ck_files_parent_type", "files", _PREVIOUS)
