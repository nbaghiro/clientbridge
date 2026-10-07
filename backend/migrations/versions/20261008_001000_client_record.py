"""Client record: preferred channel, archive date, pinned notes, removable pets, card details and consent.

Revision ID: a1c3e5f70b21
Revises: f1c7a9d3b246
Create Date: 2026-10-08 00:10:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c3e5f70b21"
down_revision: str | None = "f1c7a9d3b246"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "clients",
        sa.Column("preferred_channel", sa.String(), server_default="sms", nullable=False),
    )
    op.create_check_constraint(
        "ck_clients_preferred_channel", "clients", "preferred_channel IN ('sms', 'email')"
    )
    op.add_column("clients", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("subjects", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "notes", sa.Column("pinned", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column("payment_methods", sa.Column("exp_month", sa.SmallInteger(), nullable=True))
    op.add_column("payment_methods", sa.Column("exp_year", sa.SmallInteger(), nullable=True))
    op.add_column("payment_methods", sa.Column("holder_name", sa.String(), nullable=True))
    op.add_column("payment_methods", sa.Column("bank_name", sa.String(), nullable=True))
    op.create_table(
        "consents",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("business_id", sa.String(), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("client_id", sa.String(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("recorded_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("channel IN ('sms', 'email')", name="ck_consents_channel"),
        sa.CheckConstraint(
            "status IN ('granted', 'implied', 'withdrawn')", name="ck_consents_status"
        ),
        sa.CheckConstraint(
            "source IN ('in_person', 'form', 'online_booking', 'reply', 'unsubscribe', 'import')",
            name="ck_consents_source",
        ),
    )
    op.create_index("ix_consents_business_id", "consents", ["business_id"])
    op.create_index(
        "ix_consents_client", "consents", ["business_id", "client_id", "channel", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_consents_client", table_name="consents")
    op.drop_index("ix_consents_business_id", table_name="consents")
    op.drop_table("consents")
    op.drop_column("payment_methods", "bank_name")
    op.drop_column("payment_methods", "holder_name")
    op.drop_column("payment_methods", "exp_year")
    op.drop_column("payment_methods", "exp_month")
    op.drop_column("notes", "pinned")
    op.drop_column("subjects", "deleted_at")
    op.drop_column("clients", "archived_at")
    op.drop_constraint("ck_clients_preferred_channel", "clients", type_="check")
    op.drop_column("clients", "preferred_channel")
