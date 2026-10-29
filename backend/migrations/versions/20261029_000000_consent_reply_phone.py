"""Record the number a STOP or START reply came from, so it holds for every client on it."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0037"
down_revision: str | None = "cb0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# a past reply came from its client's phone, written as E.164 the way core/phones.e164 reads it
_BACKFILL = """
WITH numbers AS (
    SELECT id, CASE
        WHEN btrim(phone) LIKE '+%' THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
        WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
            THEN '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
        ELSE '+' || regexp_replace(phone, '[^0-9]', '', 'g')
    END AS number
    FROM clients WHERE phone IS NOT NULL
)
UPDATE consents SET phone = numbers.number
FROM numbers
WHERE numbers.id = consents.client_id AND consents.source = 'reply'
  AND numbers.number ~ '^\\+([2-9][0-9]{7,14}|1[2-9][0-9]{9})$'
"""


def upgrade() -> None:
    op.add_column("consents", sa.Column("phone", sa.String(length=16), nullable=True))
    op.execute(_BACKFILL)


def downgrade() -> None:
    op.drop_column("consents", "phone")
