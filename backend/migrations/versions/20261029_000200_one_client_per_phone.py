"""Give each phone number to one live client per business, kept by the oldest client on it."""

import logging
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cb0039"
down_revision: str | None = "cb0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_log = logging.getLogger("alembic.runtime.migration")

_CLEAR_SHARED = """
WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY business_id, phone ORDER BY created_at, id
    ) AS place
    FROM clients
    WHERE phone IS NOT NULL AND deleted_at IS NULL
)
UPDATE clients SET phone = NULL
FROM ranked
WHERE ranked.id = clients.id AND ranked.place > 1
RETURNING clients.id
"""


def upgrade() -> None:
    cleared = op.get_bind().execute(sa.text(_CLEAR_SHARED)).scalars().all()
    for client_id in sorted(cleared):
        _log.info("cleared the phone of %s, which another client on it already holds", client_id)
    op.create_index(
        "uq_clients_business_phone",
        "clients",
        ["business_id", "phone"],
        unique=True,
        postgresql_where=sa.text("phone IS NOT NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_clients_business_phone", table_name="clients")
