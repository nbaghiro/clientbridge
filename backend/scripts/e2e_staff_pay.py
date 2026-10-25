"""Read committed staff-pay journals for one owned booking without application calculators."""

import argparse
import asyncio
import json

from sqlalchemy import text

from clientbridge.core.db import engine


async def evidence(booking_id: str) -> list[dict[str, object]]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        rows = await db.execute(
            text(
                "SELECT e.journal_id, e.event, e.ref, e.amount_cents, a.category, a.code, "
                "a.owner_type, a.owner_id FROM entries e JOIN accounts a ON a.id=e.account_id "
                "WHERE e.subject_type='booking' AND e.subject_id=:booking "
                "AND e.event IN ('earning','approval','staff_payment') "
                "ORDER BY e.journal_id,e.leg"
            ),
            {"booking": booking_id},
        )
        return [dict(row) for row in rows.mappings()]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("booking_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.booking_id)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
