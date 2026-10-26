"""Stand in for Stripe's plan subscription on a run-owned business, through the app's own mirror."""

import argparse
import asyncio
import json
from datetime import timedelta
from urllib.parse import urlparse

from sqlalchemy import select

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import PlanSubscription, SubscribedItem
from clientbridge.models.business import Business
from clientbridge.services.plans import PLAN_PRICES, mirror_plan
from scripts.demo_context import DEMO_IDS, run_id


async def stand_in(business_id: str, status: str) -> dict[str, object]:
    settings = get_settings()
    if settings.env != "dev" or urlparse(settings.smtp_url or "").hostname not in (
        "localhost",
        "127.0.0.1",
        "mailpit",
    ):
        raise RuntimeError("e2e requires dev settings and a local SMTP sink")
    if business_id in {*DEMO_IDS, *map(run_id, DEMO_IDS)}:
        raise RuntimeError("only a business the run created can stand in for a plan")
    async with SessionLocal() as db:
        business = await db.scalar(
            select(Business).where(Business.id == business_id).with_for_update()
        )
        if (
            business is None
            or business.stripe_subscription_id is not None
            or business.created_at < clock.now() - timedelta(hours=2)
        ):
            raise RuntimeError("the business is not one this run signed up without a plan")
        team = PLAN_PRICES["team_month"]
        changed = mirror_plan(
            business,
            PlanSubscription(
                id=f"sub_e2e_{business_id}",
                status=status,
                customer_account=None,
                business_id=business_id,
                items=(SubscribedItem(team.product, team.interval, 1),),
                cancel_at_period_end=False,
                trial_end=None,
            ),
        )
        await db.commit()
        return {"plan_status": business.plan_status, "plan": business.plan, "changed": changed}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("business_id")
    parser.add_argument("status", choices=("active", "canceled"))
    args = parser.parse_args()
    try:
        print(json.dumps(await stand_in(args.business_id, args.status)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
