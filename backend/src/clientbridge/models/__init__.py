"""Import every domain module so Alembic's autogenerate sees all tables."""

from clientbridge.models import (
    auth,
    billing,
    business,
    catalog,
    clients,
    documents,
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
    "business",
    "catalog",
    "clients",
    "documents",
    "ledger",
    "messaging",
    "payments",
    "platform",
    "reviews",
    "scheduling",
]
