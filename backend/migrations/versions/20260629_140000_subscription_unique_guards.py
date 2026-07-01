"""subscription guards: unique provider_ref, one active/paused sub per client+item

Revision ID: a4f7c1e80b96
Revises: c3e6a9b42d53
Create Date: 2026-06-29 14:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "a4f7c1e80b96"
down_revision = "c3e6a9b42d53"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_subscriptions_provider_ref", "subscriptions", ["provider_ref"], unique=True)
    op.create_index(
        "ix_subscriptions_active_unique",
        "subscriptions",
        ["business_id", "client_id", "item_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('active', 'paused')"),
    )


def downgrade() -> None:
    op.drop_index("ix_subscriptions_active_unique", table_name="subscriptions")
    op.drop_index("ix_subscriptions_provider_ref", table_name="subscriptions")
