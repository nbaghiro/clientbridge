"""Client fixtures on the QA merchant: purchasers, test clocks and subscriptions."""

import argparse
import asyncio
import json
import os
import time
from pathlib import Path
from typing import cast

import stripe
from pydantic import BaseModel, ConfigDict, TypeAdapter

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import (
    close_stripe_client,
)
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from e2e.stripe_context import BUSINESS, run_state, save, validate_context
from e2e.stripe_deposits import deposit_fixtures
from e2e.stripe_evidence import charge_evidence


class ClientFixture(BaseModel):
    """A client whose purchases have no invoice or booking: gift cards and memberships."""

    model_config = ConfigDict(extra="forbid")
    client: str
    customer: str | None = None
    clock: str | None = None


def client_fixtures(state: dict[str, object], *, complete: bool = False) -> list[ClientFixture]:
    fixtures = TypeAdapter(list[ClientFixture]).validate_python(state.get("client_fixtures", []))
    for field in ("client", "customer", "clock"):
        values = [value for f in fixtures if (value := getattr(f, field)) is not None]
        if len(values) != len(set(values)):
            raise ValueError("duplicate client fixture lineage; cannot prove cleanup")
    if complete and any(f.customer is None for f in fixtures):
        raise ValueError("incomplete client fixture lineage; cannot prove cleanup")
    return fixtures


def client_tags(run: str, client: str, environment: str | None = None) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": environment
        or os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_purchaser": client,
        "clientbridge_qa_client": client,
    }


def clock_name(run: str, client: str) -> str:
    return f"clientbridge-qa {run} {client}"


async def owned_subscriptions(
    account: str, fixture: ClientFixture, business: str
) -> list[stripe.Subscription]:
    if fixture.customer is None:
        raise ValueError("client fixture has no customer")
    listed = await stripe.Subscription.list_async(
        customer=fixture.customer, status="all", stripe_account=account
    )
    owned: list[stripe.Subscription] = []
    async for subscription in listed.auto_paging_iter():
        metadata = subscription.to_dict().get("metadata", {})
        if (
            subscription.livemode
            or metadata.get("business_id") != business
            or metadata.get("client_id") != fixture.client
        ):
            raise ValueError("client fixture customer has a subscription outside this run")
        owned.append(subscription)
    return owned


async def invoice_intents(
    account: str, subscriptions: list[stripe.Subscription], *, apply: bool = False
) -> set[str]:
    """The intents Stripe opened for the owned subscriptions' invoices, voiding unpaid ones."""
    intents: set[str] = set()
    for subscription in subscriptions:
        invoices = await stripe.Invoice.list_async(
            subscription=subscription.id, stripe_account=account
        )
        async for invoice in invoices.auto_paging_iter():
            # an invoice's own intent can't be canceled; voiding the invoice cancels it
            if apply and invoice.status == "open":
                await stripe.Invoice.void_invoice_async(invoice.id, stripe_account=account)
            payments = await stripe.InvoicePayment.list_async(
                invoice=invoice.id, stripe_account=account
            )
            async for payment in payments.auto_paging_iter():
                intent = payment.to_dict().get("payment", {}).get("payment_intent")
                if isinstance(intent, str):
                    intents.add(intent)
    return intents


def save_clients(path: Path, state: dict[str, object], fixtures: list[ClientFixture]) -> None:
    state["client_fixtures"] = [fixture.model_dump(exclude_none=True) for fixture in fixtures]
    client_fixtures(state)
    save(path, state)


async def register_purchaser(
    path: Path, state: dict[str, object], account: str, client_id: str, *, clocked: bool
) -> ClientFixture:
    """File a client before the app makes its customer, on a test clock for memberships."""
    run = str(state["run_id"])
    fixtures = client_fixtures(state)
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if business is None or business.stripe_account_id != account:
            raise ValueError("isolated business is not bound to the QA merchant")
        client = await db.get(Client, client_id)
        if client is None or client.business_id != BUSINESS or client.deleted_at is not None:
            raise ValueError("client does not belong to the fixture business")
        if client.stripe_customer_id is not None:
            raise ValueError("refusing to adopt a pre-existing provider customer")
        taken = [
            *(row.get("client") for row in cast(list[dict[str, str]], state["fixtures"])),
            *(fixture.client for fixture in deposit_fixtures(state)),
            *(fixture.client for fixture in fixtures),
        ]
        if client_id in taken:
            raise ValueError("client already belongs to a fixture")
        fixture = ClientFixture(client=client_id)
        fixtures.append(fixture)
        save_clients(path, state, fixtures)  # lineage before any provider write
        expected = client_tags(run, client_id)
        key = f"browser:{run}:client:{client_id}"
        if clocked:
            created = await stripe.test_helpers.TestClock.create_async(
                frozen_time=int(clock.wall().timestamp()),
                name=clock_name(run, client_id),
                stripe_account=account,
                idempotency_key=f"{key}:clock",
            )
            fixture.clock = created.id
            save_clients(path, state, fixtures)
            customer = await stripe.Customer.create_async(
                name=client.name,
                metadata=expected,
                test_clock=created.id,
                stripe_account=account,
                idempotency_key=f"{key}:customer",
            )
        else:
            customer = await stripe.Customer.create_async(
                name=client.name,
                metadata=expected,
                stripe_account=account,
                idempotency_key=f"{key}:customer",
            )
        if customer.livemode or customer.to_dict().get("metadata") != expected:
            raise ValueError("client fixture customer ownership mismatch")
        fixture.customer = customer.id
        save_clients(path, state, fixtures)
        client.stripe_customer_id = customer.id
        await db.commit()
        return fixture


