"""Read owned class sessions and enrollment state without application-derived counts."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(
    item_id: str, booking_id: str | None = None, seated: str | None = None
) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        params = {"item": item_id}
        if seated is not None:
            rows = await db.execute(
                text(
                    "SELECT d.id, d.state, d.error, d.payload->>'channel' AS channel, "
                    "d.payload->'message'->>'to' AS recipient, "
                    "d.payload->'message'->>'subject' AS subject, d.created_at "
                    "FROM deliveries d JOIN bookings b ON b.id = :booking "
                    "JOIN slots s ON s.id = b.slot_id AND s.item_id = :item "
                    "WHERE starts_with(d.key, 'seat:' || s.id || ':' || b.id || ':') ORDER BY d.id"
                ),
                {**params, "booking": seated},
            )
            return {
                "deliveries": [
                    {**row, "created_at": row["created_at"].isoformat()} for row in rows.mappings()
                ]
            }
        if booking_id is not None:
            token = await db.scalar(
                text(
                    "SELECT b.manage_token FROM bookings b JOIN slots s ON s.id = b.slot_id "
                    "WHERE s.item_id = :item AND b.id = :booking AND b.deleted_at IS NULL"
                ),
                {**params, "booking": booking_id},
            )
            if not isinstance(token, str) or not token:
                raise RuntimeError("owned enrollment has no manage token")
            return {"manage_token": token}
        slots = await db.execute(
            text(
                "SELECT id, item_id, staff_id, capacity, status FROM slots "
                "WHERE item_id = :item ORDER BY id"
            ),
            params,
        )
        bookings = await db.execute(
            text(
                "SELECT b.id, b.slot_id, b.client_id, b.status, b.deposit_status, "
                "b.deposit_amount_cents FROM bookings b JOIN slots s ON s.id = b.slot_id "
                "WHERE s.item_id = :item AND b.deleted_at IS NULL ORDER BY b.id"
            ),
            params,
        )
        return {
            "slots": [dict(row) for row in slots.mappings()],
            "bookings": [dict(row) for row in bookings.mappings()],
        }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("item_id")
    parser.add_argument("--manage-booking")
    parser.add_argument("--seat-deliveries")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.item_id, args.manage_booking, args.seat_deliveries)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
