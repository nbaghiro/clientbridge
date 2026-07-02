"""drop the tax_rates table + tax_rate_id FKs — rates are now derived from a business's province

Revision ID: e4b9c7f21a86
Revises: c2d5e8f1a9b4
Create Date: 2026-07-02 14:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4b9c7f21a86"
down_revision: str | None = "c2d5e8f1a9b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # drop the FK columns first (they reference tax_rates.id), then the table
    op.drop_column("lines", "tax_rate_id")
    op.drop_column("items", "tax_rate_id")
    op.drop_index("ix_tax_rates_province", table_name="tax_rates")
    op.drop_index(op.f("ix_tax_rates_business_id"), table_name="tax_rates")
    op.drop_table("tax_rates")


def downgrade() -> None:
    op.create_table(
        "tax_rates",
        sa.Column("business_id", sa.String(), nullable=True),
        sa.Column("jurisdiction", sa.String(), nullable=False),
        sa.Column("province", sa.String(), nullable=False),
        sa.Column("rate_bps", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
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
            "jurisdiction IN ('GST', 'HST', 'PST', 'QST')", name="ck_tax_rates_jurisdiction"
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tax_rates_business_id"), "tax_rates", ["business_id"], unique=False)
    op.create_index(
        "ix_tax_rates_province", "tax_rates", ["province", "jurisdiction"], unique=False
    )
    op.add_column("items", sa.Column("tax_rate_id", sa.String(), nullable=True))
    op.create_foreign_key("items_tax_rate_id_fkey", "items", "tax_rates", ["tax_rate_id"], ["id"])
    op.add_column("lines", sa.Column("tax_rate_id", sa.String(), nullable=True))
    op.create_foreign_key("lines_tax_rate_id_fkey", "lines", "tax_rates", ["tax_rate_id"], ["id"])
