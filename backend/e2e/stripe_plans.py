"""Plan billing fixtures: a business the run opens, billed on the platform under a test clock."""

import argparse
import asyncio
import json
import os
import time
from pathlib import Path
from typing import cast

import stripe
from pydantic import BaseModel, ConfigDict, TypeAdapter
from stripe.v2.core import AccountService

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import SETTLEMENT_CURRENCY, close_stripe_client
from clientbridge.models.business import Business
from e2e.stripe_context import BUSINESS, run_state, save, validate_context
from e2e.stripe_onboarding import pool_accounts, prepared_at


class PlanFixture(BaseModel):
    """A business opened during the run whose plan bills a platform account on a test clock."""

    model_config = ConfigDict(extra="forbid")
    business: str
    clock: str | None = None
    account: str | None = None


def plan_fixtures(state: dict[str, object]) -> list[PlanFixture]:
    fixtures = TypeAdapter(list[PlanFixture]).validate_python(state.get("plan_fixtures", []))
    for field in ("business", "clock", "account"):
        values = [value for f in fixtures if (value := getattr(f, field)) is not None]
        if len(values) != len(set(values)):
            raise ValueError("duplicate plan fixture lineage; cannot prove cleanup")
    return fixtures


def accounts() -> AccountService:
    # recovery runs without the app's settings, so this reads the key the harness set
    return stripe.StripeClient(str(stripe.api_key)).v2.core.accounts


def plan_tags(run: str, business: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "plans",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_business": business,
    }


def plan_clock_name(run: str, business: str) -> str:
    return f"clientbridge-qa plan {run} {business}"


def save_plans(path: Path, state: dict[str, object], fixtures: list[PlanFixture]) -> None:
    state["plan_fixtures"] = [fixture.model_dump(exclude_none=True) for fixture in fixtures]
    plan_fixtures(state)
    save(path, state)


async def register_plan(path: Path, state: dict[str, object], business_id: str) -> PlanFixture:
    """Bind a business the run opened to a platform account on a fresh test clock."""
    run = str(state["run_id"])
    fixtures = plan_fixtures(state)
    if any(fixture.business == business_id for fixture in fixtures):
        raise ValueError("the business already has a plan fixture")
    async with SessionLocal() as db:
        business = await db.get(Business, business_id)
        if (
            business is None
            or business.id == BUSINESS
            or business.created_at.timestamp() < prepared_at(state)
        ):
            raise ValueError("only a business the run opened can bill a plan")
        if business.stripe_account_id is not None or business.stripe_subscription_id is not None:
            raise ValueError("refusing to adopt a business that already has a Stripe account")
        fixture = PlanFixture(business=business_id)
        fixtures.append(fixture)
        save_plans(path, state, fixtures)  # lineage before any provider write
        key = f"browser:{run}:plan:{business_id}"
        created = await stripe.test_helpers.TestClock.create_async(
            frozen_time=int(clock.wall().timestamp()),
            name=plan_clock_name(run, business_id),
            idempotency_key=f"{key}:clock",
        )
        fixture.clock = created.id
        save_plans(path, state, fixtures)
        # the app makes this account itself at Checkout; only one made here can carry the clock
        account = await accounts().create_async(
            {
                "display_name": business.name,
                "identity": {"country": "ca"},
                "configuration": {"customer": {"test_clock": created.id}},
                "defaults": {"currency": SETTLEMENT_CURRENCY, "locales": ["en-CA"]},
                "metadata": plan_tags(run, business_id),
            },
            {"idempotency_key": f"{key}:account"},
        )
        if account.livemode or account.id in pool_accounts():
            raise ValueError("the plan account is not a fresh sandbox account")
        fixture.account = account.id
        save_plans(path, state, fixtures)
        business.stripe_account_id = account.id
        await db.commit()
        return fixture


