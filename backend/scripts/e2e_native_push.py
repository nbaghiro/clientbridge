"""The push a client's next message sends staff, as Expo hands it to an iPhone, read only."""

import argparse
import asyncio
import json

from sqlalchemy import text

from clientbridge.core.db import engine
from clientbridge.core.locale import SOURCE_LOCALE
from clientbridge.services.notifications import inbound_message_alert_text


async def payload(client_id: str, preview: str) -> dict[str, object]:
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        row = (
            (
                await db.execute(
                    text(
                        "SELECT t.id AS thread, c.name AS client, b.name AS business "
                        "FROM threads t JOIN clients c ON c.id = t.client_id "
                        "JOIN businesses b ON b.id = t.business_id WHERE t.client_id = :client "
                        "ORDER BY t.updated_at DESC LIMIT 1"
                    ),
                    {"client": client_id},
                )
            )
            .mappings()
            .one()
        )
    body = inbound_message_alert_text(SOURCE_LOCALE, row["client"], preview)
    # Expo puts a push's data under "body" on iOS, beside the alert
    return {
        "aps": {"alert": {"title": row["business"], "body": body}},
        "body": {"type": "message", "thread_id": row["thread"], "client_id": client_id},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("client_id")
    parser.add_argument("preview")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(payload(args.client_id, args.preview))))


if __name__ == "__main__":
    main()
