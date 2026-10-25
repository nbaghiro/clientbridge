"""Manage run-owned sandbox fixtures under the runner-held merchant lease."""

import argparse
import asyncio
import fcntl
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import stripe
from sqlalchemy import select

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import StripeGateway, close_stripe_client
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.services.business import apply_account_status
from scripts.e2e_stripe_browser import BUSINESS, guard
from scripts.stripe_qa import preflight


def state_path() -> Path:
    requested = Path(os.environ["STRIPE_BROWSER_STATE_FILE"])
    path = requested.resolve()
    scratch = Path(__file__).resolve().parents[2] / ".scratchpad"
    if not path.is_relative_to(scratch) or requested.is_symlink():
        raise ValueError("fixture manifest must be a run-owned path under repo .scratchpad")
    return path


def identity(account: str) -> dict[str, object]:
    run = str(UUID(os.environ["STRIPE_BROWSER_RUN_ID"]))
    database = urlparse(get_settings().database_url)
    return {
        "run_id": run,
        "account": account,
        "platform": os.environ["STRIPE_TEST_PLATFORM"],
        "business": BUSINESS,
        "database": {
            "host": database.hostname,
            "port": database.port,
            "name": database.path,
        },
    }


def save(path: Path, state: dict[str, object]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def tags(run: str, invoice: str, client: str) -> dict[str, str]:
    return {
        "clientbridge_qa": "payments",
        "clientbridge_qa_environment": os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local"),
        "clientbridge_qa_run": run,
        "clientbridge_qa_invoice": invoice,
        "clientbridge_qa_client": client,
    }


async def cleanup_intent(
    account: str,
    intent: stripe.PaymentIntent,
    metadata: dict[str, str],
    *,
    apply: bool = True,
) -> dict[str, object]:
    if intent.livemode:
        raise ValueError("live provider cleanup is forbidden")
    if intent.status == "succeeded":
        if not isinstance(intent.latest_charge, str):
            raise ValueError("successful intent has no charge")
        charge = await stripe.Charge.retrieve_async(intent.latest_charge, stripe_account=account)
        if charge.livemode or charge.payment_intent != intent.id or charge.amount != intent.amount:
            raise ValueError("charge does not match the owned intent")
        refunds = await stripe.Refund.list_async(charge=charge.id, stripe_account=account)
        refunded = 0
        async for refund in refunds.auto_paging_iter():
            if refund.status == "succeeded":
                refunded += refund.amount
            elif refund.status not in ("failed", "canceled"):
                raise ValueError("owned charge has an unsettled refund; retry after settlement")
        remaining = charge.amount - charge.amount_refunded
        if remaining == 0:
            if refunded != charge.amount:
                raise ValueError("fully refunded charge lacks settled refund evidence")
            return {"intent": intent.id, "status": "already_refunded"}
        if remaining < 0 or refunded != charge.amount_refunded:
            raise ValueError("charge and settled refunds disagree")
        if not apply:
            return {
                "intent": intent.id,
                "status": "planned_refund",
                "amount_cents": remaining,
            }
        refund = await stripe.Refund.create_async(
            payment_intent=intent.id,
            amount=remaining,
            refund_application_fee=True,
            metadata=metadata,
            stripe_account=account,
            idempotency_key=f"browser:{metadata['clientbridge_qa_run']}:{intent.id}:cleanup:{remaining}",
        )
        if refund.status != "succeeded":
            raise ValueError("owned refund is not settled; cleanup needs retry")
        return {"intent": intent.id, "refund": refund.id, "status": refund.status}
    if intent.status == "canceled":
        return {"intent": intent.id, "status": "already_canceled"}
    if intent.status in (
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
        "requires_capture",
    ):
        if not apply:
            return {"intent": intent.id, "status": "planned_cancel"}
        canceled = await stripe.PaymentIntent.cancel_async(intent.id, stripe_account=account)
        if canceled.status != "canceled":
            raise ValueError("owned intent cancellation did not complete")
        return {"intent": intent.id, "status": canceled.status}
    raise ValueError("owned intent is processing; defer cleanup rather than guessing")


def validate_cleanup_fixtures(fixtures: list[dict[str, str]]) -> None:
    for field in ("invoice", "client", "customer"):
        values = [fixture.get(field) for fixture in fixtures]
        if any(not value for value in values) or len(values) != len(set(values)):
            raise ValueError("incomplete or duplicate fixture lineage; cannot prove cleanup")


async def validate_context() -> str:
    account = guard()
    lease = Path(__file__).resolve().parents[2] / ".scratchpad/stripe-qa.lock"
    with lease.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass  # The parent runner must hold this lease until cleanup finishes.
        else:
            fcntl.flock(lock, fcntl.LOCK_UN)
            raise ValueError("runner must hold the shared Stripe QA merchant lease")
    await preflight(dict(os.environ))
    environment = os.environ.get("STRIPE_BROWSER_ENVIRONMENT", "local")
    if environment not in ("local", "ci"):
        raise ValueError("browser fixtures require a dedicated local or CI merchant environment")
    for merchant_id, slot in (
        (account, "a"),
        (os.environ["STRIPE_TEST_OTHER_ACCOUNT"], "b"),
    ):
        merchant = await stripe.Account.retrieve_async(merchant_id)
        metadata = merchant.to_dict().get("metadata", {})
        if (
            metadata.get("clientbridge_qa_environment") != environment
            or metadata.get("clientbridge_qa_slot") != slot
        ):
            raise ValueError("browser fixture merchant environment/slot ownership mismatch")
    return account


async def operate(action: str, invoice_id: str | None) -> dict[str, object]:
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
                email=client.email or "",
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
        from scripts.e2e_stripe_deposits import cleanup_deposits, deposit_fixtures

        validate_cleanup_fixtures(fixtures)
        deposits = deposit_fixtures(state, complete=True)
        invoice_customers = {fixture["customer"] for fixture in fixtures}
        deposit_customers = {fixture.customer for fixture in deposits}
        if invoice_customers & deposit_customers:
            raise ValueError("invoice and deposit fixtures cannot share customers")
        actions = await cleanup_deposits(db, state, account)
        seen_customers: set[str] = set()
        customers = await stripe.Customer.list_async(limit=100, stripe_account=account)
        async for customer in customers.auto_paging_iter():
            customer_tags = customer.to_dict().get("metadata", {})
            if customer_tags.get("clientbridge_qa_run") != run:
                continue
            if customer.id in deposit_customers:
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


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "register", "cleanup"))
    parser.add_argument("invoice_id", nargs="?")
    args = parser.parse_args()
    if args.action == "register" and args.invoice_id is None:
        parser.error("register requires invoice_id")
    try:
        print(json.dumps(await operate(args.action, args.invoice_id)))
    finally:
        await close_stripe_client()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