async def subscriptions(fixture: PlanFixture) -> list[stripe.Subscription]:
    if fixture.clock is None:
        return []
    listed = await stripe.Subscription.list_async(test_clock=fixture.clock, status="all")
    owned: list[stripe.Subscription] = []
    async for subscription in listed.auto_paging_iter():
        details = subscription.to_dict()
        if (
            subscription.livemode
            or details.get("customer_account") != fixture.account
            or details.get("metadata", {}).get("business_id") != fixture.business
        ):
            raise ValueError("the plan clock holds a subscription outside its fixture")
        owned.append(subscription)
    return owned


async def advance(run: str, fixture: PlanFixture, seconds: int) -> int:
    if fixture.clock is None or seconds <= 0:
        raise ValueError("only a registered plan clock can move forward")
    current = await stripe.test_helpers.TestClock.retrieve_async(fixture.clock)
    if (
        current.livemode
        or current.name != plan_clock_name(run, fixture.business)
        or current.status != "ready"
    ):
        raise ValueError("the plan clock is not this run's or is still moving")
    target = current.frozen_time + seconds
    await stripe.test_helpers.TestClock.advance_async(fixture.clock, frozen_time=target)
    deadline = time.monotonic() + 300
    while current.status != "ready" or current.frozen_time != target:
        if current.status == "internal_failure" or time.monotonic() > deadline:
            raise TimeoutError("the sandbox test clock did not finish advancing")
        await asyncio.sleep(2)
        current = await stripe.test_helpers.TestClock.retrieve_async(fixture.clock)
    return target


def plan_item(item: dict[str, object]) -> dict[str, object]:
    price = cast(dict[str, object], item["price"])
    recurring = cast(dict[str, object], price["recurring"])
    return {
        "key": str(price.get("lookup_key")),
        "interval": recurring.get("interval"),
        "quantity": item.get("quantity"),
    }


async def evidence(fixture: PlanFixture) -> dict[str, object]:
    """What Stripe bills for the plan, beside what the app recorded about it."""
    plans: list[dict[str, object]] = []
    invoices: list[dict[str, object]] = []
    for subscription in await subscriptions(fixture):
        details = subscription.to_dict()
        items = cast(list[dict[str, object]], details["items"]["data"])
        plans.append(
            {
                "id": subscription.id,
                "status": subscription.status,
                "cancel_at_period_end": subscription.cancel_at_period_end,
                "items": sorted(
                    (plan_item(item) for item in items), key=lambda row: str(row["key"])
                ),
            }
        )
        listed = await stripe.Invoice.list_async(subscription=subscription.id)
        async for invoice in listed.auto_paging_iter():
            found = invoice.to_dict()
            invoices.append(
                {
                    **{key: found.get(key) for key in ("id", "status", "billing_reason")},
                    **{key: found.get(key) for key in ("subtotal", "total", "amount_paid")},
                    "tax": sum(
                        int(cast(int, row.get("amount", 0)))
                        for row in cast(list[dict[str, object]], found.get("total_taxes") or [])
                    ),
                    "attempt_count": found.get("attempt_count"),
                    "created": found.get("created"),
                    "subscription": subscription.id,
                }
            )
    async with SessionLocal() as db:
        business = await db.get(Business, fixture.business)
        if business is None:
            raise ValueError("the plan fixture's business is gone")
        recorded = {
            "plan": business.plan,
            "plan_status": business.plan_status,
            "stripe_account_id": business.stripe_account_id,
            "stripe_subscription_id": business.stripe_subscription_id,
        }
    return {
        "business": recorded,
        "subscriptions": plans,
        "invoices": sorted(invoices, key=lambda row: int(cast(int, row["created"]))),
    }


async def item_changes(fixture: PlanFixture) -> dict[str, object]:
    """How many times Stripe changed each plan subscription's items, from its update events."""
    counts: dict[str, int] = {}
    for subscription in await subscriptions(fixture):
        counts[subscription.id] = 0
        # an hour of slack, since a test clock's objects carry its frozen time
        since = min(subscription.created, int(clock.wall().timestamp())) - 3600
        listed = await stripe.Event.list_async(
            type="customer.subscription.updated", created={"gte": since}, limit=100
        )
        async for event in listed.auto_paging_iter():
            found = event.to_dict()
            data = cast(dict[str, dict[str, object]], found["data"])
            if data["object"].get("id") == subscription.id and "items" in data.get(
                "previous_attributes", {}
            ):
                counts[subscription.id] += 1
    return {"changes": counts}


