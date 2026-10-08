"""Client-authorized bank payment setup links, never synced to devices."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbpayments01"
down_revision: str | None = "cbconnect04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payment_setup_links",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("client_id", sa.String(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("account_id", sa.String(), nullable=False),
        sa.Column("customer_id", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("setup_intent_id", sa.String()),
        sa.Column("mandate_ref", sa.String()),
        sa.Column("setup_status", sa.String(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("purpose IN ('pad_setup')", name="ck_payment_setup_links_purpose"),
    )
    op.create_index("ix_payment_setup_links_business_id", "payment_setup_links", ["business_id"])
    op.create_index(
        "uq_payment_setup_links_hash", "payment_setup_links", ["token_hash"], unique=True
    )
    op.create_index(
        "uq_payment_setup_links_intent", "payment_setup_links", ["setup_intent_id"], unique=True
    )
    op.create_index(
        "ix_payment_setup_links_client", "payment_setup_links", ["business_id", "client_id"]
    )
    op.execute(
        "UPDATE payment_methods SET mandate_status = 'pending' WHERE method = 'bank_eft' AND mandate_status = 'active'"
    )


def downgrade() -> None:
    op.drop_table("payment_setup_links")