async def advance_clock(account: str, run: str, fixture: ClientFixture, seconds: int) -> int:
    if fixture.clock is None or seconds <= 0:
        raise ValueError("only a clock-bound client fixture can move forward")
    current = await stripe.test_helpers.TestClock.retrieve_async(
        fixture.clock, stripe_account=account
    )
    if (
        current.livemode
        or current.name != clock_name(run, fixture.client)
        or current.status != "ready"
    ):
        raise ValueError("the client fixture clock is not this run's or is still moving")
    target = current.frozen_time + seconds
    await stripe.test_helpers.TestClock.advance_async(
        fixture.clock, frozen_time=target, stripe_account=account
    )
    deadline = time.monotonic() + 300
    while current.status != "ready" or current.frozen_time != target:
        if current.status == "internal_failure" or time.monotonic() > deadline:
            raise TimeoutError("the sandbox test clock did not finish advancing")
        await asyncio.sleep(2)
        current = await stripe.test_helpers.TestClock.retrieve_async(
            fixture.clock, stripe_account=account
        )
    return target


async def client_action(action: str, client_id: str, seconds: int) -> dict[str, object]:
    account = await validate_context()
    path, state = run_state(account)
    run = str(state["run_id"])
    if action in ("register", "register-clock"):
        fixture = await register_purchaser(
            path, state, account, client_id, clocked=action == "register-clock"
        )
        return {**fixture.model_dump(), "account": account}
    matches = [f for f in client_fixtures(state, complete=True) if f.client == client_id]
    if len(matches) != 1:
        raise ValueError("client is not one registered client fixture")
    fixture = matches[0]
    if action == "advance":
        return {
            "clock": fixture.clock,
            "frozen_time": await advance_clock(account, run, fixture, seconds),
        }
    subscriptions = await owned_subscriptions(account, fixture, BUSINESS)
    if action == "decline":
        live = [s for s in subscriptions if s.status in ("active", "past_due")]
        if len(live) != 1 or fixture.customer is None:
            raise ValueError("the client fixture has no single live membership")
        # Stripe's always-declining test card stands in for a card the issuer starts refusing
        method = await stripe.PaymentMethod.attach_async(
            "pm_card_chargeCustomerFail", customer=fixture.customer, stripe_account=account
        )
        updated = await stripe.Subscription.modify_async(
            live[0].id, default_payment_method=method.id, stripe_account=account
        )
        return {"subscription": updated.id, "payment_method": method.id}
    renewals: list[dict[str, object]] = []
    for subscription in subscriptions:
        invoices = await stripe.Invoice.list_async(
            subscription=subscription.id, stripe_account=account
        )
        async for invoice in invoices.auto_paging_iter():
            details = invoice.to_dict()
            charges: list[dict[str, object]] = []
            payments = await stripe.InvoicePayment.list_async(
                invoice=invoice.id, stripe_account=account
            )
            async for payment in payments.auto_paging_iter():
                intent_id = payment.to_dict().get("payment", {}).get("payment_intent")
                if not isinstance(intent_id, str):
                    continue
                intent = await stripe.PaymentIntent.retrieve_async(
                    intent_id, stripe_account=account
                )
                charge = (
                    await charge_evidence(account, intent.latest_charge)
                    if isinstance(intent.latest_charge, str)
                    else None
                )
                charges.append({"intent": intent.id, "status": intent.status, "charge": charge})
            renewals.append(
                {
                    **{key: details.get(key) for key in ("id", "status", "billing_reason")},
                    **{
                        key: details.get(key)
                        for key in ("amount_due", "amount_paid", "attempt_count")
                    },
                    **{key: details.get(key) for key in ("period_start", "period_end", "created")},
                    "subscription": subscription.id,
                    "payments": charges,
                }
            )
    return {
        "subscriptions": [{"id": s.id, "status": s.status} for s in subscriptions],
        "invoices": sorted(renewals, key=lambda row: int(cast(int, row["created"]))),
    }


async def clients_main(argv: list[str]) -> None:
    """Register a gift card or membership client, move its test clock, or read its renewals."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe clients")
    parser.add_argument(
        "action", choices=("register", "register-clock", "advance", "decline", "evidence")
    )
    parser.add_argument("client_id")
    parser.add_argument("--seconds", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await client_action(args.action, args.client_id, args.seconds)))
    finally:
        await close_stripe_client()
        await engine.dispose()
