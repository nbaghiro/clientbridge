"""Observe one owned client's threads, consent, deliveries and callbacks without projections."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine

QUERIES = {
    "threads": "SELECT id, channel FROM threads WHERE client_id = :client ORDER BY id",
    "messages": "SELECT m.id, m.thread_id, m.direction, m.channel, m.body, m.status, "
    "m.provider_ref FROM messages m JOIN threads t ON t.id = m.thread_id "
    "WHERE t.client_id = :client ORDER BY m.created_at, m.id",
    "consents": "SELECT channel, status, source FROM consents WHERE client_id = :client "
    "ORDER BY created_at, id",
    "deliveries": "SELECT d.id, d.payload->>'channel' AS channel, d.state, d.error, "
    "d.provider_ref, regexp_replace(d.key, ':[0-9a-f]{64}$', '') AS scope, "
    "d.payload->'message'->>'to' AS recipient FROM deliveries d JOIN clients c "
    "ON c.id = :client AND d.business_id = c.business_id "
    "AND d.payload->'message'->>'to' IN (c.email, c.phone) ORDER BY d.created_at, d.id",
    "webhooks": "SELECT id, provider, event, status, payload FROM webhooks "
    "WHERE id = ANY(:webhooks) ORDER BY id",
}


async def evidence(client_id: str, webhooks: list[str]) -> dict[str, object]:
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
        for key, query in QUERIES.items():
            rows = await db.execute(text(query), {"client": client_id, "webhooks": webhooks})
            result[key] = [dict(row) for row in rows.mappings()]
        return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("client_id")
    parser.add_argument("--webhook", action="append", default=[])
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.client_id, args.webhook)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
