"""Read owned sale, payment, ledger and inventory rows without application calculations."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(item_id: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    params = {"item": item_id}
    order_ids = "SELECT order_id FROM lines WHERE item_id = :item AND order_id IS NOT NULL"
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        item = await db.execute(
            text("SELECT id, stock_on_hand, track_stock FROM items WHERE id = :item"), params
        )
        orders = await db.execute(
            text(
                "SELECT id, client_id, number, status, source, subtotal_cents, tax_total_cents, "
                "total_cents, paid_at IS NOT NULL AS paid "
                f"FROM orders WHERE id IN ({order_ids}) ORDER BY id"
            ),
            params,
        )
        lines = await db.execute(
            text(
                "SELECT id, order_id, item_id, quantity::float8, unit_amount_cents, amount_cents, "
                "tax_class FROM lines WHERE item_id = :item ORDER BY id"
            ),
            params,
        )
        payments = await db.execute(
            text(
                "SELECT id, order_id, kind, method, provider, status, amount_cents, "
                "tendered_cents, tip_cents "
                f"FROM payments WHERE order_id IN ({order_ids}) ORDER BY id"
            ),
            params,
        )
        refunds = await db.execute(
            text(
                "SELECT id, parent_payment_id, status, method, provider, amount_cents, "
                "credit_note FROM payments WHERE kind = 'refund' AND parent_payment_id IN "
                f"(SELECT id FROM payments WHERE order_id IN ({order_ids})) ORDER BY created_at, id"
            ),
            params,
        )
        entries = await db.execute(
            text(
                "SELECT e.journal_id, e.event, e.amount_cents, a.category, a.code, e.source_id "
                "FROM entries e JOIN accounts a ON a.id = e.account_id "
                f"WHERE e.subject_type = 'order' AND e.subject_id IN ({order_ids}) "
                "ORDER BY e.journal_id, e.leg"
            ),
            params,
        )
        movements = await db.execute(
            text(
                "SELECT id, line_id, reason, quantity FROM inventory "
                "WHERE item_id = :item ORDER BY id"
            ),
            params,
        )
        return {
            "item": dict(item.mappings().one()),
            "orders": [dict(row) for row in orders.mappings()],
            "lines": [dict(row) for row in lines.mappings()],
            "payments": [dict(row) for row in payments.mappings()],
            "refunds": [dict(row) for row in refunds.mappings()],
            "entries": [dict(row) for row in entries.mappings()],
            "movements": [dict(row) for row in movements.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("item_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.item_id)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
