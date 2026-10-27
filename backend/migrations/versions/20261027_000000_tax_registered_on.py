"""Record the day a business's GST/HST registration took effect."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0034"
down_revision: str | None = "cb0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("businesses", sa.Column("tax_registered_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("businesses", "tax_registered_on")
