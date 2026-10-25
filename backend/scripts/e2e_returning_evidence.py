"""Observe owned returning-client identity and booking effects in a read-only transaction."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(client: str, email: str, item: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    queries = {
        "clients": "SELECT id, name, email, phone, status, preferred_channel FROM clients "
        "WHERE id = :client OR email = :email ORDER BY id",
        "subjects": "SELECT id, client_id, name, deleted_at FROM subjects "
        "WHERE client_id = :client ORDER BY id",
        "bookings": "SELECT b.id, b.client_id, b.subject_id, b.status, b.source, "
        "b.price_cents, b.deposit_amount_cents, b.deposit_status FROM bookings b "
        "JOIN slots s ON s.id = b.slot_id WHERE s.item_id = :item ORDER BY b.id",
        "slots": "SELECT id, item_id, staff_id, starts_at, ends_at FROM slots "
        "WHERE item_id = :item ORDER BY id",
        "challenges": "SELECT id, client_id, attempts, verified_at IS NOT NULL AS verified "
        "FROM returning_challenges WHERE client_id = :client ORDER BY id",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {}
        for key, query in queries.items():
            rows = await db.execute(text(query), {"client": client, "email": email, "item": item})
            result[key] = [dict(row) for row in rows.mappings()]
        return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("client")
    parser.add_argument("email")
    parser.add_argument("item")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.client, args.email, args.item), default=str))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
