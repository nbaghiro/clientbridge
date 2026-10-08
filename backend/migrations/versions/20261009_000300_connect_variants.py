"""Group stocked catalogue products as storefront variants."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbconnect03"
down_revision: str | None = "cbconnect02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("items", sa.Column("variant_parent_id", sa.String(), nullable=True))
    op.add_column("items", sa.Column("variant_label", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_items_variant_parent", "items", "items", ["variant_parent_id"], ["id"]
    )
    op.create_check_constraint(
        "ck_items_variant_kind",
        "items",
        "variant_parent_id IS NULL OR (kind = 'product' AND variant_parent_id != id)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_items_variant_kind", "items", type_="check")
    op.drop_constraint("fk_items_variant_parent", "items", type_="foreignkey")
    op.drop_column("items", "variant_label")
    op.drop_column("items", "variant_parent_id")
