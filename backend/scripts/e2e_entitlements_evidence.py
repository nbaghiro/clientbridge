"""Read owned entitlement and journal rows independently of application projections."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(client_id: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    params = {"client": client_id}
    subjects = (
        "SELECT id FROM gift_cards WHERE purchaser_client_id = :client "
        "UNION SELECT id FROM packages WHERE client_id = :client"
    )
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        queries = {
            "gifts": "SELECT id, code, initial_cents, status, payment_id FROM gift_cards "
            "WHERE purchaser_client_id = :client ORDER BY id",
            "packages": "SELECT id, item_id, sessions_total, status, payment_id FROM packages "
            "WHERE client_id = :client ORDER BY id",
            "payments": "SELECT id, kind, method, provider, status, amount_cents FROM payments "
            "WHERE id IN (SELECT payment_id FROM gift_cards WHERE purchaser_client_id = :client "
            "UNION SELECT payment_id FROM packages WHERE client_id = :client) ORDER BY id",
            "entries": "SELECT e.journal_id, e.event, e.amount_cents, a.category, e.subject_id "
            "FROM entries e JOIN accounts a ON a.id = e.account_id "
            f"WHERE e.subject_id IN ({subjects}) ORDER BY e.journal_id, e.leg",
        }
        result: dict[str, object] = {}
        for key, query in queries.items():
            rows = await db.execute(text(query), params)
            result[key] = [dict(row) for row in rows.mappings()]
        return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("client_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.client_id)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
