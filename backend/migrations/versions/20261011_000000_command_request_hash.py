"""Store the request hash on idempotency keys so a reused key with a different body is refused."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0002"
down_revision: str | None = "cb0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("commands", sa.Column("request_hash", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("commands", "request_hash")
