"""Read committed payment evidence without calling application calculation helpers."""

import argparse
import asyncio
import json
from typing import Literal
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def payment_evidence(invoice_id: str) -> dict[str, object]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        payments = await db.execute(
            text(
                "SELECT id, amount_cents, status, method, provider FROM payments "
                "WHERE invoice_id = :invoice ORDER BY id"
            ),
            {"invoice": invoice_id},
        )
        entries = await db.execute(
            text(
                "SELECT e.journal_id, e.event, e.amount_cents, a.category, e.source_id "
                "FROM entries e JOIN accounts a ON a.id = e.account_id "
                "WHERE e.subject_type = 'invoice' AND e.subject_id = :invoice "
                "ORDER BY e.journal_id, e.leg"
            ),
            {"invoice": invoice_id},
        )
        deliveries = await db.execute(
            text(
                "SELECT d.id, d.state FROM deliveries d "
                "JOIN payments p ON d.key LIKE 'payment:' || p.id || ':%' "
                "WHERE p.invoice_id = :invoice AND d.payload->>'channel' = 'email' "
                "ORDER BY d.id"
            ),
            {"invoice": invoice_id},
        )
        return {
            "payments": [dict(row) for row in payments.mappings()],
            "entries": [dict(row) for row in entries.mappings()],
            "deliveries": [dict(row) for row in deliveries.mappings()],
        }


async def document_evidence(
    kind: Literal["invoice", "estimate"], document_id: str
) -> dict[str, object]:
    table = "invoices" if kind == "invoice" else "estimates"
    parent = "invoice_id" if kind == "invoice" else "estimate_id"
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        document = await db.execute(
            text(
                "SELECT to_jsonb(d) - 'pay_token' - 'view_token' AS data "
                f"FROM {table} d WHERE id = :id"
            ),
            {"id": document_id},
        )
        lines = await db.execute(
            text(f"SELECT to_jsonb(l) AS data FROM lines l WHERE {parent} = :id ORDER BY position"),
            {"id": document_id},
        )
        siblings = await db.execute(
            text(
                f"SELECT id, status FROM {table} WHERE client_id = "
                f"(SELECT client_id FROM {table} WHERE id = :id) ORDER BY id"
            ),
            {"id": document_id},
        )
        return {
            "document": document.scalar_one(),
            "lines": list(lines.scalars()),
            "siblings": [dict(row) for row in siblings.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("invoice_id", nargs="?")
    parser.add_argument("--check-local-mail", action="store_true")
    parser.add_argument("--document", choices=("invoice", "estimate"))
    args = parser.parse_args()
    try:
        if args.check_local_mail:
            settings = get_settings()
            if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
                "localhost",
                "127.0.0.1",
                "mailpit",
            ):
                raise RuntimeError("e2e requires dev settings and a local SMTP sink")
            print(json.dumps({"local_mail": True}))
        elif args.document in ("invoice", "estimate") and args.invoice_id:
            print(json.dumps(await document_evidence(args.document, args.invoice_id)))
        elif args.invoice_id:
            print(json.dumps(await payment_evidence(args.invoice_id)))
        else:
            parser.error("invoice_id or --check-local-mail is required")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
