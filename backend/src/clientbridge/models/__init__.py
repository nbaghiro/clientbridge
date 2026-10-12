"""Import every domain module so Alembic's autogenerate sees all tables."""

from clientbridge.models import (
    billing,
    business,
    catalog,
    clients,
    documents,
    ledger,
    messaging,
    payments,
    platform,
    returning,
    reviews,
    scheduling,
)

__all__ = [
    "billing",
    "business",
    "catalog",
    "clients",
    "documents",
    "ledger",
    "messaging",
    "payments",
    "platform",
    "returning",
    "reviews",
    "scheduling",
]
