"""Read committed hours, operation receipts and audits independently of application helpers."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(staff_id: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        staff = await db.execute(
            text("SELECT id, user_id, business_id, hours_revision FROM staff WHERE id = :staff"),
            {"staff": staff_id},
        )
        hours = await db.execute(
            text(
                "SELECT weekday, available, start_time::text, end_time::text FROM hours "
                "WHERE staff_id = :staff AND basis = 'recurring' ORDER BY weekday"
            ),
            {"staff": staff_id},
        )
        receipts = await db.execute(
            text(
                "SELECT r.device_id, r.operation_id, r.version, r.result FROM sync_receipts r "
                "JOIN staff s ON s.user_id = r.user_id AND s.business_id = r.business_id "
                "WHERE s.id = :staff ORDER BY r.id"
            ),
            {"staff": staff_id},
        )
        audits = await db.execute(
            text(
                "SELECT action, performed_by, changes FROM audits "
                "WHERE entity_type = 'staff' AND entity_id = :staff AND action = 'hours.week' "
                "ORDER BY id"
            ),
            {"staff": staff_id},
        )
        return {
            "staff": dict(staff.mappings().one()),
            "hours": [dict(row) for row in hours.mappings()],
            "receipts": [dict(row) for row in receipts.mappings()],
            "audits": [dict(row) for row in audits.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("staff_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.staff_id)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
