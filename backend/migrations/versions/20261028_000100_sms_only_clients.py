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
# a business's own mail goes to its billing email, its staff's sign-ins or their invites
_CLIENT_MAIL = (
    "d.payload->>'channel' = 'email' AND d.business_id IS NOT NULL"
    " AND lower(d.payload->'message'->>'to') NOT IN ("
    "SELECT lower(b.billing_email) FROM businesses b"
    " WHERE b.id = d.business_id AND b.billing_email IS NOT NULL"
    " UNION SELECT lower(u.email) FROM staff s JOIN users u ON u.id = s.user_id"
    " WHERE s.business_id = d.business_id"
    " UNION SELECT lower(s.invite_email) FROM staff s"
    " WHERE s.business_id = d.business_id AND s.invite_email IS NOT NULL)"
)


def _add_sms_channel(table: str) -> None:
    op.add_column(table, sa.Column("channel", sa.String(), server_default="sms", nullable=False))
    op.alter_column(table, "channel", server_default=None)


def upgrade() -> None:
    op.execute(f"DELETE FROM deliveries d WHERE {_CLIENT_MAIL}")
    op.execute(
        f"DELETE FROM messages WHERE channel = 'email' OR thread_id IN ({_EMAIL_THREADS})"
        f" OR broadcast_id IN ({_EMAIL_BROADCASTS})"
    )
    op.execute("DELETE FROM broadcasts WHERE channel = 'email'")
    op.execute("DELETE FROM threads WHERE channel = 'email'")
    # dropping only a link opt-out could revive an older grant, so the rest goes; a STOP reply stays
    op.execute(
        "DELETE FROM consents WHERE channel = 'email' OR (source <> 'reply' AND client_id IN"
        f" (SELECT client_id FROM consents WHERE source IN ({_LINK_SOURCES})))"
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

    op.execute("UPDATE orders SET receipt_sent_at = NULL WHERE receipt_channel = 'email'")
    op.drop_constraint("ck_orders_receipt_channel", "orders", type_="check")
    op.drop_column("orders", "receipt_channel")
    op.drop_column("orders", "receipt_email")


def downgrade() -> None:
    op.add_column("orders", sa.Column("receipt_email", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("receipt_channel", sa.String(), nullable=True))
    op.execute(
        "UPDATE orders SET receipt_channel = 'sms'"
        " WHERE receipt_sent_at IS NOT NULL AND receipt_phone IS NOT NULL"
    )
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
