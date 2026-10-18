"""Persist outbound delivery intent and guarded transport state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0010"
down_revision: str | None = "cb0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deliveries",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id")),
        sa.Column("key", sa.String(), nullable=False, unique=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("next_at", sa.DateTime(timezone=True)),
        sa.Column("claim", sa.String()),
        sa.Column("provider_ref", sa.String()),
        sa.Column("error", sa.String()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "state IN ('queued', 'sending', 'accepted', 'delivered', 'failed', 'ambiguous')",
            name="ck_deliveries_state",
        ),
    )
    op.create_index(
        "ix_deliveries_due",
        "deliveries",
        ["next_at"],
        postgresql_where=sa.text("state IN ('queued', 'sending')"),
    )
    op.create_index("ix_deliveries_business", "deliveries", ["business_id", "created_at", "id"])
    op.create_index(
        "ix_deliveries_provider",
        "deliveries",
        ["provider_ref"],
        postgresql_where=sa.text("provider_ref IS NOT NULL"),
    )


def downgrade() -> None:
    raise RuntimeError(
        "delivery intent must be retained; stop dispatch and use a forward migration"
    )
