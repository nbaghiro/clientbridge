"""rename tables to their final short names, and discriminator columns to meaningful ones

Revision ID: 6c4a9e2d8b13
Revises: 3e8b1d6f4a27
Create Date: 2026-10-04 23:00:00

"""

import re
from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "6c4a9e2d8b13"
down_revision: str | None = "3e8b1d6f4a27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# sessions becomes slots before auth_sessions can take its name
_TABLES = [
    ("sessions", "slots"),
    ("auth_sessions", "sessions"),
    ("auth_tokens", "tokens"),
    ("device_tokens", "devices"),
    ("stock_movements", "inventory"),
    ("availability", "hours"),
    ("schedules", "recurrences"),
    ("booking_addons", "addons"),
    ("form_fields", "fields"),
    ("form_responses", "responses"),
    ("audit_logs", "audits"),
    ("webhook_events", "webhooks"),
    ("idempotency_keys", "commands"),
]

# (table after the rename, old column, new column)
_COLUMNS = [
    ("bookings", "session_id", "slot_id"),
    ("hours", "type", "basis"),
    ("fields", "type", "input"),
    ("payment_methods", "type", "method"),
    ("webhooks", "type", "event"),
    ("entries", "type", "event"),
    ("resources", "kind", "category"),
    ("accounts", "kind", "category"),
    ("files", "kind", "purpose"),
]

_EXTRA_INDEXES = [("ix_bookings_session", "ix_bookings_slot")]


def _rename_names(table: str, old: str, new: str) -> None:
    """Rename every constraint and index on `table` whose name carries the `old` token."""
    bind = op.get_bind()
    pattern = re.compile(rf"(^|_){re.escape(old)}(_|$)")
    constraints = bind.execute(
        text("SELECT conname FROM pg_constraint WHERE conrelid = CAST(:t AS regclass)"),
        {"t": table},
    ).scalars()
    for name in list(constraints):
        renamed = pattern.sub(rf"\g<1>{new}\g<2>", name, count=1)
        if renamed != name:
            op.execute(f'ALTER TABLE "{table}" RENAME CONSTRAINT "{name}" TO "{renamed}"')
    indexes = bind.execute(
        text(
            "SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid"
            " WHERE i.indrelid = CAST(:t AS regclass)"
            " AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)"
        ),
        {"t": table},
    ).scalars()
    for name in list(indexes):
        renamed = pattern.sub(rf"\g<1>{new}\g<2>", name, count=1)
        if renamed != name:
            op.execute(f'ALTER INDEX "{name}" RENAME TO "{renamed}"')


def _tables(pairs: list[tuple[str, str]]) -> None:
    for old, new in pairs:
        op.rename_table(old, new)
        _rename_names(new, old, new)


def _columns(triples: list[tuple[str, str, str]]) -> None:
    for table, old, new in triples:
        op.alter_column(table, old, new_column_name=new)
        _rename_names(table, old, new)


def upgrade() -> None:
    _tables(_TABLES)
    _columns(_COLUMNS)
    for old, new in _EXTRA_INDEXES:
        op.execute(f'ALTER INDEX "{old}" RENAME TO "{new}"')


def downgrade() -> None:
    for old, new in _EXTRA_INDEXES:
        op.execute(f'ALTER INDEX "{new}" RENAME TO "{old}"')
    _columns([(table, new, old) for table, old, new in reversed(_COLUMNS)])
    _tables([(new, old) for old, new in reversed(_TABLES)])
