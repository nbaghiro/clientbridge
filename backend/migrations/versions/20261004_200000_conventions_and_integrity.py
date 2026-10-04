"""naming conventions, integer staff rates, and missing integrity constraints

Revision ID: 7a1e4c9d2b58
Revises: 5d2f8a1c6e93
Create Date: 2026-10-04 20:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7a1e4c9d2b58"
down_revision: str | None = "5d2f8a1c6e93"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UNUSED = [
    ("items", "pack", sa.String()),
    ("contracts", "expires", sa.String()),
    ("subscriptions", "trial_end_at", sa.DateTime(timezone=True)),
    ("users", "avatar_url", sa.String()),
    ("form_fields", "default", sa.String()),
]

_RENAMES = [
    ("staff", "is_payee", "payee"),
    ("payment_methods", "is_default", "preferred"),
    ("availability", "is_available", "available"),
    ("businesses", "is_tax_registered", "tax_registered"),
    ("notes", "author_user_id", "created_by"),
    ("messages", "sender_user_id", "sent_by"),
    ("audit_logs", "actor_user_id", "performed_by"),
]

_FREQUENCIES = [("daily", "day"), ("weekly", "week"), ("monthly", "month")]

_DOCUMENT_PARENTS = "('client', 'subject', 'booking')"

_CHECKS = [
    ("ck_staff_role", "staff", "role IN ('owner', 'admin', 'staff', 'contractor')"),
    ("ck_staff_status", "staff", "status IN ('active', 'invited')"),
    ("ck_staff_rate_type", "staff", "rate_type IN ('percent', 'fixed', 'hourly')"),
    (
        "ck_staff_rate_unit",
        "staff",
        "(rate_type = 'percent' AND rate_cents IS NULL)"
        " OR (rate_type IN ('fixed', 'hourly') AND rate_bps IS NULL)"
        " OR (rate_type IS NULL AND rate_bps IS NULL AND rate_cents IS NULL)",
    ),
    ("ck_clients_status", "clients", "status IN ('active', 'inactive')"),
    ("ck_businesses_status", "businesses", "status IN ('active', 'closed')"),
    (
        "ck_files_parent_type",
        "files",
        "parent_type IN ('business', 'client', 'subject', 'item', 'signature', 'form_response')",
    ),
    ("ck_files_kind", "files", "kind IN ('logo', 'image', 'photo', 'signature', 'attachment')"),
    ("ck_notes_parent_type", "notes", f"parent_type IN {_DOCUMENT_PARENTS}"),
    ("ck_form_responses_parent_type", "form_responses", f"parent_type IN {_DOCUMENT_PARENTS}"),
    ("ck_signatures_parent_type", "signatures", f"parent_type IN {_DOCUMENT_PARENTS}"),
    ("ck_items_frequency", "items", "frequency IN ('day', 'week', 'month', 'year')"),
    (
        "ck_payments_target",
        "payments",
        "(kind = 'refund') = (parent_payment_id IS NOT NULL)"
        " AND num_nonnulls(invoice_id, order_id) <= 1"
        " AND (order_id IS NULL OR booking_id IS NULL)",
    ),
]


def upgrade() -> None:
    for table, column, _ in _UNUSED:
        op.drop_column(table, column)
    op.drop_column("review_requests", "reminder_count")
    op.drop_column("notes", "pinned")
    for table, old, new in _RENAMES:
        op.alter_column(table, old, new_column_name=new)

    op.drop_constraint("ck_payments_method", "payments", type_="check")
    op.execute("UPDATE payments SET method = 'bank_eft' WHERE method = 'eft'")
    op.create_check_constraint(
        "ck_payments_method",
        "payments",
        "method IN ('card', 'interac', 'bank_eft', 'cash', 'other')",
    )
    op.drop_constraint("ck_schedules_frequency", "schedules", type_="check")
    for old, new in _FREQUENCIES:
        op.execute(f"UPDATE schedules SET frequency = '{new}' WHERE frequency = '{old}'")
    op.create_check_constraint(
        "ck_schedules_frequency", "schedules", "frequency IN ('day', 'week', 'month')"
    )

    op.add_column("staff", sa.Column("rate_bps", sa.Integer(), nullable=True))
    op.add_column("staff", sa.Column("rate_cents", sa.BigInteger(), nullable=True))
    op.execute(
        "UPDATE staff SET rate_bps = round(default_rate * 100)"
        " WHERE rate_type = 'percent' AND default_rate IS NOT NULL"
    )
    op.execute(
        "UPDATE staff SET rate_cents = round(default_rate * 100)"
        " WHERE rate_type IN ('fixed', 'hourly') AND default_rate IS NOT NULL"
    )
    op.execute("UPDATE staff SET rate_type = NULL WHERE rate_bps IS NULL AND rate_cents IS NULL")
    op.drop_column("staff", "default_rate")
    op.create_unique_constraint("uq_staff_business_user", "staff", ["business_id", "user_id"])

    for name, table, condition in _CHECKS:
        op.create_check_constraint(name, table, condition)


def downgrade() -> None:
    for name, table, _ in reversed(_CHECKS):
        op.drop_constraint(name, table, type_="check")
    op.drop_constraint("uq_staff_business_user", "staff", type_="unique")

    op.add_column("staff", sa.Column("default_rate", sa.Float(), nullable=True))
    op.execute("UPDATE staff SET default_rate = coalesce(rate_bps, rate_cents) / 100.0")
    op.drop_column("staff", "rate_cents")
    op.drop_column("staff", "rate_bps")

    op.drop_constraint("ck_schedules_frequency", "schedules", type_="check")
    for old, new in _FREQUENCIES:
        op.execute(f"UPDATE schedules SET frequency = '{old}' WHERE frequency = '{new}'")
    op.create_check_constraint(
        "ck_schedules_frequency", "schedules", "frequency IN ('daily', 'weekly', 'monthly')"
    )
    op.drop_constraint("ck_payments_method", "payments", type_="check")
    op.execute("UPDATE payments SET method = 'eft' WHERE method = 'bank_eft'")
    op.create_check_constraint(
        "ck_payments_method", "payments", "method IN ('card', 'interac', 'eft', 'cash', 'other')"
    )

    for table, old, new in reversed(_RENAMES):
        op.alter_column(table, new, new_column_name=old)
    op.add_column(
        "notes", sa.Column("pinned", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "review_requests",
        sa.Column("reminder_count", sa.Integer(), server_default="0", nullable=False),
    )
    for table, column, column_type in reversed(_UNUSED):
        op.add_column(table, sa.Column(column, column_type, nullable=True))
