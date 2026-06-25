"""Import every domain module so Alembic's autogenerate sees all tables."""

from clientbridge.models import (
    billing,
    catalog,
    crm,
    documents,
    identity,
    messaging,
    payments,
    platform,
    reviews,
    scheduling,
)

__all__ = [
    "billing",
    "catalog",
    "crm",
    "documents",
    "identity",
    "messaging",
    "payments",
    "platform",
    "reviews",
    "scheduling",
]
