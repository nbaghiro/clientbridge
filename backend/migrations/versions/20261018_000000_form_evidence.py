"""Preserve issued form definitions and submitted signature evidence."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb0009"
down_revision: str | None = "cb0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("responses", sa.Column("definition", postgresql.JSONB(), nullable=True))
    op.add_column("responses", sa.Column("signature", postgresql.JSONB(), nullable=True))
    op.execute("""
        UPDATE responses r SET definition = jsonb_build_object(
            'provenance', 'reconstructed', 'name', f.name,
            'require_signature', f.require_signature,
            'fields', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', q.id, 'input', q.input, 'name', q.name, 'label', q.label,
                    'help', q.help, 'required', q.required, 'options', q.options,
                    'validation', q.validation, 'position', q.position
                ) ORDER BY q.position, q.id)
                FROM fields q WHERE q.form_id = f.id AND q.business_id = r.business_id
            ), '[]'::jsonb)
        ) FROM forms f WHERE f.id = r.form_id AND f.business_id = r.business_id
    """)
    op.alter_column("responses", "definition", nullable=False)


def downgrade() -> None:
    raise RuntimeError("form evidence must be retained; use a forward migration")
