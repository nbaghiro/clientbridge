"""Read owned clients' visits, holds, add-ons, packages and invoices straight from the tables."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine

CLIENTS = "SELECT id FROM clients WHERE id = ANY(:keys) OR email = ANY(:keys)"
BOOKINGS = f"SELECT id FROM bookings WHERE client_id IN ({CLIENTS})"
INVOICES = (
    f"SELECT id FROM invoices WHERE client_id IN ({CLIENTS}) "
    f"UNION SELECT invoice_id FROM bookings WHERE id IN ({BOOKINGS})"
)
PACKAGES = f"SELECT id FROM packages WHERE client_id IN ({CLIENTS})"
QUERIES = {
    "clients": f"SELECT id, name, email FROM clients WHERE id IN ({CLIENTS}) ORDER BY email",
    "subjects": "SELECT id, client_id, name, attributes FROM subjects "
    f"WHERE client_id IN ({CLIENTS}) ORDER BY name",
    "bookings": "SELECT b.id, b.client_id, b.subject_id, b.status, b.source, b.staff_id, "
    "b.price_cents, b.deposit_amount_cents, b.deposit_status, b.invoice_id, b.package_id, "
    "b.slot_id, to_jsonb(s.starts_at) AS starts_at, to_jsonb(s.ends_at) AS ends_at, "
    "s.item_id, s.resource_id, s.recurrence_id, s.capacity, s.status AS slot_status "
    f"FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.id IN ({BOOKINGS}) "
    "ORDER BY s.starts_at, b.id",
    "addons": "SELECT booking_id, item_id, description, quantity, unit_amount_cents FROM addons "
    f"WHERE booking_id IN ({BOOKINGS}) ORDER BY booking_id, id",
    "packages": "SELECT id, item_id, subject_id, sessions_total, status, payment_id "
    f"FROM packages WHERE id IN ({PACKAGES}) ORDER BY id",
    "payments": "SELECT id, kind, method, status, amount_cents, invoice_id, booking_id "
    f"FROM payments WHERE client_id IN ({CLIENTS}) ORDER BY id",
    "invoices": "SELECT id, client_id, status, number, subtotal_cents, tax_total_cents, "
    f"total_cents, to_jsonb(due_at) AS due_at FROM invoices WHERE id IN ({INVOICES}) ORDER BY id",
    "lines": "SELECT invoice_id, position, description, quantity::float AS quantity, "
    "unit_amount_cents, amount_cents, tax_amount_cents, item_id, booking_id FROM lines "
    f"WHERE invoice_id IN ({INVOICES}) ORDER BY invoice_id, position",
    "entries": "SELECT e.journal_id, e.event, e.amount_cents, a.category, e.subject_type, "
    "e.subject_id, e.source_id FROM entries e JOIN accounts a ON a.id = e.account_id "
    f"WHERE e.subject_id IN ({PACKAGES}) OR e.subject_id IN ({INVOICES}) "
    "OR e.subject_id IN (" + BOOKINGS + ") ORDER BY e.journal_id, e.leg",
}
HOLDS = (
    "SELECT id, item_id, staff_id, to_jsonb(starts_at) AS starts_at, "
    "to_jsonb(ends_at) AS ends_at, status FROM slots "
    "WHERE resource_id = :resource ORDER BY starts_at, id"
)


async def evidence(keys: list[str], resource: str | None) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {}
        for name, query in QUERIES.items():
            rows = await db.execute(text(query), {"keys": keys})
            result[name] = [dict(row) for row in rows.mappings()]
        if resource is not None:
            rows = await db.execute(text(HOLDS), {"resource": resource})
            result["holds"] = [dict(row) for row in rows.mappings()]
        return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("keys", nargs="+", help="client ids or emails")
    parser.add_argument("--resource")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.keys, args.resource)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
