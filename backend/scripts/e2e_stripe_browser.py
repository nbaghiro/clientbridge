"""Read committed DB and Stripe evidence without mutating provider or application state."""

import argparse
import asyncio
import json
import os
from urllib.parse import urlparse

import stripe
from sqlalchemy import text

from clientbridge.core.config import get_settings
from clientbridge.core.db import engine
from clientbridge.integrations.stripe import STRIPE_API_VERSION, close_stripe_client
from scripts.demo_context import FIXTURE_BUSINESS, run_id
from scripts.stripe_qa import preflight

BUSINESS = run_id(FIXTURE_BUSINESS)


def guard() -> str:
    settings = get_settings()
    database = urlparse(settings.database_url)
    if (
        os.environ.get("STRIPE_BROWSER_E2E") != "1"
        or settings.env != "dev"
        or database.hostname not in ("localhost", "127.0.0.1")
        or database.path != "/clientbridge_test_e2e"
        or urlparse(settings.smtp_url or "").hostname not in ("localhost", "127.0.0.1", "mailpit")
        or not settings.stripe_secret_key.startswith(("sk_test_", "rk_test_"))
        or settings.stripe_secret_key != os.environ.get("STRIPE_TEST_SECRET_KEY")
        or not settings.stripe_webhook_secret.startswith("whsec_")
    ):
        raise ValueError(
            "requires isolated local provider API/database, test credentials and Mailpit"
        )
    account = os.environ["STRIPE_TEST_CONNECTED_ACCOUNT"]
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = STRIPE_API_VERSION
    return account


