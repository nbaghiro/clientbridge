from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from sqlalchemy import MetaData

TableScope = Literal["tenant", "identity", "routing", "operational"]


@dataclass(frozen=True)
class TablePolicy:
    scope: TableScope
    tenant_key: str | None
    owner: str


TABLE_POLICIES: Mapping[str, TablePolicy] = MappingProxyType(
    {
        "accounts": TablePolicy("tenant", "business_id", "ledger"),
        "addons": TablePolicy("tenant", "business_id", "scheduling"),
        "audits": TablePolicy("tenant", "business_id", "platform"),
        "bookings": TablePolicy("tenant", "business_id", "scheduling"),
        "broadcasts": TablePolicy("tenant", "business_id", "messaging"),
        "businesses": TablePolicy("tenant", "id", "business"),
        "clients": TablePolicy("tenant", "business_id", "clients"),
        "commands": TablePolicy("tenant", "business_id", "platform"),
        "consents": TablePolicy("tenant", "business_id", "clients"),
        "contracts": TablePolicy("tenant", "business_id", "documents"),
        "devices": TablePolicy("tenant", "business_id", "platform"),
        "entries": TablePolicy("tenant", "business_id", "ledger"),
        "estimates": TablePolicy("tenant", "business_id", "billing"),
        "fields": TablePolicy("tenant", "business_id", "documents"),
        "files": TablePolicy("tenant", "business_id", "platform"),
        "forms": TablePolicy("tenant", "business_id", "documents"),
        "gift_cards": TablePolicy("tenant", "business_id", "catalog"),
        "hours": TablePolicy("tenant", "business_id", "scheduling"),
        "inventory": TablePolicy("tenant", "business_id", "catalog"),
        "invoices": TablePolicy("tenant", "business_id", "billing"),
        "items": TablePolicy("tenant", "business_id", "catalog"),
        "lines": TablePolicy("tenant", "business_id", "billing"),
        "messages": TablePolicy("tenant", "business_id", "messaging"),
        "notes": TablePolicy("tenant", "business_id", "clients"),
        "orders": TablePolicy("tenant", "business_id", "billing"),
        "packages": TablePolicy("tenant", "business_id", "catalog"),
        "payment_methods": TablePolicy("tenant", "business_id", "payments"),
        "payment_setup_links": TablePolicy("tenant", "business_id", "payments"),
        "payments": TablePolicy("tenant", "business_id", "payments"),
        "recurrences": TablePolicy("tenant", "business_id", "scheduling"),
        "resources": TablePolicy("tenant", "business_id", "scheduling"),
        "responses": TablePolicy("tenant", "business_id", "documents"),
        "returning_challenges": TablePolicy("tenant", "business_id", "returning"),
        "reviews": TablePolicy("tenant", "business_id", "reviews"),
        "sessions": TablePolicy("identity", None, "auth"),
        "signatures": TablePolicy("tenant", "business_id", "documents"),
        "slots": TablePolicy("tenant", "business_id", "scheduling"),
        "staff": TablePolicy("tenant", "business_id", "business"),
        "subjects": TablePolicy("tenant", "business_id", "clients"),
        "subscriptions": TablePolicy("tenant", "business_id", "catalog"),
        "threads": TablePolicy("tenant", "business_id", "messaging"),
        "tokens": TablePolicy("identity", None, "auth"),
        "users": TablePolicy("identity", None, "business"),
        "webhooks": TablePolicy("routing", None, "platform"),
    }
)


def table_policy_errors(
    metadata: MetaData, policies: Mapping[str, TablePolicy] = TABLE_POLICIES
) -> tuple[str, ...]:
    errors: list[str] = []
    for name in sorted(metadata.tables.keys() - policies.keys()):
        errors.append(f"{name}: missing table policy")
    for name in sorted(policies.keys() - metadata.tables.keys()):
        errors.append(f"{name}: policy has no table")
    for name in sorted(metadata.tables.keys() & policies.keys()):
        table, policy = metadata.tables[name], policies[name]
        tenant_key = (
            "id" if name == "businesses" else "business_id" if "business_id" in table.c else None
        )
        if policy.tenant_key != tenant_key:
            errors.append(f"{name}: expected tenant key {tenant_key!r}")
        if (policy.scope == "tenant") != (tenant_key is not None):
            errors.append(f"{name}: scope disagrees with tenant columns")
        if name in {"users", "sessions", "tokens"} and policy.scope != "identity":
            errors.append(f"{name}: identity scope required")
        if name == "webhooks" and policy.scope != "routing":
            errors.append(f"{name}: routing scope required")
        if not policy.owner.strip():
            errors.append(f"{name}: domain owner required")
        if tenant_key is not None:
            if tenant_key not in table.c:
                errors.append(f"{name}: missing tenant key {tenant_key!r}")
                continue
            column = table.c[tenant_key]
            if column.nullable:
                errors.append(f"{name}: tenant key must be non-null")
            if tenant_key == "id" and not column.primary_key:
                errors.append(f"{name}: tenant root key must be primary")
            if tenant_key == "business_id" and not any(
                fk.target_fullname == "businesses.id" for fk in column.foreign_keys
            ):
                errors.append(f"{name}: tenant key must reference businesses.id")
    return tuple(errors)