async def decline(fixture: PlanFixture) -> dict[str, object]:
    """Swap the plan's card for one that declines, so the next renewal fails."""
    live = [s for s in await subscriptions(fixture) if s.status in ("active", "trialing")]
    if len(live) != 1 or fixture.account is None:
        raise ValueError("the plan fixture has no single live subscription")
    # Stripe's test card that attaches but declines every charge, as a card the bank starts refusing
    attached = await stripe.PaymentMethod.attach_async(
        "pm_card_chargeCustomerFail", customer_account=fixture.account
    )
    updated = await stripe.Subscription.modify_async(live[0].id, default_payment_method=attached.id)
    return {"subscription": updated.id, "payment_method": attached.id}


async def clean_plan(fixture: PlanFixture, *, apply: bool = True) -> list[dict[str, object]]:
    """Cancel the plan's subscriptions, close its account and delete its clock."""
    actions: list[dict[str, object]] = []
    for subscription in await subscriptions(fixture):
        if subscription.status in ("canceled", "incomplete_expired"):
            continue
        if apply:
            ended = await stripe.Subscription.cancel_async(subscription.id)
            actions.append({"plan_subscription": ended.id, "status": ended.status})
        else:
            actions.append({"plan_subscription": subscription.id, "status": "planned_cancel"})
    if fixture.account is not None:
        found = (await accounts().retrieve_async(fixture.account)).to_dict()
        tags = cast(dict[str, str], found.get("metadata") or {})
        if found.get("livemode") or tags.get("clientbridge_qa_business") != fixture.business:
            raise ValueError("the plan account does not carry its fixture's ownership")
        if not found.get("closed"):
            if apply:
                await accounts().close_async(
                    fixture.account,
                    {"applied_configurations": found.get("applied_configurations", ["customer"])},
                )
            actions.append({"plan_account": fixture.account, "closed": apply})
    if fixture.clock is not None:
        try:
            current = await stripe.test_helpers.TestClock.retrieve_async(fixture.clock)
        except stripe.InvalidRequestError:
            current = None
        if current is not None and not current.livemode:
            if apply:
                await stripe.test_helpers.TestClock.delete_async(fixture.clock)
            actions.append({"plan_clock": fixture.clock, "deleted": apply})
    return actions


async def clean_plans(state: dict[str, object]) -> list[dict[str, object]]:
    fixtures = plan_fixtures(state)
    for fixture in fixtures:
        await clean_plan(fixture, apply=False)
    actions: list[dict[str, object]] = []
    for fixture in fixtures:
        actions.extend(await clean_plan(fixture))
    return actions


async def plan_action(action: str, business_id: str, seconds: int) -> dict[str, object]:
    account = await validate_context()
    path, state = run_state(account)
    if action == "register":
        return (await register_plan(path, state, business_id)).model_dump()
    matches = [f for f in plan_fixtures(state) if f.business == business_id]
    if len(matches) != 1:
        raise ValueError("the business is not one registered plan fixture")
    fixture = matches[0]
    if action == "advance":
        return {"frozen_time": await advance(str(state["run_id"]), fixture, seconds)}
    if action == "decline":
        return await decline(fixture)
    if action == "changes":
        return await item_changes(fixture)
    return await evidence(fixture)


async def plans_main(argv: list[str]) -> None:
    """Bind a run's new business to a clocked platform account, move the clock, read the bill."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe plans")
    parser.add_argument("action", choices=("register", "advance", "decline", "changes", "evidence"))
    parser.add_argument("business_id")
    parser.add_argument("--seconds", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await plan_action(args.action, args.business_id, args.seconds)))
    finally:
        await close_stripe_client()
        await engine.dispose()
