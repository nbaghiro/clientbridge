"""derive counts, balances and settled statuses at read time instead of storing them

Revision ID: 9c3b7e2f5a14
Revises: 7a1e4c9d2b58
Create Date: 2026-10-04 21:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9c3b7e2f5a14"
down_revision: str | None = "7a1e4c9d2b58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TS = sa.DateTime(timezone=True)


def _recheck(table: str, column: str, values: str) -> None:
    op.drop_constraint(f"ck_{table}_{column}", table, type_="check")
    op.create_check_constraint(f"ck_{table}_{column}", table, f"{column} IN ({values})")


def upgrade() -> None:
    op.add_column("invoices", sa.Column("overdue_notified_at", _TS, nullable=True))
    op.execute("UPDATE invoices SET overdue_notified_at = updated_at WHERE status = 'overdue'")
    op.drop_constraint("ck_invoices_status", "invoices", type_="check")
    op.execute(
        "UPDATE invoices SET status = 'sent' WHERE status IN ('partial', 'paid', 'refunded', 'overdue')"
    )
    op.create_check_constraint(
        "ck_invoices_status", "invoices", "status IN ('draft', 'sent', 'void')"
    )
    op.drop_column("invoices", "paid_at")

    op.drop_constraint("ck_orders_status", "orders", type_="check")
    op.execute("UPDATE orders SET status = 'open' WHERE status IN ('paid', 'refunded')")
    op.create_check_constraint("ck_orders_status", "orders", "status IN ('open', 'void')")
    op.drop_column("orders", "paid_at")

    op.drop_constraint("ck_estimates_status", "estimates", type_="check")
    op.execute("UPDATE estimates SET status = 'sent' WHERE status = 'expired'")
    op.create_check_constraint(
        "ck_estimates_status", "estimates", "status IN ('draft', 'sent', 'accepted', 'declined')"
    )

    op.drop_constraint("ck_gift_cards_status", "gift_cards", type_="check")
    op.execute("UPDATE gift_cards SET status = 'active' WHERE status = 'redeemed'")
    op.create_check_constraint(
        "ck_gift_cards_status", "gift_cards", "status IN ('active', 'expired', 'void', 'pending')"
    )

    # keep each thread's unread count: its newest `unread_count` inbound messages stay unread
    op.execute(
        """
        UPDATE messages m SET status = 'read'
        WHERE m.direction = 'in' AND m.status <> 'read'
          AND (SELECT count(*) FROM messages n
               WHERE n.thread_id = m.thread_id AND n.direction = 'in' AND n.status <> 'read'
                 AND (n.created_at, n.id) > (m.created_at, m.id))
              >= (SELECT t.unread_count FROM threads t WHERE t.id = m.thread_id)
        """
    )
    op.drop_index("ix_threads_last_message", table_name="threads")
    op.drop_column("threads", "last_message_at")
    op.drop_column("threads", "unread_count")

    op.drop_column("packages", "sessions_used")
    op.drop_column("sessions", "booked_count")
    op.drop_column("bookings", "deposit_required")
    op.drop_column("businesses", "kyc_status")


def downgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column("kyc_status", sa.String(), server_default="not_started", nullable=False),
    )
    op.add_column(
        "bookings",
        sa.Column("deposit_required", sa.Boolean(), server_default="false", nullable=False),
    )
    op.execute("UPDATE bookings SET deposit_required = deposit_amount_cents > 0")
    op.add_column(
        "sessions", sa.Column("booked_count", sa.Integer(), server_default="0", nullable=False)
    )
    op.execute(
        "UPDATE sessions s SET booked_count = (SELECT count(*) FROM bookings b"
        " WHERE b.session_id = s.id AND b.status <> 'canceled' AND b.deleted_at IS NULL)"
    )
    op.add_column(
        "packages", sa.Column("sessions_used", sa.Integer(), server_default="0", nullable=False)
    )
    op.execute(
        "UPDATE packages p SET sessions_used = (SELECT count(DISTINCT e.journal_id) FROM entries e"
        " WHERE e.type = 'consumption' AND e.subject_type = 'package' AND e.subject_id = p.id)"
    )
    op.add_column(
        "threads", sa.Column("unread_count", sa.Integer(), server_default="0", nullable=False)
    )
    op.add_column("threads", sa.Column("last_message_at", _TS, nullable=True))
    op.execute(
        "UPDATE threads t SET"
        " unread_count = (SELECT count(*) FROM messages m"
        " WHERE m.thread_id = t.id AND m.direction = 'in' AND m.status <> 'read'),"
        " last_message_at = (SELECT max(m.created_at) FROM messages m WHERE m.thread_id = t.id)"
    )
    op.create_index("ix_threads_last_message", "threads", ["business_id", "last_message_at"])

    _recheck("gift_cards", "status", "'active', 'redeemed', 'expired', 'void', 'pending'")
    _recheck("estimates", "status", "'draft', 'sent', 'accepted', 'declined', 'expired'")
    op.add_column("orders", sa.Column("paid_at", _TS, nullable=True))
    _recheck("orders", "status", "'open', 'paid', 'void', 'refunded'")
    op.add_column("invoices", sa.Column("paid_at", _TS, nullable=True))
    _recheck(
        "invoices",
        "status",
        "'draft', 'sent', 'partial', 'paid', 'overdue', 'void', 'refunded'",
    )
    op.execute("UPDATE invoices SET status = 'overdue' WHERE overdue_notified_at IS NOT NULL")
    op.drop_column("invoices", "overdue_notified_at")
