"""Let a package belong to one of the client's subjects, such as one child of a family."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0030"
down_revision: str | None = "cb0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "packages",
        sa.Column("subject_id", sa.String(), sa.ForeignKey("subjects.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("packages", "subject_id")
