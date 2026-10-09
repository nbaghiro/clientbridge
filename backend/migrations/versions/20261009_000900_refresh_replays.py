"""Retain encrypted refresh outcomes briefly for safe transport retries."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbsync03"
down_revision: str | None = "cbsync02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("replay_attempt_id", sa.String()))
    op.add_column("sessions", sa.Column("replay_ciphertext", sa.String()))
    op.add_column("sessions", sa.Column("replay_expires_at", sa.DateTime(timezone=True)))
    op.add_column("sessions", sa.Column("replay_session_id", sa.String()))


def downgrade() -> None:
    for name in (
        "replay_session_id",
        "replay_expires_at",
        "replay_ciphertext",
        "replay_attempt_id",
    ):
        op.drop_column("sessions", name)
