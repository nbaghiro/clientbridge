"""Prepare and clean up the fixtures a Stripe browser run uses on the QA merchant."""

import argparse
import json

import stripe
from sqlalchemy import select

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import (
    StripeGateway,
    close_stripe_client,
)
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.services.business import apply_account_status
from e2e.stripe_cleanup import cleanup_intent
from e2e.stripe_clients import client_fixtures
from e2e.stripe_context import BUSINESS, identity, save, state_path, tags, validate_context
from e2e.stripe_deposits import cleanup_deposits, deposit_fixtures
from e2e.stripe_reconcile import reconciled_at_prepare
from e2e.stripe_recovery import clean_client


def validate_cleanup_fixtures(fixtures: list[dict[str, str]]) -> None:
    for field in ("invoice", "client", "customer"):
        values = [fixture.get(field) for fixture in fixtures]
        if any(not value for value in values) or len(values) != len(set(values)):
            raise ValueError("incomplete or duplicate fixture lineage; cannot prove cleanup")


async def setup_action(action: str, invoice_id: str | None) -> dict[str, object]:
    account = await validate_context()
    settings = get_settings()
    gateway = StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret, "CA")
    path = state_path()
    expected = identity(account)
    state: dict[str, object]
    if path.exists():
        state = json.loads(path.read_text())
        if any(state.get(key) != value for key, value in expected.items()):
            raise ValueError("fixture manifest belongs to another run/database/merchant")
    elif action == "prepare":
        path.parent.mkdir(parents=True, exist_ok=True)
        state = {**expected, "fixtures": []}
        with path.open("x") as file:
            file.write(json.dumps(state))
        path.chmod(0o600)
    else:
        raise ValueError("prepare must create the ownership manifest first")
    fixtures = state.get("fixtures")
    if not isinstance(fixtures, list):
        raise ValueError("invalid ownership manifest")
    run = str(state["run_id"])
    async with SessionLocal() as db:
        business = await db.get(Business, BUSINESS)
        if business is None:
            raise ValueError("isolated seed business is missing")
        if action == "prepare":
            if fixtures or state.get("deposit_fixtures"):
                raise ValueError("cannot rebind a business after registering fixtures")
            status = await gateway.get_account(account)
            if not status.charges_enabled or not status.payouts_enabled:
                raise ValueError("v2 merchant is not ready")
            business.stripe_account_id = account
            apply_account_status(business, status)
            db.add(await reconciled_at_prepare(account))
            await db.commit()
            return {"prepared": True, **expected}
        if business.stripe_account_id != account:
            raise ValueError("isolated business merchant binding changed")
        if action == "register":
            invoice = await db.get(Invoice, invoice_id)
            if invoice is None or invoice.business_id != BUSINESS:
                raise ValueError("invoice does not belong to the isolated fixture business")
            client = await db.get(Client, invoice.client_id)
            if client is None or client.business_id != BUSINESS:
                raise ValueError("invoice customer ownership mismatch")
            owned_tags = tags(run, invoice.id, client.id)
            fixture = next((f for f in fixtures if f.get("invoice") == invoice.id), None)
            if fixture is None:
                if client.stripe_customer_id is not None:
                    raise ValueError("refusing to adopt a pre-existing provider customer")
                fixture = {"invoice": invoice.id, "client": client.id}
                fixtures.append(fixture)
                save(
                    path, state
                )  # Record lineage before any provider write, including crash recovery.
            if fixture["client"] != client.id:
                raise ValueError("registered invoice customer changed")
            customer = await stripe.Customer.create_async(
                name=client.name,
                metadata=owned_tags,
                stripe_account=account,
                idempotency_key=f"browser:{run}:{invoice.id}:customer",
            )
            if customer.livemode or customer.to_dict().get("metadata") != owned_tags:
                raise ValueError("provider customer ownership mismatch")
            if client.stripe_customer_id not in (None, customer.id):
                raise ValueError("refusing to replace another provider customer")
            fixture["customer"] = customer.id
            save(path, state)
            client.stripe_customer_id = customer.id
            await db.commit()
            return {"registered": True, "invoice": invoice.id, "customer": customer.id}

        validate_cleanup_fixtures(fixtures)
        deposits = deposit_fixtures(state, complete=True)
        invoice_customers = {fixture["customer"] for fixture in fixtures}
        deposit_customers = {fixture.customer for fixture in deposits}
        if invoice_customers & deposit_customers:
            raise ValueError("invoice and deposit fixtures cannot share customers")
        purchasers = client_fixtures(state, complete=True)
        client_customers = {fixture.customer for fixture in purchasers}
        if client_customers & (invoice_customers | deposit_customers):
            raise ValueError("client fixtures cannot share customers with other fixtures")
        for purchaser in purchasers:
            client = await db.get(Client, purchaser.client)
            if (
                client is None
                or client.business_id != BUSINESS
                or client.stripe_customer_id not in (None, purchaser.customer)
            ):
                raise ValueError("client fixture DB ownership changed; refusing provider cleanup")
            await clean_client(account, run, purchaser, apply=False)
        actions = await cleanup_deposits(db, state, account)
        for purchaser in purchasers:
            actions.extend(await clean_client(account, run, purchaser, apply=True))
        seen_customers: set[str] = set()
        customers = await stripe.Customer.list_async(limit=100, stripe_account=account)
        async for customer in customers.auto_paging_iter():
            customer_tags = customer.to_dict().get("metadata", {})
            if customer_tags.get("clientbridge_qa_run") != run:
                continue
            if customer.id in deposit_customers or customer.id in client_customers:
                continue
            fixture = next(
                (
                    f
                    for f in fixtures
                    if f.get("invoice") == customer_tags.get("clientbridge_qa_invoice")
                ),
                None,
            )
            if fixture is None or customer_tags != tags(run, fixture["invoice"], fixture["client"]):
                raise ValueError("run-tagged customer lacks exact registered fixture lineage")
            if customer.livemode or fixture.get("customer", customer.id) != customer.id:
                raise ValueError("registered customer identity mismatch")
            seen_customers.add(customer.id)
            invoice = await db.get(Invoice, fixture["invoice"])
            client = await db.get(Client, fixture["client"])
            if (
                invoice is None
                or client is None
                or invoice.business_id != BUSINESS
                or invoice.client_id != client.id
                or client.stripe_customer_id not in (None, customer.id)
            ):
                raise ValueError("fixture DB ownership changed; refusing provider cleanup")
            intents = await stripe.PaymentIntent.list_async(
                customer=customer.id, stripe_account=account
            )
            async for intent in intents.auto_paging_iter():
                intent_tags = intent.to_dict().get("metadata", {})
                if (
                    intent.livemode
                    or intent.customer != customer.id
                    or intent_tags.get("invoice_id") != invoice.id
                    or intent_tags.get("business_id") != BUSINESS
                    or intent.amount != 2000
                    or intent.currency != "cad"
                ):
                    raise ValueError("customer has an intent outside this exact invoice fixture")
                local = await db.scalar(select(Payment).where(Payment.provider_ref == intent.id))
                if local is not None and (
                    local.invoice_id != invoice.id or local.business_id != BUSINESS
                ):
                    raise ValueError("provider intent maps to another local payment")
                actions.append(
                    await cleanup_intent(account, intent, tags(run, invoice.id, client.id))
                )
        expected_customers = {f["customer"] for f in fixtures if "customer" in f}
        if not expected_customers.issubset(seen_customers):
            raise ValueError("registered provider customer is missing; cannot prove cleanup")
        state["cleanup"] = actions
        save(path, state)
        # Retain tagged customers for diagnostics. Never delete application or unrelated data.
        return {"cleaned": True, "actions": actions, "retained_tagged_customers": True}


async def setup_main(argv: list[str]) -> None:
    """Manage run-owned sandbox fixtures under the runner-held merchant lease."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe setup")
    parser.add_argument("action", choices=("prepare", "register", "cleanup"))
    parser.add_argument("invoice_id", nargs="?")
    args = parser.parse_args(argv)
    if args.action == "register" and args.invoice_id is None:
        parser.error("register requires invoice_id")
    try:
        print(json.dumps(await setup_action(args.action, args.invoice_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()
