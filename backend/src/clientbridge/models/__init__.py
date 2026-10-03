"""Import every domain module so Alembic's autogenerate sees all tables."""

from clientbridge.models import (
    auth,
    billing,
    catalog,
    crm,
    documents,
    identity,
    ledger,
    messaging,
    payments,
    platform,
    reviews,
    scheduling,
)

__all__ = [
    "auth",
    "billing",
    "catalog",
    "crm",
    "documents",
    "identity",
    "ledger",
    "messaging",
    "payments",
    "platform",
    "reviews",
    "scheduling",
]
