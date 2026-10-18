"""Drop staff.name: a member's name is their account's, after keeping any name only staff held."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0015"
down_revision: str | None = "cb0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KEEP_NAMES = """
UPDATE users SET name = kept.name
FROM (
    SELECT DISTINCT ON (user_id) user_id, btrim(name) AS name FROM staff
    WHERE user_id IS NOT NULL AND btrim(coalesce(name, '')) <> ''
    ORDER BY user_id, created_at, id
) AS kept
WHERE kept.user_id = users.id AND btrim(coalesce(users.name, '')) = ''
"""


def upgrade() -> None:
    op.execute(_KEEP_NAMES)
    op.drop_column("staff", "name")


def downgrade() -> None:
    op.add_column("staff", sa.Column("name", sa.String(), nullable=True))
    op.execute("UPDATE staff SET name = users.name FROM users WHERE users.id = staff.user_id")
