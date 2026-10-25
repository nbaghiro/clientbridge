"""Observe owned inbox messages without application projection or transport helpers."""

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
    messages = (
        "SELECT id FROM messages WHERE thread_id IN "
        "(SELECT id FROM threads WHERE client_id = :client)"
    )
    queries = {
        "threads": "SELECT id, client_id, channel, status FROM threads "
        "WHERE client_id = :client ORDER BY id",
        "messages": "SELECT id, thread_id, direction, channel, body, status, provider_ref, sent_by "
        f"FROM messages WHERE id IN ({messages}) ORDER BY id",
        "deliveries": "SELECT id, state FROM deliveries "
        "WHERE payload->'message'->'tags'->>'message' "
        f"IN ({messages}) ORDER BY id",
        "audits": "SELECT action, entity_id FROM audits "
        f"WHERE entity_id IN ({messages}) ORDER BY id",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {}
        for key, query in queries.items():
            rows = await db.execute(text(query), {"client": client_id})
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
