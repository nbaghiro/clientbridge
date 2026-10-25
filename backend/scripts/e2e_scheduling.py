"""Read owned public-booking race records and rejected contact side effects."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(item_id: str, first_email: str, second_email: str | None) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    params = {"item": item_id, "first": first_email, "second": second_email or first_email}
    queries = {
        "deliveries": "SELECT id, state, payload->'message'->>'to' AS recipient FROM deliveries "
        "WHERE payload->>'channel' = 'email' "
        "AND payload->'message'->>'to' IN (:first, :second) ORDER BY id",
        "slots": "SELECT id, item_id, staff_id, starts_at::text, capacity FROM slots "
        "WHERE item_id = :item ORDER BY id",
        "bookings": "SELECT b.id, b.slot_id, b.client_id, b.subject_id, b.status, "
        "b.source, b.deposit_status, b.deposit_amount_cents FROM bookings b "
        "JOIN slots s ON s.id = b.slot_id WHERE s.item_id = :item ORDER BY b.id",
        "clients": "SELECT id, name, email FROM clients "
        "WHERE email IN (:first, :second) ORDER BY id",
        "subjects": "SELECT s.id, s.client_id, s.name FROM subjects s "
        "JOIN clients c ON c.id = s.client_id "
        "WHERE c.email IN (:first, :second) ORDER BY s.id",
        "payments": "SELECT p.id FROM payments p LEFT JOIN clients c ON c.id = p.client_id "
        "LEFT JOIN bookings b ON b.id = p.booking_id LEFT JOIN slots s ON s.id = b.slot_id "
        "WHERE c.email IN (:first, :second) OR s.item_id = :item ORDER BY p.id",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {}
        for name, query in queries.items():
            rows = await db.execute(text(query), params)
            result[name] = [dict(row) for row in rows.mappings()]
        return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("item_id")
    parser.add_argument("first_email")
    parser.add_argument("second_email", nargs="?")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.item_id, args.first_email, args.second_email)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
