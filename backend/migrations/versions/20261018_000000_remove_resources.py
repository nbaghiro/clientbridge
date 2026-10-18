"""Drop the resources table, the slot resource column and its overlap exclusion."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0009"
down_revision: str | None = "cb0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE slots DROP CONSTRAINT excl_slots_resource_overlap")
    op.drop_column("slots", "resource_id")
    op.drop_index("ix_resources_business_id", table_name="resources")
    op.drop_table("resources")


def downgrade() -> None:
    op.create_table(
        "resources",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("capacity", sa.Integer(), server_default="1", nullable=False),
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
        sa.CheckConstraint(
            "category IN ('room', 'station', 'equipment')", name="ck_resources_category"
        ),
        sa.CheckConstraint("capacity > 0", name="ck_resources_capacity"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resources_business_id", "resources", ["business_id"], unique=False)
    op.add_column("slots", sa.Column("resource_id", sa.String(), nullable=True))
    op.create_foreign_key("slots_resource_id_fkey", "slots", "resources", ["resource_id"], ["id"])
    op.execute(
        "ALTER TABLE slots ADD CONSTRAINT excl_slots_resource_overlap EXCLUDE USING gist "
        "(business_id WITH =, resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) "
        "WHERE (resource_id IS NOT NULL AND status <> 'canceled')"
    )
