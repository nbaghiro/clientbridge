"""Store what a business books besides the client on the business, not on each subject."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0009"
down_revision: str | None = "cb0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SUBJECT = "subject IS NULL OR subject IN ('pet', 'student', 'property')"
_PREVIOUS_KINDS = "kind IN ('pet', 'vehicle', 'child', 'property')"


def _refuse_if_rows(table: str, condition: str) -> None:
    count = op.get_bind().execute(sa.text(f"SELECT count(*) FROM {table} WHERE {condition}"))
    if count.scalar_one():
        raise RuntimeError(f"{table} rows where {condition} exist; refusing to migrate them")


def upgrade() -> None:
    _refuse_if_rows("subjects", "kind <> 'pet'")
    op.add_column("businesses", sa.Column("subject", sa.String(), nullable=True))
    op.create_check_constraint("ck_businesses_subject", "businesses", _SUBJECT)
    op.execute(
        "UPDATE businesses SET subject = 'pet'"
        " WHERE EXISTS (SELECT 1 FROM subjects s WHERE s.business_id = businesses.id)"
    )
    op.drop_constraint("ck_subjects_kind", "subjects", type_="check")
    op.drop_column("subjects", "kind")


def downgrade() -> None:
    op.add_column("subjects", sa.Column("kind", sa.String(), nullable=True))
    op.execute(
        "UPDATE subjects s SET kind = CASE b.subject WHEN 'student' THEN 'child'"
        " WHEN 'property' THEN 'property' ELSE 'pet' END"
        " FROM businesses b WHERE b.id = s.business_id"
    )
    op.alter_column("subjects", "kind", existing_type=sa.String(), nullable=False)
    op.create_check_constraint("ck_subjects_kind", "subjects", _PREVIOUS_KINDS)
    op.drop_constraint("ck_businesses_subject", "businesses", type_="check")
    op.drop_column("businesses", "subject")
