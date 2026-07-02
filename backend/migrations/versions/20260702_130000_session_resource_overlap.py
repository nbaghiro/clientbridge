"""session resource no-overlap exclusion constraint (a room/equipment can't be double-booked)

Revision ID: c2d5e8f1a9b4
Revises: b7e4f2a9c1d3
Create Date: 2026-07-02 13:00:00

"""

from collections.abc import Sequence

from alembic import op

revision: str = "c2d5e8f1a9b4"
down_revision: str | None = "b7e4f2a9c1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    # a resource (room/equipment) can't hold two overlapping non-canceled sessions; sessions with
    # no resource are unconstrained (partial WHERE). Mirrors excl_sessions_staff_overlap.
    op.execute(
        "ALTER TABLE sessions ADD CONSTRAINT excl_sessions_resource_overlap "
        "EXCLUDE USING gist ("
        "business_id WITH =, resource_id WITH =, "
        "tstzrange(starts_at, ends_at, '[)') WITH &&"
        ") WHERE (resource_id IS NOT NULL AND status <> 'canceled')"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS excl_sessions_resource_overlap")
