"""ledger replaces derived money columns and payout tables

Revision ID: 7027f8f3446b
Revises: 7a3c9e1f4b20
Create Date: 2026-10-03 14:16:48

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7027f8f3446b"
down_revision: str | None = "7a3c9e1f4b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(op.f("ix_payout_alloc_source"), table_name="payout_allocations")
    op.drop_index(op.f("ix_payout_alloc_staff"), table_name="payout_allocations")
    op.drop_index(op.f("ix_payout_allocations_business_id"), table_name="payout_allocations")
    op.drop_table("payout_allocations")
    op.drop_index(op.f("ix_payouts_business_id"), table_name="payouts")
    op.drop_index(op.f("ix_payouts_provider_ref"), table_name="payouts")
    op.drop_index(op.f("ix_payouts_status"), table_name="payouts")
    op.drop_table("payouts")
    op.drop_column("bookings", "deposit_status")
    op.drop_constraint(op.f("businesses_parent_business_id_fkey"), "businesses", type_="foreignkey")
    op.drop_column("businesses", "payout_schedule")
    op.drop_column("businesses", "parent_business_id")
    op.drop_column("businesses", "plan")
    op.drop_column("businesses", "stripe_customer_id")
    op.drop_column("clients", "lifetime_value_cents")
    op.drop_column("gift_cards", "balance_cents")
    op.drop_column("invoices", "amount_paid_cents")
    op.drop_column("invoices", "balance_cents")
    op.drop_column("orders", "amount_paid_cents")
    op.drop_column("orders", "balance_cents")
    op.drop_column("payments", "fee_cents")
    op.drop_column("payments", "net_cents")
    op.drop_column("staff", "payout_ref")
    op.drop_constraint("ck_invoices_status", "invoices", type_="check")
    op.create_check_constraint(
        "ck_invoices_status",
        "invoices",
        "status IN ('draft', 'sent', 'partial', 'paid', 'overdue', 'void', 'refunded')",
    )


def downgrade() -> None:
    op.execute("UPDATE invoices SET status = 'paid' WHERE status = 'refunded'")
    op.drop_constraint("ck_invoices_status", "invoices", type_="check")
    op.create_check_constraint(
        "ck_invoices_status",
        "invoices",
        "status IN ('draft', 'sent', 'partial', 'paid', 'overdue', 'void')",
    )
    op.add_column(
        "staff", sa.Column("payout_ref", sa.VARCHAR(), autoincrement=False, nullable=True)
    )
    op.add_column(
        "payments",
        sa.Column(
            "net_cents", sa.BIGINT(), autoincrement=False, nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "payments",
        sa.Column(
            "fee_cents", sa.BIGINT(), autoincrement=False, nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "balance_cents", sa.BIGINT(), autoincrement=False, nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "amount_paid_cents",
            sa.BIGINT(),
            autoincrement=False,
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "invoices",
        sa.Column(
            "balance_cents", sa.BIGINT(), autoincrement=False, nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "invoices",
        sa.Column(
            "amount_paid_cents",
            sa.BIGINT(),
            autoincrement=False,
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "gift_cards",
        sa.Column(
            "balance_cents", sa.BIGINT(), autoincrement=False, nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "clients",
        sa.Column(
            "lifetime_value_cents",
            sa.BIGINT(),
            autoincrement=False,
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "businesses",
        sa.Column("stripe_customer_id", sa.VARCHAR(), autoincrement=False, nullable=True),
    )
    op.add_column("businesses", sa.Column("plan", sa.VARCHAR(), autoincrement=False, nullable=True))
    op.add_column(
        "businesses",
        sa.Column("parent_business_id", sa.VARCHAR(), autoincrement=False, nullable=True),
    )
    op.add_column(
        "businesses",
        sa.Column(
            "payout_schedule",
            sa.VARCHAR(),
            autoincrement=False,
            nullable=False,
            server_default="weekly",
        ),
    )
    op.create_foreign_key(
        op.f("businesses_parent_business_id_fkey"),
        "businesses",
        "businesses",
        ["parent_business_id"],
        ["id"],
    )
    op.add_column(
        "bookings",
        sa.Column(
            "deposit_status",
            sa.VARCHAR(),
            server_default=sa.text("'none'::character varying"),
            autoincrement=False,
            nullable=False,
        ),
    )
    op.create_table(
        "payouts",
        sa.Column(
            "amount_cents", sa.BIGINT(), autoincrement=False, nullable=False, server_default="0"
        ),
        sa.Column("status", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column(
            "arrival_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True
        ),
        sa.Column("provider_ref", sa.VARCHAR(), autoincrement=False, nullable=True),
        sa.Column("bank_last4", sa.VARCHAR(), autoincrement=False, nullable=True),
        sa.Column("id", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column("business_id", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.CheckConstraint(
            "status::text = ANY (ARRAY['pending'::character varying, 'in_transit'::character varying, 'paid'::character varying, 'failed'::character varying, 'canceled'::character varying]::text[])",
            name=op.f("ck_payouts_status"),
        ),
        sa.ForeignKeyConstraint(
            ["business_id"], ["businesses.id"], name=op.f("payouts_business_id_fkey")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("payouts_pkey")),
    )
    op.create_index(op.f("ix_payouts_status"), "payouts", ["business_id", "status"], unique=False)
    op.create_index(
        op.f("ix_payouts_provider_ref"), "payouts", ["business_id", "provider_ref"], unique=True
    )
    op.create_index(op.f("ix_payouts_business_id"), "payouts", ["business_id"], unique=False)
    op.create_table(
        "payout_allocations",
        sa.Column("staff_id", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column("source_type", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column("source_id", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column("basis", sa.VARCHAR(), autoincrement=False, nullable=True),
        sa.Column("rate", sa.NUMERIC(), autoincrement=False, nullable=True),
        sa.Column(
            "amount_cents", sa.BIGINT(), autoincrement=False, nullable=False, server_default="0"
        ),
        sa.Column("status", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column("payout_id", sa.VARCHAR(), autoincrement=False, nullable=True),
        sa.Column("id", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column("business_id", sa.VARCHAR(), autoincrement=False, nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.CheckConstraint(
            "basis::text = ANY (ARRAY['rate'::character varying, 'percent'::character varying, 'fixed'::character varying]::text[])",
            name=op.f("ck_payout_allocations_basis"),
        ),
        sa.CheckConstraint(
            "source_type::text = ANY (ARRAY['booking'::character varying, 'invoice_line'::character varying, 'class_session'::character varying, 'tip'::character varying, 'sale'::character varying]::text[])",
            name=op.f("ck_payout_allocations_source_type"),
        ),
        sa.CheckConstraint(
            "status::text = ANY (ARRAY['pending'::character varying, 'approved'::character varying, 'paid'::character varying]::text[])",
            name=op.f("ck_payout_allocations_status"),
        ),
        sa.ForeignKeyConstraint(
            ["business_id"], ["businesses.id"], name=op.f("payout_allocations_business_id_fkey")
        ),
        sa.ForeignKeyConstraint(
            ["payout_id"], ["payouts.id"], name=op.f("payout_allocations_payout_id_fkey")
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("payout_allocations_staff_id_fkey")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("payout_allocations_pkey")),
    )
    op.create_index(
        op.f("ix_payout_allocations_business_id"),
        "payout_allocations",
        ["business_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_payout_alloc_staff"),
        "payout_allocations",
        ["business_id", "staff_id", "status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_payout_alloc_source"),
        "payout_allocations",
        ["source_type", "source_id", "staff_id"],
        unique=True,
    )
