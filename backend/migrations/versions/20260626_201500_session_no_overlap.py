"""session no-overlap exclusion constraint (a staff member can't be double-booked)

Revision ID: c3f1a9b27d4e
Revises: 29e09f34a789
Create Date: 2026-06-26 20:15:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c3f1a9b27d4e"
down_revision: str | None = "29e09f34a789"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute(
        "ALTER TABLE sessions ADD CONSTRAINT excl_sessions_staff_overlap "
        "EXCLUDE USING gist ("
        "business_id WITH =, staff_id WITH =, "
        "tstzrange(starts_at, ends_at, '[)') WITH &&"
        ") WHERE (status <> 'canceled')"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS excl_sessions_staff_overlap")
