"""Read committed public-document evidence without application serialization helpers."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine


async def evidence(kind: str, document_id: str) -> list[dict[str, object]]:
    query = (
        "SELECT id, status, answers, signature, definition, submitted_at::text "
        "FROM responses WHERE id = :id"
        if kind == "form"
        else "SELECT id, status, signed_body, contract_version, signer_name, method, "
        "strokes, signed_at::text FROM signatures WHERE id = :id"
    )
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result = await db.execute(text(query), {"id": document_id})
        return [dict(row) for row in result.mappings()]


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("form", "contract", "check"))
    parser.add_argument("document_id", nargs="?", default="")
    args = parser.parse_args()
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("document e2e requires dev settings and a local SMTP sink")
    try:
        print(
            json.dumps(
                {"local_mail": True}
                if args.kind == "check"
                else await evidence(args.kind, args.document_id)
            )
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
