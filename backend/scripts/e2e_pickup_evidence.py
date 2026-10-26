"""Read one online order's pickup state, payments, stock and audits without app calculations."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(order_id: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    params = {"order": order_id}
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        order = await db.execute(
            text(
                "SELECT o.id, o.business_id, o.number, o.status, o.source, o.pickup_status, "
                "o.status_token, o.preparing_at IS NOT NULL AS preparing, "
                "o.ready_at IS NOT NULL AS ready, o.picked_up_at IS NOT NULL AS picked_up, "
                "c.name AS client_name FROM orders o JOIN clients c ON c.id = o.client_id "
                "WHERE o.id = :order"
            ),
            params,
        )
        payments = await db.execute(
            text(
                "SELECT id, kind, status, amount_cents FROM payments "
                "WHERE order_id = :order ORDER BY id"
            ),
            params,
        )
        movements = await db.execute(
            text(
                "SELECT i.id, i.reason, i.quantity FROM inventory i "
                "JOIN lines l ON l.id = i.line_id WHERE l.order_id = :order ORDER BY i.id"
            ),
            params,
        )
        audits = await db.execute(
            text(
                "SELECT action FROM audits WHERE entity_type = 'order' AND entity_id = :order "
                "ORDER BY created_at, id"
            ),
            params,
        )
        return {
            "order": [dict(row) for row in order.mappings()],
            "payments": [dict(row) for row in payments.mappings()],
            "movements": [dict(row) for row in movements.mappings()],
            "audits": [row["action"] for row in audits.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("order_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.order_id)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
