"""Recorded invoice payments (cheque, reference, cash handed over) and client answers on estimates.

Revision ID: c4f2d6b8e013
Revises: b3e1c5a7d902
Create Date: 2026-10-08 00:02:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4f2d6b8e013"
down_revision: str | None = "b3e1c5a7d902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_payments_method", "payments", type_="check")
    op.create_check_constraint(
        "ck_payments_method",
        "payments",
        "method IN ('card', 'interac', 'bank_eft', 'cash', 'cheque', 'other')",
    )
    op.add_column("payments", sa.Column("reference", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("note", sa.String(), nullable=True))
    op.add_column("payments", sa.Column("tendered_cents", sa.BigInteger(), nullable=True))
    op.add_column("estimates", sa.Column("decline_reason", sa.String(), nullable=True))
    op.add_column("estimates", sa.Column("view_token", sa.String(), nullable=True))
    op.create_unique_constraint("estimates_view_token_key", "estimates", ["view_token"])
    op.add_column(
        "lines",
        sa.Column("optional", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "lines",
        sa.Column("selected", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("lines", "selected")
    op.drop_column("lines", "optional")
    op.drop_constraint("estimates_view_token_key", "estimates", type_="unique")
    op.drop_column("estimates", "view_token")
    op.drop_column("estimates", "decline_reason")
    op.drop_column("payments", "tendered_cents")
    op.drop_column("payments", "note")
    op.drop_column("payments", "reference")
    op.execute("UPDATE payments SET method = 'other' WHERE method = 'cheque'")
    op.drop_constraint("ck_payments_method", "payments", type_="check")
    op.create_check_constraint(
        "ck_payments_method",
        "payments",
        "method IN ('card', 'interac', 'bank_eft', 'cash', 'other')",
    )
