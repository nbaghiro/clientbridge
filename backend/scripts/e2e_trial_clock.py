"""End the trial of one business an e2e case signed up, so a lapse needs no clock change."""

import argparse
import asyncio
import json
from urllib.parse import urlparse

from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine

_OWNED = (
    "SELECT b.id FROM businesses b WHERE b.id = :business AND b.plan_status = 'trialing' "
    "AND b.stripe_subscription_id IS NULL AND b.created_at > now() - interval '2 hours' "
    "AND (SELECT count(*) FROM staff s WHERE s.business_id = b.id AND s.status = 'active') = 1 "
    "AND EXISTS (SELECT 1 FROM staff s JOIN users u ON u.id = s.user_id "
    "WHERE s.business_id = b.id AND s.role = 'owner' AND s.status = 'active' "
    "AND lower(u.email) = lower(:owner))"
)


async def end_trial(business_id: str, owner: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    params = {"business": business_id, "owner": owner}
    async with engine.begin() as db:
        if await db.scalar(text(_OWNED), params) is None:
            raise RuntimeError("the business is not a fresh trial this case signed up")
        ended = await db.execute(
            text(
                "UPDATE businesses SET trial_ends_at = now() - interval '1 second' "
                "WHERE id = :business RETURNING id, plan_status, trial_ends_at < now() AS lapsed"
            ),
            params,
        )
        return dict(ended.mappings().one())


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("business_id")
    parser.add_argument("owner_email")
    args = parser.parse_args()
    try:
        print(json.dumps(await end_trial(args.business_id, args.owner_email)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
