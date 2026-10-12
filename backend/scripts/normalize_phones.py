"""Report client phones that are not E.164; only --apply rewrites them, on a local dev database."""

import argparse
import asyncio
import json
from collections import Counter

from sqlalchemy import select, update
from sqlalchemy.engine import make_url

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.phones import e164
from clientbridge.models.clients import Client

_EXAMPLES = 20


def validate_apply_target() -> None:
    settings = get_settings()
    url = make_url(settings.database_url)
    if settings.env != "dev" or url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Rewriting phones requires ENV=dev and a localhost database.")


async def normalize(*, apply: bool) -> dict[str, object]:
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(Client.id, Client.business_id, Client.phone)
                .where(Client.phone.is_not(None))
                .order_by(Client.business_id, Client.id)
            )
        ).all()
        changes: list[tuple[str, str]] = []
        unparseable: list[dict[str, str]] = []
        unchanged = 0
        numbers: Counter[tuple[str, str]] = Counter()
        for client_id, business_id, phone in rows:
            if not phone.strip():
                unparseable.append({"client_id": client_id, "phone": phone})
                continue
            parsed = e164(phone)
            if parsed is None:
                unparseable.append({"client_id": client_id, "phone": phone})
                continue
            numbers[(business_id, parsed)] += 1
            if parsed == phone:
                unchanged += 1
            else:
                changes.append((client_id, parsed))
        if apply:
            for client_id, parsed in changes:
                await db.execute(update(Client).where(Client.id == client_id).values(phone=parsed))
            await db.commit()
        return {
            "mode": "apply" if apply else "dry-run",
            "with_phone": len(rows),
            "already_e164": unchanged,
            "to_normalize": len(changes),
            "unparseable": len(unparseable),
            "unparseable_examples": unparseable[:_EXAMPLES],
            "shared_within_a_business": sum(1 for n in numbers.values() if n > 1),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Rewrite the parseable numbers")
    args = parser.parse_args()
    if args.apply:
        validate_apply_target()

    async def run() -> None:
        try:
            print(json.dumps(await normalize(apply=bool(args.apply)), indent=2))
        finally:
            await engine.dispose()

    asyncio.run(run())


if __name__ == "__main__":
    main()
