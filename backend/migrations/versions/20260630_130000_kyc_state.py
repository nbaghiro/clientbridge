"""businesses KYC state mirrored from the Stripe connected account

Revision ID: f1a3c8e520d9
Revises: e9d2a4c7b318
Create Date: 2026-06-30 13:00:00

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "f1a3c8e520d9"
down_revision = "e9d2a4c7b318"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column(
            "stripe_payouts_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "businesses",
        sa.Column(
            "stripe_details_submitted", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "businesses",
        sa.Column(
            "stripe_requirements", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.add_column(
        "businesses",
        sa.Column("kyc_status", sa.String(), nullable=False, server_default="not_started"),
    )


def downgrade() -> None:
    op.drop_column("businesses", "kyc_status")
    op.drop_column("businesses", "stripe_requirements")
    op.drop_column("businesses", "stripe_details_submitted")
    op.drop_column("businesses", "stripe_payouts_enabled")
