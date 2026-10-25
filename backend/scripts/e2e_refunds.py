"""Read committed cash-refund and credit-note evidence for one owned invoice."""

import argparse
import asyncio
import json

from sqlalchemy import text

from clientbridge.core.db import engine


async def evidence(invoice_id: str) -> dict[str, object]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        payments = await db.execute(
            text(
                "SELECT id, kind, status, method, provider, parent_payment_id, amount_cents, "
                "credit_note FROM payments WHERE invoice_id=:invoice ORDER BY created_at,id"
            ),
            {"invoice": invoice_id},
        )
        entries = await db.execute(
            text(
                "SELECT e.journal_id,e.event,e.source_id,e.amount_cents,a.category,a.code "
                "FROM entries e JOIN accounts a ON a.id=e.account_id "
                "WHERE e.subject_type='invoice' AND e.subject_id=:invoice "
                "ORDER BY e.journal_id,e.leg"
            ),
            {"invoice": invoice_id},
        )
        return {
            "payments": [dict(row) for row in payments.mappings()],
            "entries": [dict(row) for row in entries.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("invoice_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.invoice_id)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
