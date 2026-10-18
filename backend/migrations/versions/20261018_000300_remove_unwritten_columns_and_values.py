"""Drop columns nothing writes and narrow vocabularies to the values the code produces."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0012"
down_revision: str | None = "cb0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EVENTS = (
    "'invoice', 'sale', 'payment', 'fee', 'refund', 'dispute', 'payout', 'redemption', "
    "'consumption', 'forfeit', 'application', 'breakage', 'remittance', 'earning', 'approval', "
    "'staff_payment', 'reversal', 'tip'"
)
_SOURCES = (
    "'in_person', 'form', 'online_booking', 'reply', 'unsubscribe', 'preferences', 'complaint'"
)
_PARENTS = "'business', 'subject', 'item', 'signature', 'form_response'"
_CHECKS = (
    ("ck_entries_event", "entries", "event", _EVENTS, "event IN ('adjustment')"),
    ("ck_consents_source", "consents", "source", _SOURCES, "source IN ('import')"),
    ("ck_files_parent_type", "files", "parent_type", _PARENTS, "parent_type IN ('client')"),
    ("ck_threads_channel", "threads", "channel", "'sms', 'email'", "channel IN ('chat')"),
    ("ck_threads_status", "threads", "status", "'open'", "status IN ('closed')"),
)
_PREVIOUS = {
    "ck_entries_event": _EVENTS.replace("'staff_payment', ", "'staff_payment', 'adjustment', "),
    "ck_consents_source": _SOURCES.replace("'unsubscribe', ", "'unsubscribe', 'import', "),
    "ck_files_parent_type": _PARENTS.replace("'business', ", "'business', 'client', "),
    "ck_threads_channel": "'sms', 'email', 'chat'",
    "ck_threads_status": "'open', 'closed'",
}
_COLUMNS = (("fields", "validation"), ("bookings", "custom_fields"), ("items", "custom_fields"))


def _refuse_if_rows(table: str, condition: str) -> None:
    count = op.get_bind().execute(sa.text(f"SELECT count(*) FROM {table} WHERE {condition}"))
    if count.scalar_one():
        raise RuntimeError(
            f"{table} rows where {condition} exist; refusing to narrow the vocabulary"
        )


def upgrade() -> None:
    for name, table, column, allowed, removed in _CHECKS:
        _refuse_if_rows(table, removed)
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, f"{column} IN ({allowed})")
    for table, column in _COLUMNS:
        op.drop_column(table, column)


def downgrade() -> None:
    for table, column in _COLUMNS:
        op.add_column(
            table,
            sa.Column(
                column,
                postgresql.JSONB(astext_type=sa.Text()),
                server_default=sa.text("'{}'::jsonb"),
                nullable=False,
            ),
        )
        op.alter_column(table, column, server_default=None)
    for name, table, column, _allowed, _removed in _CHECKS:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, f"{column} IN ({_PREVIOUS[name]})")
