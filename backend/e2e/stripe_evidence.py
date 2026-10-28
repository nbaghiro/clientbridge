"""What Stripe and the ledger hold for an invoice or charge, which browser cases assert against."""

import argparse
import json
import os
from typing import cast

import stripe
from scripts.stripe_qa import preflight
from sqlalchemy import text

from clientbridge.core.db import engine
from clientbridge.integrations.stripe import (
    close_stripe_client,
)
from e2e.stripe_context import BUSINESS, guard


async def invoice_evidence(invoice_id: str | None, receipts: bool = False) -> dict[str, object]:
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
                    "AND d.business_id=:business AND d.payload->>'channel'='sms' ORDER BY d.id"
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


async def browser_main(argv: list[str]) -> None:
    """Read committed DB and Stripe evidence without mutating provider or app state."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe browser")
    parser.add_argument("invoice_id", nargs="?")
    parser.add_argument("--receipts", action="store_true")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(await invoice_evidence(args.invoice_id, args.receipts)))
    finally:
        await close_stripe_client()
        await engine.dispose()


async def raw_evidence(
    business: str, client: str, booking: str, invoice: str | None
) -> dict[str, object]:
    params = {"business": business, "client": client, "booking": booking, "invoice": invoice}
    owned_payments = "SELECT id FROM payments WHERE business_id=:business "
    owned_payments += "AND (client_id=:client OR booking_id=:booking OR invoice_id=:invoice)"
    journals = "SELECT DISTINCT journal_id FROM entries WHERE business_id=:business AND ("
    journals += "(subject_type='booking' AND subject_id IN "
    journals += "(SELECT id FROM bookings WHERE business_id=:business AND client_id=:client)) OR "
    journals += "(subject_type='invoice' AND subject_id IN "
    journals += "(SELECT id FROM invoices WHERE business_id=:business AND client_id=:client)) OR "
    journals += "(owner_type='client' AND owner_id=:client) OR "
    journals += f"(source_type='payment' AND source_id IN ({owned_payments})))"
    queries = {
        "documents": "SELECT id FROM invoices WHERE business_id=:business "
        "AND client_id=:client ORDER BY id",
        "owned_bookings": "SELECT id FROM bookings WHERE business_id=:business "
        "AND client_id=:client ORDER BY id",
        "booking": "SELECT id, business_id, client_id, invoice_id, deposit_amount_cents, "
        "deposit_status FROM bookings WHERE id=:booking",
        "invoice": "SELECT id, business_id, client_id, number, status, subtotal_cents, "
        "tax_total_cents, total_cents, currency FROM invoices WHERE id=:invoice",
        "lines": "SELECT id, item_id, booking_id, quantity, unit_amount_cents, tax_amount_cents, "
        "tax_class FROM lines WHERE invoice_id=:invoice ORDER BY id",
        "payments": "SELECT id, business_id, client_id, kind, status, method, provider, "
        "invoice_id, booking_id, parent_payment_id, amount_cents, tip_cents, currency, "
        f"provider_ref, credit_note FROM payments WHERE id IN ({owned_payments}) ORDER BY id",
        "entries": "SELECT e.id, e.business_id, e.journal_id, e.ref, e.leg, e.event, "
        "e.source_type, e.source_id, e.subject_type, e.subject_id, e.amount_cents, e.currency, "
        "e.owner_type AS entry_owner_type, e.owner_id AS entry_owner_id, e.account_id, "
        "a.business_id AS account_business_id, a.owner_type, a.owner_id, a.category, a.code "
        "FROM entries e JOIN accounts a ON a.id=e.account_id "
        f"WHERE e.journal_id IN ({journals}) ORDER BY e.ref, e.leg",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result: dict[str, object] = {"businessId": business}
        for key, query in queries.items():
            rows = [dict(row) for row in (await db.execute(text(query), params)).mappings()]
            if key in ("booking", "invoice"):
                if key == "invoice" and invoice is None:
                    result[key] = None
                    continue
                if (
                    len(rows) != 1
                    or rows[0]["business_id"] != business
                    or rows[0]["client_id"] != client
                ):
                    raise RuntimeError("owned booking/invoice lineage mismatch")
                result[key] = rows[0]
            else:
                result[key] = rows
        return result


def transaction_row(row: dict[str, object]) -> dict[str, object]:
    details = row.get("fee_details")
    return {
        **{key: row.get(key) for key in ("id", "type", "reporting_category", "source")},
        **{key: row.get(key) for key in ("amount", "fee", "net", "created")},
        "fee_details": [
            {"type": fee.get("type"), "amount": fee.get("amount")}
            for fee in cast(list[dict[str, object]], details if isinstance(details, list) else [])
        ],
    }


async def charge_evidence(account: str, charge_id: str) -> dict[str, object]:
    """A charge with every balance transaction Stripe booked for it, its refunds and disputes."""
    charge = await stripe.Charge.retrieve_async(
        charge_id, expand=["balance_transaction"], stripe_account=account
    )
    if charge.livemode:
        raise ValueError("live charge evidence is forbidden")
    found = charge.to_dict()
    transactions: list[dict[str, object]] = []
    if isinstance(own := found.get("balance_transaction"), dict):
        transactions.append(transaction_row(cast(dict[str, object], own)))
    refunds: list[dict[str, object]] = []
    listed = await stripe.Refund.list_async(charge=charge_id, stripe_account=account)
    async for refund in listed.auto_paging_iter():
        details = refund.to_dict()
        refunds.append(
            {key: details.get(key) for key in ("id", "amount", "status", "failure_reason")}
        )
        for key in ("balance_transaction", "failure_balance_transaction"):
            if isinstance(identity := details.get(key), str):
                row = await stripe.BalanceTransaction.retrieve_async(
                    identity, stripe_account=account
                )
                transactions.append(transaction_row(row.to_dict()))
    disputes: list[dict[str, object]] = []
    listed_disputes = await stripe.Dispute.list_async(charge=charge_id, stripe_account=account)
    async for dispute in listed_disputes.auto_paging_iter():
        details = dispute.to_dict()
        disputes.append({key: details.get(key) for key in ("id", "status", "amount", "reason")})
        for row in cast(list[dict[str, object]], details.get("balance_transactions") or []):
            transactions.append(transaction_row(row))
    return {
        "charge": {
            "id": charge.id,
            "amount": charge.amount,
            "amount_refunded": charge.amount_refunded,
            "disputed": found.get("disputed"),
            "application_fee_amount": found.get("application_fee_amount"),
        },
        "refunds": refunds,
        "disputes": disputes,
        "transactions": sorted(transactions, key=lambda row: str(row["id"])),
        "net_cents": sum(int(cast(int, row["net"])) for row in transactions),
    }
