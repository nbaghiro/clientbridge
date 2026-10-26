"""Read one owned business, its team and its audited changes without application calculations."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(business_id: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    params = {"business": business_id}
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        business = await db.execute(
            text(
                "SELECT id, name, slug, province, timezone, subject, status, plan, plan_status, "
                "tax_registered, round(extract(epoch FROM trial_ends_at - created_at))::int "
                "AS trial_seconds FROM businesses WHERE id = :business"
            ),
            params,
        )
        staff = await db.execute(
            text(
                "SELECT s.id, s.role, s.status, s.payee, u.email, u.identity_id IS NOT NULL "
                "AS linked FROM staff s JOIN users u ON u.id = s.user_id "
                "WHERE s.business_id = :business ORDER BY s.created_at, s.id"
            ),
            params,
        )
        audits = await db.execute(
            text(
                "SELECT action, entity_type, entity_id, changes FROM audits "
                "WHERE business_id = :business AND action LIKE 'business.%' "
                "ORDER BY created_at, id"
            ),
            params,
        )
        return {
            "business": [dict(row) for row in business.mappings()],
            "staff": [dict(row) for row in staff.mappings()],
            "audits": [dict(row) for row in audits.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("business_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.business_id)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
