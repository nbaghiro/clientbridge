"""Move staff-written visit records out of responses into visit_records, which never replicates."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0036"
down_revision: str | None = "cb0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    stray = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM responses WHERE token IS NULL"
            " AND (parent_type IS DISTINCT FROM 'booking' OR parent_id IS NULL"
            " OR parent_id NOT IN (SELECT id FROM bookings) OR signature IS NULL)"
        )
    )
    if stray:
        raise RuntimeError(
            f"{stray} responses have no token and are not a signed record on a booking"
        )
    op.create_table(
        "visit_records",
        sa.Column("form_id", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=True),
        sa.Column("booking_id", sa.String(), nullable=False),
        sa.Column("definition", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "answers",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("signature", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("business_id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["form_id"], ["forms.id"]),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_visit_records_business_id"), "visit_records", ["business_id"])
    op.create_index("ix_visit_records_booking", "visit_records", ["business_id", "booking_id"])
    op.create_index("ix_visit_records_client", "visit_records", ["client_id"])
    op.create_index("ix_visit_records_form", "visit_records", ["form_id"])
    op.execute(
        "INSERT INTO visit_records (id, business_id, form_id, client_id, booking_id, definition,"
        " answers, signature, created_at, updated_at)"
        " SELECT id, business_id, form_id, client_id, parent_id, definition, answers,"
        " signature, created_at, updated_at"
        " FROM responses WHERE token IS NULL"
    )
    op.execute("DELETE FROM responses WHERE token IS NULL")
    op.alter_column("responses", "token", existing_type=sa.String(), nullable=False)


def downgrade() -> None:
    op.alter_column("responses", "token", existing_type=sa.String(), nullable=True)
    op.execute(
        "INSERT INTO responses (id, business_id, form_id, client_id, parent_type, parent_id,"
        " token, status, submitted_at, definition, answers, signature, created_at, updated_at)"
        " SELECT id, business_id, form_id, client_id, 'booking', booking_id, NULL, 'submitted',"
        " created_at, definition, answers, signature, created_at, updated_at FROM visit_records"
    )
    op.drop_index("ix_visit_records_form", table_name="visit_records")
    op.drop_index("ix_visit_records_client", table_name="visit_records")
    op.drop_index("ix_visit_records_booking", table_name="visit_records")
    op.drop_index(op.f("ix_visit_records_business_id"), table_name="visit_records")
    op.drop_table("visit_records")
