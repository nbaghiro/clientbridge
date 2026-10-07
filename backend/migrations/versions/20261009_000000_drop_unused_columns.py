"""Drop columns nothing reads: form targets, contract always-require, message attachments and more.

Revision ID: a7c2e9d4f018
Revises: f3a8b6c1d907
Create Date: 2026-10-09 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7c2e9d4f018"
down_revision: str | None = "f3a8b6c1d907"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("forms", "attach_to")
    op.drop_column("contracts", "always_require")
    op.drop_column("messages", "attachments")
    op.drop_column("recurrences", "start_date")
    op.drop_column("signatures", "signature_image_id")


def downgrade() -> None:
    op.add_column("signatures", sa.Column("signature_image_id", sa.String(), nullable=True))
    op.create_foreign_key(None, "signatures", "files", ["signature_image_id"], ["id"])
    op.add_column("recurrences", sa.Column("start_date", sa.Date(), nullable=True))
    op.execute("UPDATE recurrences SET start_date = created_at::date")
    op.alter_column("recurrences", "start_date", nullable=False)
    op.add_column(
        "messages",
        sa.Column(
            "attachments",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
    )
    op.add_column(
        "contracts",
        sa.Column("always_require", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "forms",
        sa.Column(
            "attach_to",
            postgresql.ARRAY(sa.String()),
            server_default="{}",
            nullable=False,
        ),
    )
