"""Fresh Stripe accounts the onboarding cases start from businesses the run creates."""

import argparse
import json
from datetime import datetime

from sqlalchemy import select

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import StripeGateway, close_stripe_client
from clientbridge.models.business import Business
from e2e.stripe_context import BUSINESS, run_state, validate_context
from e2e.stripe_pool import POOL


def gateway() -> StripeGateway:
    settings = get_settings()
    return StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret, "CA")


def pool_accounts() -> set[str]:
    pool = json.loads(POOL.read_text())
    return {account for pair in pool["pairs"].values() for account in pair.values()}


async def fresh_account(stripe: StripeGateway, business: Business, prepared: int) -> str | None:
    """The account the app created for a business made during the run, never a pool merchant."""
    account = business.stripe_account_id
    if business.id == BUSINESS or business.created_at.timestamp() < prepared or account is None:
        return None
    if account in pool_accounts():
        raise ValueError("a business the run created is bound to a pool merchant")
    found = (await stripe.client.v2.core.accounts.retrieve_async(account)).to_dict()
    created = found.get("created")
    if found.get("livemode") or not isinstance(created, str):
        raise ValueError("the fresh account is not a sandbox account")
    if datetime.fromisoformat(created).timestamp() < prepared:
        raise ValueError("the fresh account is older than the run")
    return account


async def close_account(stripe: StripeGateway, account: str) -> bool:
    found = (await stripe.client.v2.core.accounts.retrieve_async(account)).to_dict()
    if found.get("closed"):
        return False
    await stripe.client.v2.core.accounts.close_async(
        account, {"applied_configurations": ["merchant"]}
    )
    return True


def prepared_at(state: dict[str, object]) -> int:
    prepared = state.get("prepared_at")
    if not isinstance(prepared, int):
        raise ValueError("the run's manifest has no prepare time")
    return prepared


async def close_fresh_accounts(state: dict[str, object]) -> list[dict[str, object]]:
    """Close every fresh account the run's businesses still hold, including a failed case's."""
    prepared = prepared_at(state)
    namespace = get_settings().run_namespace
    if not namespace:
        raise ValueError("closing fresh accounts needs the run's namespace")
    stripe = gateway()
    actions: list[dict[str, object]] = []
    async with SessionLocal() as db:
        # other runs share the database and create their own fresh accounts meanwhile
        businesses = await db.scalars(
            select(Business).where(
                Business.stripe_account_id.is_not(None), Business.id.endswith(namespace)
            )
        )
        for business in businesses:
            account = await fresh_account(stripe, business, prepared)
            if account is not None and await close_account(stripe, account):
                actions.append({"action": "closed_fresh_account", "account": account})
    return actions


async def onboarding(command: str, business_id: str) -> dict[str, object]:
    account = await validate_context()
    _, state = run_state(account)
    stripe = gateway()
    async with SessionLocal() as db:
        business = await db.get(Business, business_id)
        fresh = (
            None if business is None else await fresh_account(stripe, business, prepared_at(state))
        )
    if fresh is None:
        raise ValueError("the business has no fresh account the run created")
    if command == "close":
        return {"account": fresh, "closed": await close_account(stripe, fresh)}
    status = await stripe.get_account(fresh)
    return {
        "account": fresh,
        "charges_enabled": status.charges_enabled,
        "payouts_enabled": status.payouts_enabled,
        "past_due": status.past_due,
        "currently_due": status.currently_due,
    }


async def onboarding_main(argv: list[str]) -> None:
    """Read or close the fresh account of a business the run created."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe onboarding")
    parser.add_argument("command", choices=("account", "close"))
    parser.add_argument("business_id")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await onboarding(args.command, args.business_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()
