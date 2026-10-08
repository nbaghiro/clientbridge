"""Add server-only returning-client mailbox verification."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbconnect02"
down_revision: str | None = "cbconnect01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "returning_challenges",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("client_id", sa.String(), sa.ForeignKey("clients.id")),
        sa.Column("destination_hash", sa.String(), nullable=False),
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("session_hash", sa.String()),
        sa.Column("session_expires_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_returning_challenges_business_id", "returning_challenges", ["business_id"])
    op.create_index(
        "ix_returning_destination",
        "returning_challenges",
        ["business_id", "destination_hash", "created_at"],
    )
    op.create_index("ix_returning_session", "returning_challenges", ["session_hash"], unique=True)


def downgrade() -> None:
    op.drop_table("returning_challenges")
