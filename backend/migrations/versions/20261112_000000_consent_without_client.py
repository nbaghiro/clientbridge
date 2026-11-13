"""Let a STOP or START from a number no client holds be recorded against the number alone."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0041"
down_revision: str | None = "cb0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("consents", "client_id", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM consents WHERE client_id IS NULL")
    op.alter_column("consents", "client_id", existing_type=sa.String(), nullable=False)
