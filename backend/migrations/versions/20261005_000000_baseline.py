"""Baseline schema: every table, constraint, index and ledger trigger as of the squash.

Keeps the id of the last pre-squash revision so databases created before the squash count as at baseline.

Revision ID: 8f2d5b7a1c94
Revises:
Create Date: 2026-10-05 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "8f2d5b7a1c94"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.create_table(
        "businesses",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("locale", sa.String(), nullable=False),
        sa.Column("timezone", sa.String(), nullable=False),
        sa.Column("province", sa.String(), nullable=True),
        sa.Column("gst_hst_number", sa.String(), nullable=True),
        sa.Column("qst_number", sa.String(), nullable=True),
        sa.Column("tax_registered", sa.Boolean(), nullable=False),
        sa.Column("brand", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("billing_email", sa.String(), nullable=True),
        sa.Column("stripe_account_id", sa.String(), nullable=True),
        sa.Column("stripe_terminal_location_id", sa.String(), nullable=True),
        sa.Column("stripe_charges_enabled", sa.Boolean(), nullable=False),
        sa.Column("stripe_payouts_enabled", sa.Boolean(), nullable=False),
        sa.Column("stripe_details_submitted", sa.Boolean(), nullable=False),
        sa.Column("stripe_requirements", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
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
        sa.CheckConstraint("status IN ('active', 'closed')", name="ck_businesses_status"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(
        "ix_businesses_stripe_account", "businesses", ["stripe_account_id"], unique=True
    )
    op.create_table(
        "users",
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=True),
        sa.Column("oauth", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "webhooks",
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("event", sa.String(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
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
            "provider IN ('stripe', 'interac', 'twilio', 'sendgrid')", name="ck_webhooks_provider"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'processed', 'failed')", name="ck_webhooks_status"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webhook_provider_status", "webhooks", ["provider", "status"], unique=False)
    op.create_table(
        "accounts",
        sa.Column("owner_type", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("balance_cents", sa.BigInteger(), nullable=False),
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
            "category IN ('stripe', 'bank', 'cash', 'receivable', 'tax', 'gift_card', 'deposit', 'deferred', 'payable', 'revenue', 'fee_revenue', 'processing_fee', 'platform_fee', 'staff_cost')",
            name="ck_accounts_category",
        ),
        sa.CheckConstraint(
            "owner_type IN ('business', 'client', 'staff', 'platform', 'gift_card', 'package')",
            name="ck_accounts_owner_type",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_accounts_business_id"), "accounts", ["business_id"], unique=False)
    op.create_index(
        "ux_accounts_identity",
        "accounts",
        ["business_id", "owner_type", "owner_id", "category", "code", "currency"],
        unique=True,
    )
    op.create_table(
        "audits",
        sa.Column("performed_by", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.String(), nullable=False),
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("business_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["performed_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_created", "audits", ["business_id", "created_at"], unique=False)
    op.create_index(
        "ix_audit_entity", "audits", ["business_id", "entity_type", "entity_id"], unique=False
    )
    op.create_index(op.f("ix_audits_business_id"), "audits", ["business_id"], unique=False)
    op.create_table(
        "broadcasts",
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("body", sa.String(), nullable=True),
        sa.Column("audience", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint("channel IN ('sms', 'email')", name="ck_broadcasts_channel"),
        sa.CheckConstraint(
            "status IN ('draft', 'scheduled', 'sending', 'sent', 'canceled')",
            name="ck_broadcasts_status",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_broadcasts_business_id"), "broadcasts", ["business_id"], unique=False)
    op.create_index("ix_broadcasts_status", "broadcasts", ["business_id", "status"], unique=False)
    op.create_table(
        "clients",
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("custom_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("stripe_customer_id", sa.String(), nullable=True),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_clients_status"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clients_business_email", "clients", ["business_id", "email"], unique=False)
    op.create_index(op.f("ix_clients_business_id"), "clients", ["business_id"], unique=False)
    op.create_index("ix_clients_business_phone", "clients", ["business_id", "phone"], unique=False)
    op.create_table(
        "commands",
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("response", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "scope", "key", name="uq_idempotency_scope_key"),
    )
    op.create_index(op.f("ix_commands_business_id"), "commands", ["business_id"], unique=False)
    op.create_table(
        "contracts",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("body", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("always_require", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_contracts_business_id"), "contracts", ["business_id"], unique=False)
    op.create_table(
        "devices",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("platform", sa.String(), nullable=False),
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
        sa.CheckConstraint("platform IN ('ios', 'android', 'web')", name="ck_devices_platform"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_devices_business", "devices", ["business_id"], unique=False)
    op.create_index(op.f("ix_devices_business_id"), "devices", ["business_id"], unique=False)
    op.create_index("ix_devices_token", "devices", ["token"], unique=True)
    op.create_table(
        "files",
        sa.Column("parent_type", sa.String(), nullable=False),
        sa.Column("parent_id", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=True),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
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
            "parent_type IN ('business', 'client', 'subject', 'item', 'signature', 'form_response')",
            name="ck_files_parent_type",
        ),
        sa.CheckConstraint(
            "purpose IN ('logo', 'image', 'photo', 'signature', 'attachment')",
            name="ck_files_purpose",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_files_business_id"), "files", ["business_id"], unique=False)
    op.create_index(
        "ix_files_parent", "files", ["business_id", "parent_type", "parent_id"], unique=False
    )
    op.create_table(
        "forms",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("attach_to", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("require_signature", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_forms_business_id"), "forms", ["business_id"], unique=False)
    op.create_table(
        "items",
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("price_cents", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("duration_min", sa.Integer(), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("online_bookable", sa.Boolean(), nullable=False),
        sa.Column("sell_online", sa.Boolean(), nullable=False),
        sa.Column("buffer_before_min", sa.Integer(), nullable=False),
        sa.Column("buffer_after_min", sa.Integer(), nullable=False),
        sa.Column("deposit_type", sa.String(), nullable=False),
        sa.Column("deposit_value", sa.Numeric(), nullable=True),
        sa.Column("interval", sa.Integer(), nullable=True),
        sa.Column("frequency", sa.String(), nullable=True),
        sa.Column("session_count", sa.Integer(), nullable=True),
        sa.Column("validity_days", sa.Integer(), nullable=True),
        sa.Column("stripe_price_id", sa.String(), nullable=True),
        sa.Column("tax_class", sa.String(), nullable=False),
        sa.Column("sku", sa.String(), nullable=True),
        sa.Column("cost_cents", sa.BigInteger(), nullable=True),
        sa.Column("track_stock", sa.Boolean(), nullable=False),
        sa.Column("stock_on_hand", sa.Integer(), nullable=True),
        sa.Column("low_stock_at", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("custom_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
            "deposit_type IN ('none', 'fixed', 'percent')", name="ck_items_deposit_type"
        ),
        sa.CheckConstraint(
            "frequency IN ('day', 'week', 'month', 'year')", name="ck_items_frequency"
        ),
        sa.CheckConstraint(
            "kind IN ('service', 'class', 'product', 'package', 'subscription', 'gift')",
            name="ck_items_kind",
        ),
        sa.CheckConstraint(
            "online_bookable = false OR kind IN ('service', 'class')",
            name="ck_items_online_bookable_kind",
        ),
        sa.CheckConstraint(
            "sell_online = false OR kind = 'product'", name="ck_items_sell_online_kind"
        ),
        sa.CheckConstraint(
            "tax_class IN ('standard', 'federal_only', 'exempt')", name="ck_items_tax_class"
        ),
        sa.CheckConstraint("track_stock = false OR kind = 'product'", name="ck_items_stock_kind"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_items_business_id"), "items", ["business_id"], unique=False)
    op.create_index(
        "ix_items_business_kind_active", "items", ["business_id", "kind", "active"], unique=False
    )
    op.create_index(
        "ux_items_business_sku",
        "items",
        ["business_id", "sku"],
        unique=True,
        postgresql_where=sa.text("sku IS NOT NULL"),
    )
    op.create_table(
        "notes",
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("parent_type", sa.String(), nullable=False),
        sa.Column("parent_id", sa.String(), nullable=False),
        sa.Column("body", sa.String(), nullable=False),
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
            "parent_type IN ('client', 'subject', 'booking')", name="ck_notes_parent_type"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notes_business_id"), "notes", ["business_id"], unique=False)
    op.create_index(
        "ix_notes_parent", "notes", ["business_id", "parent_type", "parent_id"], unique=False
    )
    op.create_table(
        "resources",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
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
        sa.CheckConstraint("category IN ('room', 'equipment')", name="ck_resources_category"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_resources_business_id"), "resources", ["business_id"], unique=False)
    op.create_table(
        "sessions",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("family_id", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("device", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sessions_family", "sessions", ["family_id"], unique=False)
    op.create_index("ix_sessions_user", "sessions", ["user_id"], unique=False)
    op.create_table(
        "staff",
        sa.Column("business_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("payee", sa.Boolean(), nullable=False),
        sa.Column("rate_type", sa.String(), nullable=True),
        sa.Column("rate_bps", sa.Integer(), nullable=True),
        sa.Column("rate_cents", sa.BigInteger(), nullable=True),
        sa.Column("retail_rate_bps", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("invite_email", sa.String(), nullable=True),
        sa.Column("invite_token", sa.String(), nullable=True),
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
            "(rate_type = 'percent' AND rate_cents IS NULL) OR (rate_type IN ('fixed', 'hourly') AND rate_bps IS NULL) OR (rate_type IS NULL AND rate_bps IS NULL AND rate_cents IS NULL)",
            name="ck_staff_rate_unit",
        ),
        sa.CheckConstraint(
            "rate_type IN ('percent', 'fixed', 'hourly')", name="ck_staff_rate_type"
        ),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'staff', 'contractor')", name="ck_staff_role"
        ),
        sa.CheckConstraint("status IN ('active', 'invited')", name="ck_staff_status"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "user_id", name="uq_staff_business_user"),
    )
    op.create_index(op.f("ix_staff_business_id"), "staff", ["business_id"], unique=False)
    op.create_table(
        "tokens",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.CheckConstraint("purpose IN ('reset', 'verify')", name="ck_tokens_purpose"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tokens_user", "tokens", ["user_id"], unique=False)
    op.create_table(
        "entries",
        sa.Column("journal_id", sa.String(), nullable=False),
        sa.Column("account_id", sa.String(), nullable=False),
        sa.Column("owner_type", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("event", sa.String(), nullable=False),
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
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("business_id", sa.String(), nullable=False),
        sa.CheckConstraint(
            "event IN ('invoice', 'sale', 'payment', 'fee', 'refund', 'dispute', 'payout', 'redemption', 'consumption', 'forfeit', 'application', 'breakage', 'remittance', 'earning', 'approval', 'staff_payment', 'adjustment', 'reversal')",
            name="ck_entries_event",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_entries_account", "entries", ["account_id", "occurred_at"], unique=False)
    op.create_index(op.f("ix_entries_business_id"), "entries", ["business_id"], unique=False)
    op.create_index("ix_entries_journal", "entries", ["journal_id"], unique=False)
    op.create_index("ix_entries_owner", "entries", ["owner_type", "owner_id"], unique=False)
    op.create_index("ix_entries_source", "entries", ["source_type", "source_id"], unique=False)
    op.create_index("ix_entries_subject", "entries", ["subject_type", "subject_id"], unique=False)
    op.create_index("ux_entries_ref_leg", "entries", ["ref", "leg"], unique=True)
    op.create_table(
        "fields",
        sa.Column("form_id", sa.String(), nullable=False),
        sa.Column("input", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("help", sa.String(), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("validation", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
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
            "input IN ('text', 'longtext', 'number', 'currency', 'select', 'multiselect', 'checkbox', 'date', 'time', 'email', 'phone', 'address', 'file', 'image', 'signature', 'rating')",
            name="ck_fields_input",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["form_id"],
            ["forms.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_fields_business_id"), "fields", ["business_id"], unique=False)
    op.create_index("ix_fields_form", "fields", ["form_id", "position"], unique=False)
    op.create_table(
        "hours",
        sa.Column("staff_id", sa.String(), nullable=False),
        sa.Column("basis", sa.String(), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
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
        sa.CheckConstraint("basis IN ('recurring', 'date')", name="ck_hours_basis"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_hours_business_id"), "hours", ["business_id"], unique=False)
    op.create_index("ix_hours_staff", "hours", ["business_id", "staff_id", "basis"], unique=False)
    op.create_table(
        "invoices",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("number", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("subtotal_cents", sa.BigInteger(), nullable=False),
        sa.Column("tax_total_cents", sa.BigInteger(), nullable=False),
        sa.Column("total_cents", sa.BigInteger(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("overdue_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("pay_token", sa.String(), nullable=True),
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
        sa.CheckConstraint("status IN ('draft', 'sent', 'void')", name="ck_invoices_status"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "number", name="uq_invoices_business_number"),
        sa.UniqueConstraint("pay_token"),
    )
    op.create_index(op.f("ix_invoices_business_id"), "invoices", ["business_id"], unique=False)
    op.create_index("ix_invoices_client", "invoices", ["business_id", "client_id"], unique=False)
    op.create_index("ix_invoices_status", "invoices", ["business_id", "status"], unique=False)
    op.create_table(
        "orders",
        sa.Column("client_id", sa.String(), nullable=True),
        sa.Column("staff_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("subtotal_cents", sa.BigInteger(), nullable=False),
        sa.Column("tax_total_cents", sa.BigInteger(), nullable=False),
        sa.Column("total_cents", sa.BigInteger(), nullable=False),
        sa.Column("receipt_email", sa.String(), nullable=True),
        sa.Column("receipt_phone", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("pickup_status", sa.String(), nullable=True),
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
            "pickup_status IS NULL OR pickup_status IN ('unfulfilled', 'ready', 'picked_up')",
            name="ck_orders_pickup_status",
        ),
        sa.CheckConstraint("source IN ('pos', 'online')", name="ck_orders_source"),
        sa.CheckConstraint("status IN ('open', 'void')", name="ck_orders_status"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_orders_business_id"), "orders", ["business_id"], unique=False)
    op.create_index("ix_orders_status", "orders", ["business_id", "status"], unique=False)
    op.create_table(
        "payment_methods",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("method", sa.String(), nullable=False),
        sa.Column("brand", sa.String(), nullable=True),
        sa.Column("last4", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("provider_ref", sa.String(), nullable=True),
        sa.Column("preferred", sa.Boolean(), nullable=False),
        sa.Column("mandate_status", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
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
            "mandate_status IN ('none', 'pending', 'active', 'revoked')",
            name="ck_payment_methods_mandate_status",
        ),
        sa.CheckConstraint(
            "method IN ('card', 'bank_eft', 'interac')", name="ck_payment_methods_method"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_payment_methods_business_id"), "payment_methods", ["business_id"], unique=False
    )
    op.create_index(
        "ix_payment_methods_client", "payment_methods", ["business_id", "client_id"], unique=False
    )
    op.create_index(
        "ix_payment_methods_provider",
        "payment_methods",
        ["business_id", "provider_ref"],
        unique=True,
    )
    op.create_table(
        "recurrences",
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("staff_id", sa.String(), nullable=True),
        sa.Column("client_id", sa.String(), nullable=True),
        sa.Column("frequency", sa.String(), nullable=False),
        sa.Column("interval", sa.Integer(), nullable=False),
        sa.Column("byday", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("count", sa.Integer(), nullable=True),
        sa.Column("until", sa.Date(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
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
            "frequency IN ('day', 'week', 'month')", name="ck_recurrences_frequency"
        ),
        sa.CheckConstraint(
            "status IN ('active', 'ended', 'canceled')", name="ck_recurrences_status"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_recurrences_business_id"), "recurrences", ["business_id"], unique=False
    )
    op.create_index("ix_recurrences_status", "recurrences", ["business_id", "status"], unique=False)
    op.create_table(
        "responses",
        sa.Column("form_id", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=True),
        sa.Column("parent_type", sa.String(), nullable=True),
        sa.Column("parent_id", sa.String(), nullable=True),
        sa.Column("token", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
            "parent_type IN ('client', 'subject', 'booking')", name="ck_responses_parent_type"
        ),
        sa.CheckConstraint("status IN ('draft', 'submitted')", name="ck_responses_status"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["form_id"],
            ["forms.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_responses_token"),
    )
    op.create_index(op.f("ix_responses_business_id"), "responses", ["business_id"], unique=False)
    op.create_index("ix_responses_form", "responses", ["business_id", "form_id"], unique=False)
    op.create_index("ix_responses_parent", "responses", ["parent_type", "parent_id"], unique=False)
    op.create_table(
        "signatures",
        sa.Column("contract_id", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("parent_type", sa.String(), nullable=True),
        sa.Column("parent_id", sa.String(), nullable=True),
        sa.Column("token", sa.String(), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signature_image_id", sa.String(), nullable=True),
        sa.Column("signed_body", sa.String(), nullable=True),
        sa.Column("ip", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
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
            "parent_type IN ('client', 'subject', 'booking')", name="ck_signatures_parent_type"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'signed', 'declined', 'expired')", name="ck_signatures_status"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["contract_id"],
            ["contracts.id"],
        ),
        sa.ForeignKeyConstraint(
            ["signature_image_id"],
            ["files.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_signatures_token"),
    )
    op.create_index(op.f("ix_signatures_business_id"), "signatures", ["business_id"], unique=False)
    op.create_index(
        "ix_signatures_contract", "signatures", ["business_id", "contract_id"], unique=False
    )
    op.create_index(
        "ix_signatures_parent", "signatures", ["parent_type", "parent_id"], unique=False
    )
    op.create_table(
        "subjects",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("attributes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
            "kind IN ('pet', 'vehicle', 'child', 'property')", name="ck_subjects_kind"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_subjects_business_client", "subjects", ["business_id", "client_id"], unique=False
    )
    op.create_index(op.f("ix_subjects_business_id"), "subjects", ["business_id"], unique=False)
    op.create_table(
        "threads",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
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
        sa.CheckConstraint("channel IN ('sms', 'email', 'chat')", name="ck_threads_channel"),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_threads_status"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "business_id", "client_id", "channel", name="uq_threads_client_channel"
        ),
    )
    op.create_index(op.f("ix_threads_business_id"), "threads", ["business_id"], unique=False)
    op.create_table(
        "estimates",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("number", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("subtotal_cents", sa.BigInteger(), nullable=False),
        sa.Column("tax_total_cents", sa.BigInteger(), nullable=False),
        sa.Column("total_cents", sa.BigInteger(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("converted_invoice_id", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
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
            "status IN ('draft', 'sent', 'accepted', 'declined')", name="ck_estimates_status"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["converted_invoice_id"],
            ["invoices.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "number", name="uq_estimates_business_number"),
    )
    op.create_index(op.f("ix_estimates_business_id"), "estimates", ["business_id"], unique=False)
    op.create_index("ix_estimates_status", "estimates", ["business_id", "status"], unique=False)
    op.create_table(
        "messages",
        sa.Column("thread_id", sa.String(), nullable=False),
        sa.Column("direction", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("sent_by", sa.String(), nullable=True),
        sa.Column("body", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("broadcast_id", sa.String(), nullable=True),
        sa.Column("provider_ref", sa.String(), nullable=True),
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
        sa.CheckConstraint("direction IN ('in', 'out')", name="ck_messages_direction"),
        sa.CheckConstraint(
            "status IN ('draft', 'queued', 'sent', 'delivered', 'read', 'failed')",
            name="ck_messages_status",
        ),
        sa.ForeignKeyConstraint(
            ["broadcast_id"],
            ["broadcasts.id"],
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["sent_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["threads.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_messages_broadcast", "messages", ["broadcast_id"], unique=False)
    op.create_index(op.f("ix_messages_business_id"), "messages", ["business_id"], unique=False)
    op.create_index("ix_messages_thread", "messages", ["thread_id", "created_at"], unique=False)
    op.create_table(
        "payments",
        sa.Column("client_id", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("parent_payment_id", sa.String(), nullable=True),
        sa.Column("invoice_id", sa.String(), nullable=True),
        sa.Column("order_id", sa.String(), nullable=True),
        sa.Column("booking_id", sa.String(), nullable=True),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("method", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_ref", sa.String(), nullable=True),
        sa.Column("reference_code", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
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
            "(kind = 'refund') = (parent_payment_id IS NOT NULL) AND num_nonnulls(invoice_id, order_id) <= 1 AND (order_id IS NULL OR booking_id IS NULL)",
            name="ck_payments_target",
        ),
        sa.CheckConstraint("kind IN ('payment', 'deposit', 'refund')", name="ck_payments_kind"),
        sa.CheckConstraint(
            "method IN ('card', 'interac', 'bank_eft', 'cash', 'other')", name="ck_payments_method"
        ),
        sa.CheckConstraint(
            "provider IN ('stripe', 'interac', 'manual')", name="ck_payments_provider"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'succeeded', 'failed', 'refunded', 'canceled')",
            name="ck_payments_status",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["invoices.id"],
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
        ),
        sa.ForeignKeyConstraint(
            ["parent_payment_id"],
            ["payments.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_payments_business_id"), "payments", ["business_id"], unique=False)
    op.create_index("ix_payments_invoice", "payments", ["invoice_id"], unique=False)
    op.create_index("ix_payments_order", "payments", ["order_id"], unique=False)
    op.create_index("ix_payments_provider_ref", "payments", ["provider_ref"], unique=True)
    op.create_index("ix_payments_reference_code", "payments", ["reference_code"], unique=True)
    op.create_index("ix_payments_refund_parent", "payments", ["parent_payment_id"], unique=False)
    op.create_index("ix_payments_status", "payments", ["business_id", "status"], unique=False)
    op.create_table(
        "slots",
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("staff_id", sa.String(), nullable=False),
        sa.Column("resource_id", sa.String(), nullable=True),
        sa.Column("recurrence_id", sa.String(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
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
            "status IN ('scheduled', 'canceled', 'completed')", name="ck_slots_status"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["recurrence_id"],
            ["recurrences.id"],
        ),
        sa.ForeignKeyConstraint(
            ["resource_id"],
            ["resources.id"],
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_slots_business_id"), "slots", ["business_id"], unique=False)
    op.create_index("ix_slots_business_start", "slots", ["business_id", "starts_at"], unique=False)
    op.create_index(
        "ix_slots_staff_start", "slots", ["business_id", "staff_id", "starts_at"], unique=False
    )
    op.create_table(
        "subscriptions",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_method_id", sa.String(), nullable=True),
        sa.Column("provider_ref", sa.String(), nullable=True),
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
            "status IN ('active', 'paused', 'canceled', 'past_due')", name="ck_subscriptions_status"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["payment_method_id"],
            ["payment_methods.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_subscriptions_active_unique",
        "subscriptions",
        ["business_id", "client_id", "item_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('active', 'paused')"),
    )
    op.create_index(
        op.f("ix_subscriptions_business_id"), "subscriptions", ["business_id"], unique=False
    )
    op.create_index(
        "ix_subscriptions_client_status",
        "subscriptions",
        ["business_id", "client_id", "status"],
        unique=False,
    )
    op.create_index("ix_subscriptions_provider_ref", "subscriptions", ["provider_ref"], unique=True)
    op.create_table(
        "gift_cards",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=True),
        sa.Column("initial_cents", sa.BigInteger(), nullable=False),
        sa.Column("purchaser_client_id", sa.String(), nullable=True),
        sa.Column("recipient", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("payment_id", sa.String(), nullable=True),
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
            "status IN ('active', 'expired', 'void', 'pending')", name="ck_gift_cards_status"
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["payments.id"],
        ),
        sa.ForeignKeyConstraint(
            ["purchaser_client_id"],
            ["clients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "code", name="uq_gift_cards_business_code"),
    )
    op.create_index(op.f("ix_gift_cards_business_id"), "gift_cards", ["business_id"], unique=False)
    op.create_table(
        "packages",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("sessions_total", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("payment_id", sa.String(), nullable=True),
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
            "status IN ('active', 'used', 'expired', 'canceled', 'pending')",
            name="ck_packages_status",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["payments.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_packages_business_id"), "packages", ["business_id"], unique=False)
    op.create_index(
        "ix_packages_client_status",
        "packages",
        ["business_id", "client_id", "status"],
        unique=False,
    )
    op.create_table(
        "bookings",
        sa.Column("slot_id", sa.String(), nullable=False),
        sa.Column("staff_id", sa.String(), nullable=True),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("subject_id", sa.String(), nullable=True),
        sa.Column("package_id", sa.String(), nullable=True),
        sa.Column("invoice_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("price_cents", sa.BigInteger(), nullable=False),
        sa.Column("deposit_amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("deposit_status", sa.String(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("custom_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "deposit_status IN ('none', 'pending', 'collected', 'applied', 'forfeited', 'refunded')",
            name="ck_bookings_deposit_status",
        ),
        sa.CheckConstraint("source IN ('online', 'manual')", name="ck_bookings_source"),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'completed', 'canceled', 'no_show')",
            name="ck_bookings_status",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["invoices.id"],
        ),
        sa.ForeignKeyConstraint(
            ["package_id"],
            ["packages.id"],
        ),
        sa.ForeignKeyConstraint(
            ["slot_id"],
            ["slots.id"],
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
        ),
        sa.ForeignKeyConstraint(
            ["subject_id"],
            ["subjects.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bookings_business_id"), "bookings", ["business_id"], unique=False)
    op.create_index("ix_bookings_client", "bookings", ["business_id", "client_id"], unique=False)
    op.create_index("ix_bookings_slot", "bookings", ["business_id", "slot_id"], unique=False)
    op.create_index("ix_bookings_staff", "bookings", ["business_id", "staff_id"], unique=False)
    op.create_index("ix_bookings_status", "bookings", ["business_id", "status"], unique=False)
    op.create_table(
        "addons",
        sa.Column("booking_id", sa.String(), nullable=False),
        sa.Column("staff_id", sa.String(), nullable=True),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_amount_cents", sa.BigInteger(), nullable=False),
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
        sa.CheckConstraint("quantity > 0", name="ck_addons_quantity"),
        sa.ForeignKeyConstraint(
            ["booking_id"],
            ["bookings.id"],
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_addons_booking", "addons", ["business_id", "booking_id"], unique=False)
    op.create_index(op.f("ix_addons_business_id"), "addons", ["business_id"], unique=False)
    op.create_table(
        "lines",
        sa.Column("estimate_id", sa.String(), nullable=True),
        sa.Column("invoice_id", sa.String(), nullable=True),
        sa.Column("order_id", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=True),
        sa.Column("booking_id", sa.String(), nullable=True),
        sa.Column("quantity", sa.Numeric(), nullable=False),
        sa.Column("unit_amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("tax_amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("tax_class", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
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
            "tax_class IN ('standard', 'federal_only', 'exempt')", name="ck_lines_tax_class"
        ),
        sa.CheckConstraint(
            "num_nonnulls(estimate_id, invoice_id, order_id) = 1", name="ck_lines_parent"
        ),
        sa.ForeignKeyConstraint(
            ["booking_id"],
            ["bookings.id"],
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["estimate_id"],
            ["estimates.id"],
        ),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["invoices.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_lines_business_id"), "lines", ["business_id"], unique=False)
    op.create_index("ix_lines_estimate", "lines", ["estimate_id"], unique=False)
    op.create_index("ix_lines_invoice", "lines", ["invoice_id"], unique=False)
    op.create_index("ix_lines_order", "lines", ["order_id"], unique=False)
    op.create_table(
        "reviews",
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("booking_id", sa.String(), nullable=True),
        sa.Column("channel", sa.String(), nullable=True),
        sa.Column("token", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rating", sa.SmallInteger(), nullable=True),
        sa.Column("body", sa.String(), nullable=True),
        sa.Column("response", sa.String(), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_to_google", sa.Boolean(), nullable=False),
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
        sa.CheckConstraint("channel IN ('sms', 'email')", name="ck_reviews_channel"),
        sa.CheckConstraint(
            "status IN ('requested', 'opened') OR rating IS NOT NULL",
            name="ck_reviews_submitted_rating",
        ),
        sa.CheckConstraint(
            "status IN ('requested', 'opened', 'submitted', 'published', 'hidden')",
            name="ck_reviews_status",
        ),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating"),
        sa.ForeignKeyConstraint(
            ["booking_id"],
            ["bookings.id"],
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["clients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_reviews_token"),
    )
    op.create_index(op.f("ix_reviews_business_id"), "reviews", ["business_id"], unique=False)
    op.create_index(
        "ix_reviews_status_created",
        "reviews",
        ["business_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "uq_reviews_open_booking",
        "reviews",
        ["business_id", "booking_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('requested', 'opened') AND booking_id IS NOT NULL"),
    )
    op.create_table(
        "inventory",
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("line_id", sa.String(), nullable=True),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
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
        sa.CheckConstraint("reason IN ('sale', 'refund', 'restock')", name="ck_inventory_reason"),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.id"],
        ),
        sa.ForeignKeyConstraint(
            ["line_id"],
            ["lines.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_inventory_business_id"), "inventory", ["business_id"], unique=False)
    op.create_index("ix_inventory_item", "inventory", ["business_id", "item_id"], unique=False)
    op.create_index(
        "ux_inventory_line_reason",
        "inventory",
        ["line_id", "reason"],
        unique=True,
        postgresql_where=sa.text("line_id IS NOT NULL"),
    )

    # payments and bookings reference each other, so this key is added once both tables exist
    op.create_foreign_key("fk_payments_booking", "payments", "bookings", ["booking_id"], ["id"])
    # a staff member or a room can't hold two live slots at overlapping times
    op.execute(
        "ALTER TABLE slots ADD CONSTRAINT excl_slots_staff_overlap EXCLUDE USING gist "
        "(business_id WITH =, staff_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) "
        "WHERE (status <> 'canceled')"
    )
    op.execute(
        "ALTER TABLE slots ADD CONSTRAINT excl_slots_resource_overlap EXCLUDE USING gist "
        "(business_id WITH =, resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) "
        "WHERE (resource_id IS NOT NULL AND status <> 'canceled')"
    )
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
    op.drop_constraint("fk_payments_booking", "payments", type_="foreignkey")
    op.drop_index(
        "ux_inventory_line_reason",
        table_name="inventory",
        postgresql_where=sa.text("line_id IS NOT NULL"),
    )
    op.drop_index("ix_inventory_item", table_name="inventory")
    op.drop_index(op.f("ix_inventory_business_id"), table_name="inventory")
    op.drop_table("inventory")
    op.drop_index(
        "uq_reviews_open_booking",
        table_name="reviews",
        postgresql_where=sa.text("status IN ('requested', 'opened') AND booking_id IS NOT NULL"),
    )
    op.drop_index("ix_reviews_status_created", table_name="reviews")
    op.drop_index(op.f("ix_reviews_business_id"), table_name="reviews")
    op.drop_table("reviews")
    op.drop_index("ix_lines_order", table_name="lines")
    op.drop_index("ix_lines_invoice", table_name="lines")
    op.drop_index("ix_lines_estimate", table_name="lines")
    op.drop_index(op.f("ix_lines_business_id"), table_name="lines")
    op.drop_table("lines")
    op.drop_index(op.f("ix_addons_business_id"), table_name="addons")
    op.drop_index("ix_addons_booking", table_name="addons")
    op.drop_table("addons")
    op.drop_index("ix_bookings_status", table_name="bookings")
    op.drop_index("ix_bookings_staff", table_name="bookings")
    op.drop_index("ix_bookings_slot", table_name="bookings")
    op.drop_index("ix_bookings_client", table_name="bookings")
    op.drop_index(op.f("ix_bookings_business_id"), table_name="bookings")
    op.drop_table("bookings")
    op.drop_index("ix_packages_client_status", table_name="packages")
    op.drop_index(op.f("ix_packages_business_id"), table_name="packages")
    op.drop_table("packages")
    op.drop_index(op.f("ix_gift_cards_business_id"), table_name="gift_cards")
    op.drop_table("gift_cards")
    op.drop_index("ix_subscriptions_provider_ref", table_name="subscriptions")
    op.drop_index("ix_subscriptions_client_status", table_name="subscriptions")
    op.drop_index(op.f("ix_subscriptions_business_id"), table_name="subscriptions")
    op.drop_index(
        "ix_subscriptions_active_unique",
        table_name="subscriptions",
        postgresql_where=sa.text("status IN ('active', 'paused')"),
    )
    op.drop_table("subscriptions")
    op.drop_index("ix_slots_staff_start", table_name="slots")
    op.drop_index("ix_slots_business_start", table_name="slots")
    op.drop_index(op.f("ix_slots_business_id"), table_name="slots")
    op.drop_table("slots")
    op.drop_index("ix_payments_status", table_name="payments")
    op.drop_index("ix_payments_refund_parent", table_name="payments")
    op.drop_index("ix_payments_reference_code", table_name="payments")
    op.drop_index("ix_payments_provider_ref", table_name="payments")
    op.drop_index("ix_payments_order", table_name="payments")
    op.drop_index("ix_payments_invoice", table_name="payments")
    op.drop_index(op.f("ix_payments_business_id"), table_name="payments")
    op.drop_table("payments")
    op.drop_index("ix_messages_thread", table_name="messages")
    op.drop_index(op.f("ix_messages_business_id"), table_name="messages")
    op.drop_index("ix_messages_broadcast", table_name="messages")
    op.drop_table("messages")
    op.drop_index("ix_estimates_status", table_name="estimates")
    op.drop_index(op.f("ix_estimates_business_id"), table_name="estimates")
    op.drop_table("estimates")
    op.drop_index(op.f("ix_threads_business_id"), table_name="threads")
    op.drop_table("threads")
    op.drop_index(op.f("ix_subjects_business_id"), table_name="subjects")
    op.drop_index("ix_subjects_business_client", table_name="subjects")
    op.drop_table("subjects")
    op.drop_index("ix_signatures_parent", table_name="signatures")
    op.drop_index("ix_signatures_contract", table_name="signatures")
    op.drop_index(op.f("ix_signatures_business_id"), table_name="signatures")
    op.drop_table("signatures")
    op.drop_index("ix_responses_parent", table_name="responses")
    op.drop_index("ix_responses_form", table_name="responses")
    op.drop_index(op.f("ix_responses_business_id"), table_name="responses")
    op.drop_table("responses")
    op.drop_index("ix_recurrences_status", table_name="recurrences")
    op.drop_index(op.f("ix_recurrences_business_id"), table_name="recurrences")
    op.drop_table("recurrences")
    op.drop_index("ix_payment_methods_provider", table_name="payment_methods")
    op.drop_index("ix_payment_methods_client", table_name="payment_methods")
    op.drop_index(op.f("ix_payment_methods_business_id"), table_name="payment_methods")
    op.drop_table("payment_methods")
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_index(op.f("ix_orders_business_id"), table_name="orders")
    op.drop_table("orders")
    op.drop_index("ix_invoices_status", table_name="invoices")
    op.drop_index("ix_invoices_client", table_name="invoices")
    op.drop_index(op.f("ix_invoices_business_id"), table_name="invoices")
    op.drop_table("invoices")
    op.drop_index("ix_hours_staff", table_name="hours")
    op.drop_index(op.f("ix_hours_business_id"), table_name="hours")
    op.drop_table("hours")
    op.drop_index("ix_fields_form", table_name="fields")
    op.drop_index(op.f("ix_fields_business_id"), table_name="fields")
    op.drop_table("fields")
    op.drop_index("ux_entries_ref_leg", table_name="entries")
    op.drop_index("ix_entries_subject", table_name="entries")
    op.drop_index("ix_entries_source", table_name="entries")
    op.drop_index("ix_entries_owner", table_name="entries")
    op.drop_index("ix_entries_journal", table_name="entries")
    op.drop_index(op.f("ix_entries_business_id"), table_name="entries")
    op.drop_index("ix_entries_account", table_name="entries")
    op.drop_table("entries")
    op.drop_index("ix_tokens_user", table_name="tokens")
    op.drop_table("tokens")
    op.drop_index(op.f("ix_staff_business_id"), table_name="staff")
    op.drop_table("staff")
    op.drop_index("ix_sessions_user", table_name="sessions")
    op.drop_index("ix_sessions_family", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index(op.f("ix_resources_business_id"), table_name="resources")
    op.drop_table("resources")
    op.drop_index("ix_notes_parent", table_name="notes")
    op.drop_index(op.f("ix_notes_business_id"), table_name="notes")
    op.drop_table("notes")
    op.drop_index(
        "ux_items_business_sku", table_name="items", postgresql_where=sa.text("sku IS NOT NULL")
    )
    op.drop_index("ix_items_business_kind_active", table_name="items")
    op.drop_index(op.f("ix_items_business_id"), table_name="items")
    op.drop_table("items")
    op.drop_index(op.f("ix_forms_business_id"), table_name="forms")
    op.drop_table("forms")
    op.drop_index("ix_files_parent", table_name="files")
    op.drop_index(op.f("ix_files_business_id"), table_name="files")
    op.drop_table("files")
    op.drop_index("ix_devices_token", table_name="devices")
    op.drop_index(op.f("ix_devices_business_id"), table_name="devices")
    op.drop_index("ix_devices_business", table_name="devices")
    op.drop_table("devices")
    op.drop_index(op.f("ix_contracts_business_id"), table_name="contracts")
    op.drop_table("contracts")
    op.drop_index(op.f("ix_commands_business_id"), table_name="commands")
    op.drop_table("commands")
    op.drop_index("ix_clients_business_phone", table_name="clients")
    op.drop_index(op.f("ix_clients_business_id"), table_name="clients")
    op.drop_index("ix_clients_business_email", table_name="clients")
    op.drop_table("clients")
    op.drop_index("ix_broadcasts_status", table_name="broadcasts")
    op.drop_index(op.f("ix_broadcasts_business_id"), table_name="broadcasts")
    op.drop_table("broadcasts")
    op.drop_index(op.f("ix_audits_business_id"), table_name="audits")
    op.drop_index("ix_audit_entity", table_name="audits")
    op.drop_index("ix_audit_created", table_name="audits")
    op.drop_table("audits")
    op.drop_index("ux_accounts_identity", table_name="accounts")
    op.drop_index(op.f("ix_accounts_business_id"), table_name="accounts")
    op.drop_table("accounts")
    op.drop_index("ix_webhook_provider_status", table_name="webhooks")
    op.drop_table("webhooks")
    op.drop_table("users")
    op.drop_index("ix_businesses_stripe_account", table_name="businesses")
    op.drop_table("businesses")
    op.execute("DROP FUNCTION IF EXISTS entries_append_only()")
    op.execute("DROP FUNCTION IF EXISTS entries_balanced()")
