"""Read all fixture command-created items and their stock movements without app helpers."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine
from scripts.demo_context import FIXTURE_BUSINESS, run_id


async def evidence(create_keys: list[str]) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        params = {"keys": json.dumps(create_keys), "business": run_id(FIXTURE_BUSINESS)}
        owned = "SELECT response->>'id' FROM commands WHERE business_id = :business "
        owned += "AND scope = 'item.create' AND key IN "
        owned += "(SELECT jsonb_array_elements_text(CAST(:keys AS jsonb)))"
        items = await db.execute(
            text(
                "SELECT id, name, description, kind, sku, price_cents, cost_cents, "
                "track_stock, stock_on_hand "
                f"FROM items WHERE id IN ({owned}) ORDER BY id"
            ),
            params,
        )
        movements = await db.execute(
            text(
                "SELECT id, item_id, line_id, reason, quantity, note FROM inventory "
                f"WHERE item_id IN ({owned}) ORDER BY id"
            ),
            params,
        )
        audits = await db.execute(
            text(
                "SELECT entity_id, action FROM audits WHERE action = 'item.create' "
                f"AND entity_id IN ({owned}) ORDER BY id"
            ),
            params,
        )
        receipts = await db.execute(
            text(
                "SELECT key, scope, response->>'id' AS item_id FROM commands "
                "WHERE scope = 'item.create' AND response->>'id' IN "
                f"({owned}) ORDER BY id"
            ),
            params,
        )
        return {
            "items": [dict(row) for row in items.mappings()],
            "movements": [dict(row) for row in movements.mappings()],
            "audits": [dict(row) for row in audits.mappings()],
            "receipts": [dict(row) for row in receipts.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("create_keys")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(json.loads(args.create_keys))))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
