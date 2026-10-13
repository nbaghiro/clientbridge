"""Import every domain module so the Base re-exported here carries all tables."""

from clientbridge.core.db import Base
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
    "Base",
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
