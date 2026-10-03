"""ledger: accounts + append-only, balanced entries

Revision ID: 1db6fac2a2f0
Revises: e4b9c7f21a86
Create Date: 2026-10-03 14:06:31

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "1db6fac2a2f0"
down_revision: str | None = "e4b9c7f21a86"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACCOUNT_KINDS = (
    "'stripe', 'bank', 'interac', 'cash', 'receivable', 'tax', 'gift_card', 'deposit', "
    "'deferred', 'payable', 'revenue', 'fee_revenue', 'processing_fee', 'platform_fee', "
    "'staff_cost'"
)
OWNER_TYPES = "'business', 'client', 'staff', 'platform', 'gift_card', 'package'"
ENTRY_TYPES = (
    "'invoice', 'sale', 'payment', 'refund', 'dispute', 'payout', 'redemption', "
    "'consumption', 'forfeit', 'earning', 'approval', 'staff_payment', 'adjustment', "
    "'reversal'"
)


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("business_id", sa.String(), nullable=False),
        sa.Column("owner_type", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("balance_cents", sa.BigInteger(), nullable=False),
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
        sa.CheckConstraint(f"kind IN ({ACCOUNT_KINDS})", name="ck_accounts_kind"),
        sa.CheckConstraint(f"owner_type IN ({OWNER_TYPES})", name="ck_accounts_owner_type"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_accounts_business_id", "accounts", ["business_id"])
    op.create_index(
        "ux_accounts_identity",
        "accounts",
        ["business_id", "owner_type", "owner_id", "kind", "code", "currency"],
        unique=True,
    )

    op.create_table(
        "entries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("business_id", sa.String(), nullable=False),
        sa.Column("journal_id", sa.String(), nullable=False),
        sa.Column("account_id", sa.String(), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("source_type", sa.String(), nullable=True),
        sa.Column("source_id", sa.String(), nullable=True),
        sa.Column("subject_type", sa.String(), nullable=True),
        sa.Column("subject_id", sa.String(), nullable=True),
        sa.Column("ref", sa.String(), nullable=False),
        sa.Column("leg", sa.Integer(), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(f"type IN ({ENTRY_TYPES})", name="ck_entries_type"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_entries_business_id", "entries", ["business_id"])
    op.create_index("ix_entries_journal", "entries", ["journal_id"])
    op.create_index("ix_entries_account", "entries", ["account_id", "occurred_at"])
    op.create_index("ix_entries_subject", "entries", ["subject_type", "subject_id"])
    op.create_index("ix_entries_source", "entries", ["source_type", "source_id"])
    op.create_index("ux_entries_ref_leg", "entries", ["ref", "leg"], unique=True)

    # a journal's legs must net to zero per currency, checked once the whole journal is written
    op.execute(
        """
        CREATE FUNCTION entries_balanced() RETURNS trigger AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM entries WHERE journal_id = NEW.journal_id
                GROUP BY currency HAVING sum(amount_cents) <> 0
            ) THEN
                RAISE EXCEPTION 'ledger journal % does not balance', NEW.journal_id;
            END IF;
            RETURN NULL;
        END $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE CONSTRAINT TRIGGER entries_balanced AFTER INSERT ON entries "
        "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entries_balanced()"
    )
    op.execute(
        """
        CREATE FUNCTION entries_append_only() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'ledger entries are append-only';
        END $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON entries "
        "FOR EACH ROW EXECUTE FUNCTION entries_append_only()"
    )


def downgrade() -> None:
    op.drop_table("entries")
    op.execute("DROP FUNCTION IF EXISTS entries_append_only()")
    op.execute("DROP FUNCTION IF EXISTS entries_balanced()")
    op.drop_table("accounts")
