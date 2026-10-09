"""Record successful sync operations atomically with their writes."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "cbsync02"
down_revision: str | None = "cbsync01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sync_receipts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("operation_id", sa.String(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("version", sa.SmallInteger(), nullable=False),
        sa.Column("result", JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "user_id", "device_id", "operation_id", name="uq_sync_receipt_operation"
        ),
    )
    op.create_index("ix_sync_receipts_business_id", "sync_receipts", ["business_id"])
    op.create_index("ix_sync_receipt_created", "sync_receipts", ["created_at"])


def downgrade() -> None:
    op.drop_table("sync_receipts")
