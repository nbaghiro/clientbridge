"""device_tokens: align timestamps + business index with the model

Revision ID: 7a3c9e1f4b20
Revises: 1db6fac2a2f0
Create Date: 2026-10-03 14:07:00

"""

from collections.abc import Sequence

from alembic import op

revision: str = "7a3c9e1f4b20"
down_revision: str | None = "1db6fac2a2f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("device_tokens", "created_at", nullable=False)
    op.alter_column("device_tokens", "updated_at", nullable=False)
    op.create_index("ix_device_tokens_business_id", "device_tokens", ["business_id"])


def downgrade() -> None:
    op.drop_index("ix_device_tokens_business_id", table_name="device_tokens")
    op.alter_column("device_tokens", "updated_at", nullable=True)
    op.alter_column("device_tokens", "created_at", nullable=True)
