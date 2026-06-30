"""form_responses + signatures public tokens

Revision ID: d5b1e7a3c9f2
Revises: a7e2c9f1d3b5
Create Date: 2026-06-29 18:00:00

"""

import sqlalchemy as sa
from alembic import op

revision = "d5b1e7a3c9f2"
down_revision = "a7e2c9f1d3b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("form_responses", sa.Column("token", sa.String(), nullable=True))
    op.create_unique_constraint("uq_form_responses_token", "form_responses", ["token"])
    op.add_column("signatures", sa.Column("token", sa.String(), nullable=True))
    op.create_unique_constraint("uq_signatures_token", "signatures", ["token"])


def downgrade() -> None:
    op.drop_constraint("uq_signatures_token", "signatures", type_="unique")
    op.drop_column("signatures", "token")
    op.drop_constraint("uq_form_responses_token", "form_responses", type_="unique")
    op.drop_column("form_responses", "token")
