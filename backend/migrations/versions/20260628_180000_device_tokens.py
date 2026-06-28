"""device_tokens (Expo push targets for the staff mobile app)

Revision ID: a2d6e1b94c30
Revises: f1b8c3d57e02
Create Date: 2026-06-28 18:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "a2d6e1b94c30"
down_revision = "f1b8c3d57e02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_tokens",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "platform IN ('ios','android','web')", name="ck_device_tokens_platform"
        ),
    )
    op.create_index("ix_device_tokens_token", "device_tokens", ["token"], unique=True)
    op.create_index("ix_device_tokens_business", "device_tokens", ["business_id"])


def downgrade() -> None:
    op.drop_index("ix_device_tokens_business", table_name="device_tokens")
    op.drop_index("ix_device_tokens_token", table_name="device_tokens")
    op.drop_table("device_tokens")
