"""Observe a seeded closed quarter and filing journals without service projections."""

import asyncio
import json
import os
from datetime import UTC, date, datetime, time, timedelta
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core import clock, zones
from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence() -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    zone = zones.zone("America/Vancouver")
    today = clock.today(zone)
    quarter = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
    anchor = datetime.combine(quarter, time(12), zone)
    if datetime.fromisoformat(os.environ["E2E_SEED_AS_OF"]) != anchor:
        raise RuntimeError("requires the first seed at noon Vancouver on this quarter's first day")
    end = quarter - timedelta(days=1)
    start = date(end.year, ((end.month - 1) // 3) * 3 + 1, 1)
    lo = datetime.combine(start, time(), zone).astimezone(UTC)
    hi = datetime.combine(quarter, time(), zone).astimezone(UTC)
    queries = {
        "business": "SELECT id, province, timezone, tax_registered, filing_frequency FROM "
        "businesses WHERE id = 'bz_birchbark'",
        "raw_tax": "SELECT e.id, e.journal_id, e.event, e.amount_cents, a.code, e.occurred_at "
        "FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.business_id = "
        "'bz_birchbark' AND a.category = 'tax' AND e.event != 'remittance' AND "
        "e.occurred_at >= :lo AND e.occurred_at < :hi ORDER BY e.id",
        "returns": "SELECT e.id, e.journal_id, e.ref, e.leg, e.amount_cents, a.category, a.code, "
        "e.meta FROM entries e JOIN accounts a ON a.id = e.account_id WHERE "
        "e.business_id = 'bz_birchbark' AND e.event = 'remittance' AND "
        "e.meta->>'start' <= :end AND e.meta->>'end' >= :start ORDER BY e.journal_id, "
        "e.leg",
        "commands": "SELECT id, scope FROM commands WHERE business_id = 'bz_birchbark' AND "
        "scope = 'tax.remit' ORDER BY id",
        "audits": "SELECT id, action, entity_id FROM audits WHERE business_id = 'bz_birchbark' "
        "AND action = 'tax.remit' ORDER BY id",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {
            "start": str(start),
            "end": str(end),
            "lo": str(lo),
            "hi": str(hi),
            "seed_as_of": anchor.isoformat(),
            "filed_on": str(today),
        }
        for key, query in queries.items():
            rows = await db.execute(
                text(query), {"lo": lo, "hi": hi, "start": str(start), "end": str(end)}
            )
            result[key] = [dict(row) for row in rows.mappings()]
        return result


async def main() -> None:
    try:
        print(json.dumps(await evidence(), default=str))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
