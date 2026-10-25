"""Observe both owned contact matches and all effects of their public booking attempt."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(first: str, second: str, phone: str, item: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    clients = "SELECT id FROM clients WHERE email IN (:first, :second) OR phone = :phone"
    queries = {
        "clients": "SELECT id, name, email, phone, status FROM clients "
        f"WHERE id IN ({clients}) ORDER BY id",
        "subjects": "SELECT id, client_id, name, deleted_at FROM subjects "
        f"WHERE client_id IN ({clients}) ORDER BY id",
        "bookings": "SELECT b.id, b.client_id, b.subject_id FROM bookings b "
        "JOIN slots s ON b.slot_id = s.id WHERE s.item_id = :item ORDER BY b.id",
        "slots": "SELECT id, item_id FROM slots WHERE item_id = :item ORDER BY id",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {}
        for key, query in queries.items():
            rows = await db.execute(
                text(query), {"first": first, "second": second, "phone": phone, "item": item}
            )
            result[key] = [dict(row) for row in rows.mappings()]
        return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    for field in ("first", "second", "phone", "item"):
        parser.add_argument(field)
    args = parser.parse_args()
    try:
        print(
            json.dumps(await evidence(args.first, args.second, args.phone, args.item), default=str)
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
