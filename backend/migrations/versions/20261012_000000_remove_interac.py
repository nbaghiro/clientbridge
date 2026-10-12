"""Remove Interac e-Transfer requests and matching; a received e-Transfer is a manual etransfer."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0004"
down_revision: str | None = "cb0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _check(table: str, name: str, condition: str) -> None:
    op.drop_constraint(name, table, type_="check")
    op.create_check_constraint(name, table, condition)


def upgrade() -> None:
    op.execute(
        "DELETE FROM payments WHERE provider = 'interac' AND status NOT IN ('succeeded', 'refunded')"
    )
    op.execute(
        "UPDATE payments SET reference = COALESCE(reference, reference_code) "
        "WHERE reference_code IS NOT NULL"
    )
    op.drop_constraint("ck_payments_method", "payments", type_="check")
    op.drop_constraint("ck_payments_provider", "payments", type_="check")
    op.execute(
        "UPDATE payments SET method = 'etransfer', provider = 'manual' "
        "WHERE method = 'interac' OR provider = 'interac'"
    )
    op.create_check_constraint(
        "ck_payments_method",
        "payments",
        "method IN ('card', 'etransfer', 'bank_eft', 'cash', 'cheque', 'other')",
    )
    op.create_check_constraint(
        "ck_payments_provider", "payments", "provider IN ('stripe', 'manual')"
    )
    op.execute(
        "UPDATE subscriptions SET payment_method_id = NULL WHERE payment_method_id IN "
        "(SELECT id FROM payment_methods WHERE method = 'interac')"
    )
    op.execute("DELETE FROM payment_methods WHERE method = 'interac'")
    _check("payment_methods", "ck_payment_methods_method", "method IN ('card', 'bank_eft')")
    op.execute("DELETE FROM webhooks WHERE provider = 'interac'")
    _check("webhooks", "ck_webhooks_provider", "provider IN ('stripe', 'twilio', 'sendgrid')")
    op.drop_constraint("ck_payments_channel", "payments", type_="check")
    op.drop_index("ix_payments_reference_code", table_name="payments")
    op.drop_column("payments", "reference_code")
    op.drop_column("payments", "channel")
    op.drop_column("payments", "expires_at")


def downgrade() -> None:
    op.add_column("payments", sa.Column("reference_code", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("channel", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_payments_reference_code", "payments", ["reference_code"], unique=True)
    op.create_check_constraint(
        "ck_payments_channel", "payments", "channel IS NULL OR channel IN ('sms', 'email')"
    )
    _check(
        "webhooks",
        "ck_webhooks_provider",
        "provider IN ('stripe', 'interac', 'twilio', 'sendgrid')",
    )
    _check(
        "payment_methods", "ck_payment_methods_method", "method IN ('card', 'bank_eft', 'interac')"
    )
    _check("payments", "ck_payments_provider", "provider IN ('stripe', 'interac', 'manual')")
    op.drop_constraint("ck_payments_method", "payments", type_="check")
    op.execute("UPDATE payments SET method = 'interac' WHERE method = 'etransfer'")
    op.create_check_constraint(
        "ck_payments_method",
        "payments",
        "method IN ('card', 'interac', 'bank_eft', 'cash', 'cheque', 'other')",
    )
