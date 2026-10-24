"""Let a service need one of a pool of shared rooms or equipment, held by each visit."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0031"
down_revision: str | None = "cb0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "resources",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("business_id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resources_business_id", "resources", ["business_id"], unique=False)
    op.create_index(
        "ux_resources_business_name",
        "resources",
        ["business_id", sa.text("lower(name)")],
        unique=True,
    )
    op.add_column(
        "items",
        sa.Column(
            "resource_ids", postgresql.ARRAY(sa.String()), server_default="{}", nullable=False
        ),
    )
    op.add_column(
        "slots",
        sa.Column("resource_id", sa.String(), sa.ForeignKey("resources.id"), nullable=True),
    )
    op.create_index(
        "ix_slots_resource_start",
        "slots",
        ["business_id", "resource_id", "starts_at"],
        unique=False,
        postgresql_where=sa.text("resource_id IS NOT NULL"),
    )
    op.execute(
        "ALTER TABLE slots ADD CONSTRAINT excl_slots_resource_overlap EXCLUDE USING gist "
        "(business_id WITH =, resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) "
        "WHERE (resource_id IS NOT NULL AND status <> 'canceled')"
    )


def downgrade() -> None:
    held = op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM slots WHERE resource_id IS NOT NULL)"
            " OR EXISTS (SELECT 1 FROM items WHERE resource_ids <> '{}')"
        )
    )
    if held:
        raise RuntimeError("visits or services still use resources; clear them before downgrading")
    op.execute("ALTER TABLE slots DROP CONSTRAINT excl_slots_resource_overlap")
    op.drop_index("ix_slots_resource_start", table_name="slots")
    op.drop_column("slots", "resource_id")
    op.drop_column("items", "resource_ids")
    op.drop_index("ux_resources_business_name", table_name="resources")
    op.drop_index("ix_resources_business_id", table_name="resources")
    op.drop_table("resources")
