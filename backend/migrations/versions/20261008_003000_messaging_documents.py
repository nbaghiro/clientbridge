"""Messaging and documents: review hold, broadcast counts, consent source, form and signature details.

Revision ID: c4e8a1d3f572
Revises: b7d2f4a96c13
Create Date: 2026-10-08 00:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4e8a1d3f572"
down_revision: str | None = "b7d2f4a96c13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SOURCES = "'in_person', 'form', 'online_booking', 'reply', 'unsubscribe', 'import'"


def upgrade() -> None:
    op.add_column(
        "businesses",
        sa.Column("review_hold_at", sa.SmallInteger(), server_default="3", nullable=False),
    )
    op.create_check_constraint(
        "ck_businesses_review_hold_at", "businesses", "review_hold_at BETWEEN 0 AND 5"
    )
    op.add_column("businesses", sa.Column("google_review_url", sa.String(), nullable=True))
    op.add_column(
        "broadcasts",
        sa.Column("recipient_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "broadcasts",
        sa.Column("excluded_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.drop_constraint("ck_consents_source", "consents", type_="check")
    op.create_check_constraint(
        "ck_consents_source", "consents", f"source IN ({_SOURCES}, 'preferences')"
    )
    op.add_column(
        "forms", sa.Column("send_on", sa.String(), server_default="manual", nullable=False)
    )
    op.create_check_constraint("ck_forms_send_on", "forms", "send_on IN ('booking', 'manual')")
    op.add_column("responses", sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("signatures", sa.Column("contract_version", sa.Integer(), nullable=True))
    op.add_column("signatures", sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("signatures", sa.Column("method", sa.String(), nullable=True))
    op.create_check_constraint("ck_signatures_method", "signatures", "method IN ('typed', 'drawn')")
    op.add_column("signatures", sa.Column("signer_name", sa.String(), nullable=True))
    op.add_column(
        "signatures",
        sa.Column("strokes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("signatures", "strokes")
    op.drop_column("signatures", "signer_name")
    op.drop_constraint("ck_signatures_method", "signatures", type_="check")
    op.drop_column("signatures", "method")
    op.drop_column("signatures", "opened_at")
    op.drop_column("signatures", "contract_version")
    op.drop_column("responses", "opened_at")
    op.drop_constraint("ck_forms_send_on", "forms", type_="check")
    op.drop_column("forms", "send_on")
    op.execute("UPDATE consents SET source = 'form' WHERE source = 'preferences'")
    op.drop_constraint("ck_consents_source", "consents", type_="check")
    op.create_check_constraint("ck_consents_source", "consents", f"source IN ({_SOURCES})")
    op.drop_column("broadcasts", "excluded_count")
    op.drop_column("broadcasts", "recipient_count")
    op.drop_column("businesses", "google_review_url")
    op.drop_constraint("ck_businesses_review_hold_at", "businesses", type_="check")
    op.drop_column("businesses", "review_hold_at")
