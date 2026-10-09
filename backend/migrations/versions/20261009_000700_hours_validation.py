"""Validate hours at the database boundary without rewriting existing schedules."""

from collections.abc import Sequence

from alembic import op

revision: str = "cbsync01"
down_revision: str | None = "cbpayments02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINTS = {
    "ck_hours_recurring_day": "basis != 'recurring' OR (weekday IS NOT NULL AND weekday BETWEEN 0 AND 6 AND date IS NULL)",
    "ck_hours_explicit_date": "basis != 'date' OR (date IS NOT NULL AND weekday IS NULL)",
    "ck_hours_local_window": "(start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)",
    "ck_hours_exception_fields": "basis = 'exception' OR (starts_at IS NULL AND ends_at IS NULL AND reason IS NULL)",
}


def upgrade() -> None:
    for name, condition in CONSTRAINTS.items():
        op.create_check_constraint(name, "hours", condition)


def downgrade() -> None:
    for name in reversed(CONSTRAINTS):
        op.drop_constraint(name, "hours", type_="check")