async def evidence(invoice_id: str | None, receipts: bool = False) -> dict[str, object]:
    account = guard()
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        business = (
            (
                await db.execute(
                    text(
                        "SELECT stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled "
                        "FROM businesses WHERE id = :id"
                    ),
                    {"id": BUSINESS},
                )
            )
            .mappings()
            .one()
        )
        if business["stripe_account_id"] != account or not (
            business["stripe_charges_enabled"] and business["stripe_payouts_enabled"]
        ):
            raise ValueError("runner must bind the isolated business to the ready QA merchant")
        if invoice_id is None:
            await preflight(dict(os.environ))
            return {"ready": True, "account": account, "business": BUSINESS}
        invoice = (
            (
                await db.execute(
                    text(
                        "SELECT id, business_id, client_id FROM invoices "
                        "WHERE id = :id AND business_id = :business"
                    ),
                    {"id": invoice_id, "business": BUSINESS},
                )
            )
            .mappings()
            .one()
        )
        if receipts:
            rows = await db.execute(
                text(
                    "SELECT d.id, d.key, d.state, p.id AS payment_id FROM deliveries d "
                    "JOIN payments p ON d.key LIKE 'stripe:payment:' || p.id || ':%' "
                    "WHERE p.invoice_id=:id AND p.business_id=:business "
                    "AND d.business_id=:business AND d.payload->>'channel'='email' ORDER BY d.id"
                ),
                {"id": invoice_id, "business": BUSINESS},
            )
            return {"receipts": [dict(row) for row in rows.mappings()]}
        payments = [
            dict(row)
            for row in (
                await db.execute(
                    text(
                        "SELECT id, status, amount_cents, currency, tip_cents, "
                        "provider, provider_ref, "
                        "kind FROM payments WHERE invoice_id = :id AND business_id = :business "
                        "ORDER BY id"
                    ),
                    {"id": invoice_id, "business": BUSINESS},
                )
            ).mappings()
        ]
        entries = [
            dict(row)
            for row in (
                await db.execute(
                    text(
                        "SELECT e.journal_id, e.ref, e.amount_cents, e.currency, a.category, "
                        "a.owner_type, a.owner_id FROM entries e "
                        "JOIN accounts a ON a.id=e.account_id "
                        "WHERE e.source_type='payment' AND e.source_id IN "
                        "(SELECT id FROM payments WHERE invoice_id=:id AND business_id=:business) "
                        "ORDER BY e.ref, e.leg"
                    ),
                    {"id": invoice_id, "business": BUSINESS},
                )
            ).mappings()
        ]
        customer = await db.scalar(
            text("SELECT stripe_customer_id FROM clients WHERE id=:id AND business_id=:business"),
            {"id": invoice["client_id"], "business": BUSINESS},
        )
        if not isinstance(customer, str):
            raise ValueError("invoice fixture has no registered provider customer")
        remote_intents = await stripe.PaymentIntent.list_async(
            customer=customer, stripe_account=account
        )
        provider_intent_ids: list[str] = []
        async for remote in remote_intents.auto_paging_iter():
            metadata = remote.to_dict().get("metadata", {})
            if remote.livemode or metadata.get("invoice_id") != invoice_id:
                raise ValueError("fixture customer has an intent outside this invoice")
            provider_intent_ids.append(remote.id)
        provider: list[dict[str, object]] = []
        webhook_ids: list[str] = []
        for payment in payments:
            identity = payment["provider_ref"]
            if not isinstance(identity, str) or not identity.startswith("pi_"):
                continue
            intent = await stripe.PaymentIntent.retrieve_async(identity, stripe_account=account)
            if intent.livemode:
                raise ValueError("live payment evidence is forbidden")
            details = intent.to_dict()
            last_error = details.get("last_payment_error") or {}
            next_action = details.get("next_action") or {}
            item: dict[str, object] = {
                "id": intent.id,
                "status": intent.status,
                "livemode": intent.livemode,
                "amount": intent.amount,
                "currency": intent.currency,
                "application_fee_amount": intent.application_fee_amount,
                "account": account,
                "error_code": last_error.get("code"),
                "decline_code": last_error.get("decline_code"),
                "next_action_type": next_action.get("type"),
            }
            if isinstance(intent.latest_charge, str):
                charge = await stripe.Charge.retrieve_async(
                    intent.latest_charge, expand=["balance_transaction"], stripe_account=account
                )
                transaction = charge.balance_transaction
                authentication = (
                    charge.to_dict()
                    .get("payment_method_details", {})
                    .get("card", {})
                    .get("three_d_secure")
                )
                item.update(
                    {
                        "charge": charge.id,
                        "charge_paid": charge.paid,
                        "amount_captured": charge.amount_captured,
                        "amount_refunded": charge.amount_refunded,
                        "three_d_secure": {
                            key: authentication.get(key)
                            for key in ("result", "version", "authentication_flow")
                        }
                        if authentication
                        else None,
                    }
                )
                if isinstance(transaction, stripe.BalanceTransaction):
                    item.update({"net": transaction.net, "fee": transaction.fee})
            events = await stripe.Event.list_async(
                created={"gte": intent.created},
                limit=100,
                stripe_account=account,
            )
            async for event in events.auto_paging_iter():
                if (
                    event.type
                    in (
                        "payment_intent.succeeded",
                        "payment_intent.payment_failed",
                        "payment_intent.canceled",
                    )
                    and event.data.object.id == intent.id
                ):
                    webhook_ids.append(event.id)
            provider.append(item)
        webhooks = [
            dict(row)
            for row in (
                await db.execute(
                    text(
                        "SELECT id, event, status, processed_at IS NOT NULL AS processed "
                        "FROM webhooks WHERE id = ANY(CAST(:ids AS text[])) ORDER BY id"
                    ),
                    {"ids": webhook_ids},
                )
            ).mappings()
        ]
        return {
            "invoice": dict(invoice),
            "payments": payments,
            "entries": entries,
            "stripe": provider,
            "provider_intent_ids": sorted(provider_intent_ids),
            "webhooks": webhooks,
        }


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("invoice_id", nargs="?")
    parser.add_argument("--receipts", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.invoice_id, args.receipts)))
    finally:
        await close_stripe_client()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
