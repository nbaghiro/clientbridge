"""Admit resend webhook events and complaint consent rows, drop sendgrid, index provider_ref."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0006"
down_revision: str | None = "cb0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PROVIDERS = "provider IN ('stripe', 'twilio', 'resend')"
_PREVIOUS_PROVIDERS = "provider IN ('stripe', 'twilio', 'sendgrid')"
_SOURCES = (
    "source IN ('in_person', 'form', 'online_booking', 'reply', 'unsubscribe', 'import', "
    "'preferences', 'complaint')"
)
_PREVIOUS_SOURCES = (
    "source IN ('in_person', 'form', 'online_booking', 'reply', 'unsubscribe', 'import', "
    "'preferences')"
)


def _refuse_if_rows(table: str, condition: str) -> None:
    count = op.get_bind().execute(sa.text(f"SELECT count(*) FROM {table} WHERE {condition}"))
    if count.scalar_one():
        raise RuntimeError(
            f"{table} rows where {condition} exist; refusing to narrow the vocabulary"
        )


def upgrade() -> None:
    _refuse_if_rows("webhooks", "provider = 'sendgrid'")
    op.drop_constraint("ck_webhooks_provider", "webhooks", type_="check")
    op.create_check_constraint("ck_webhooks_provider", "webhooks", _PROVIDERS)
    op.drop_constraint("ck_consents_source", "consents", type_="check")
    op.create_check_constraint("ck_consents_source", "consents", _SOURCES)
    op.create_index(
        "ix_messages_provider_ref",
        "messages",
        ["provider_ref"],
        unique=False,
        postgresql_where=sa.text("provider_ref IS NOT NULL"),
    )


def downgrade() -> None:
    _refuse_if_rows("consents", "source = 'complaint'")
    _refuse_if_rows("webhooks", "provider = 'resend'")
    op.drop_index("ix_messages_provider_ref", table_name="messages")
    op.drop_constraint("ck_consents_source", "consents", type_="check")
    op.create_check_constraint("ck_consents_source", "consents", _PREVIOUS_SOURCES)
    op.drop_constraint("ck_webhooks_provider", "webhooks", type_="check")
    op.create_check_constraint("ck_webhooks_provider", "webhooks", _PREVIOUS_PROVIDERS)
