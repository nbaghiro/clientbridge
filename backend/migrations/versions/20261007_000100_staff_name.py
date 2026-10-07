"""Copy each member's name onto their staff row so it syncs to the team's devices.

Revision ID: 7b2c4e6f8a10
Revises: 5e1a7c3d9b20
Create Date: 2026-10-07 00:01:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7b2c4e6f8a10"
down_revision: str | None = "5e1a7c3d9b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("staff", sa.Column("name", sa.String(), nullable=True))
    op.execute("UPDATE staff SET name = users.name FROM users WHERE users.id = staff.user_id")


def downgrade() -> None:
    op.drop_column("staff", "name")
