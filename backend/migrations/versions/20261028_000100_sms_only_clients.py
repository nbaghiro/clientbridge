"""Make text the only client channel: drop client email, every channel column and link opt-outs."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0036"
down_revision: str | None = "cb0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SOURCES = "'in_person', 'form', 'online_booking', 'reply'"
_LINK_SOURCES = "'unsubscribe', 'preferences'"
_EMAIL_THREADS = "SELECT id FROM threads WHERE channel = 'email'"
_EMAIL_BROADCASTS = "SELECT id FROM broadcasts WHERE channel = 'email'"


def _add_sms_channel(table: str) -> None:
    op.add_column(table, sa.Column("channel", sa.String(), server_default="sms", nullable=False))
    op.alter_column(table, "channel", server_default=None)


def upgrade() -> None:
    # mail to a client carried a reply-to, a client or an inbox message; a business's own mail none
    op.execute(
        "DELETE FROM deliveries WHERE payload->>'channel' = 'email' AND business_id IS NOT NULL"
        " AND (payload->'message'->>'reply_to' IS NOT NULL OR payload->>'client_id' IS NOT NULL"
        " OR payload->>'message_id' IS NOT NULL)"
    )
    op.execute(
        f"DELETE FROM messages WHERE channel = 'email' OR thread_id IN ({_EMAIL_THREADS})"
        f" OR broadcast_id IN ({_EMAIL_BROADCASTS})"
    )
    op.execute("DELETE FROM broadcasts WHERE channel = 'email'")
    op.execute("DELETE FROM threads WHERE channel = 'email'")
    # dropping only a link opt-out could revive an older grant, so that client's history goes too
    op.execute(
        "DELETE FROM consents WHERE channel = 'email' OR client_id IN"
        f" (SELECT client_id FROM consents WHERE source IN ({_LINK_SOURCES}))"
    )

    op.drop_index("ix_clients_business_email", table_name="clients")
    op.drop_constraint("ck_clients_preferred_channel", "clients", type_="check")
    op.drop_column("clients", "email")
    op.drop_column("clients", "preferred_channel")

    op.drop_index("ix_consents_client", table_name="consents")
    op.drop_constraint("ck_consents_channel", "consents", type_="check")
    op.drop_column("consents", "channel")
    op.create_index("ix_consents_client", "consents", ["business_id", "client_id", "created_at"])
    op.drop_constraint("ck_consents_source", "consents", type_="check")
    op.create_check_constraint("ck_consents_source", "consents", f"source IN ({_SOURCES})")

    op.drop_constraint("uq_threads_client_channel", "threads", type_="unique")
    op.drop_constraint("ck_threads_channel", "threads", type_="check")
    op.drop_column("threads", "channel")
    op.create_unique_constraint("uq_threads_client", "threads", ["business_id", "client_id"])

    op.drop_column("messages", "channel")

    op.drop_constraint("ck_broadcasts_channel", "broadcasts", type_="check")
    op.drop_column("broadcasts", "channel")

    op.drop_constraint("ck_orders_receipt_channel", "orders", type_="check")
    op.drop_column("orders", "receipt_channel")
    op.drop_column("orders", "receipt_email")


def downgrade() -> None:
    op.add_column("orders", sa.Column("receipt_email", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("receipt_channel", sa.String(), nullable=True))
    op.execute("UPDATE orders SET receipt_channel = 'sms' WHERE receipt_sent_at IS NOT NULL")
    op.create_check_constraint(
        "ck_orders_receipt_channel",
        "orders",
        "receipt_channel IS NULL OR receipt_channel IN ('sms', 'email')",
    )

    _add_sms_channel("broadcasts")
    op.create_check_constraint("ck_broadcasts_channel", "broadcasts", "channel IN ('sms', 'email')")

    _add_sms_channel("messages")

    op.drop_constraint("uq_threads_client", "threads", type_="unique")
    _add_sms_channel("threads")
    op.create_check_constraint("ck_threads_channel", "threads", "channel IN ('sms', 'email')")
    op.create_unique_constraint(
        "uq_threads_client_channel", "threads", ["business_id", "client_id", "channel"]
    )

    op.drop_constraint("ck_consents_source", "consents", type_="check")
    op.create_check_constraint(
        "ck_consents_source", "consents", f"source IN ({_SOURCES}, {_LINK_SOURCES}, 'complaint')"
    )
    op.drop_index("ix_consents_client", table_name="consents")
    _add_sms_channel("consents")
    op.create_check_constraint("ck_consents_channel", "consents", "channel IN ('sms', 'email')")
    op.create_index(
        "ix_consents_client", "consents", ["business_id", "client_id", "channel", "created_at"]
    )

    op.add_column("clients", sa.Column("email", sa.String(), nullable=True))
    op.add_column(
        "clients",
        sa.Column("preferred_channel", sa.String(), server_default="sms", nullable=False),
    )
    op.create_check_constraint(
        "ck_clients_preferred_channel", "clients", "preferred_channel IN ('sms', 'email')"
    )
    op.create_index("ix_clients_business_email", "clients", ["business_id", "email"])
