"""Observe both subjects and every payment-source journal for one owned deposit journey."""

import argparse
import asyncio
import json

import stripe
from sqlalchemy import text

from clientbridge.core.db import engine
from clientbridge.integrations.stripe import close_stripe_client
from scripts.e2e_stripe_browser import BUSINESS, guard
from scripts.e2e_stripe_deposits import DepositFixture, deposit_tags, load_deposit
from scripts.e2e_stripe_setup import identity, state_path


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


async def provider_evidence(account: str, fixture: DepositFixture, run: str) -> dict[str, object]:
    if fixture.customer is None:
        raise ValueError("deposit customer must be registered before observation")
    customer = await stripe.Customer.retrieve_async(fixture.customer, stripe_account=account)
    if customer.livemode or customer.to_dict().get("metadata") != deposit_tags(
        run, fixture.booking, fixture.client
    ):
        raise ValueError("deposit customer ownership mismatch")
    intents: list[dict[str, object]] = []
    refunds: list[dict[str, object]] = []
    fees: dict[str, object] | None = None
    remote = await stripe.PaymentIntent.list_async(
        customer=fixture.customer, stripe_account=account
    )
    async for intent in remote.auto_paging_iter():
        metadata = intent.to_dict().get("metadata", {})
        if (
            intent.livemode
            or intent.customer != fixture.customer
            or metadata.get("business_id") != BUSINESS
            or metadata.get("booking_id") != fixture.booking
            or intent.amount != 2000
            or intent.currency != "cad"
        ):
            raise ValueError("deposit customer has an intent outside this owned booking")
        intents.append(
            {
                "id": intent.id,
                "status": intent.status,
                "amount": intent.amount,
                "currency": intent.currency,
                "livemode": intent.livemode,
                "metadata": metadata,
            }
        )
        if isinstance(intent.latest_charge, str):
            charge = await stripe.Charge.retrieve_async(
                intent.latest_charge, expand=["balance_transaction"], stripe_account=account
            )
            if charge.livemode or charge.payment_intent != intent.id or charge.amount != 2000:
                raise ValueError("deposit charge ownership mismatch")
            transaction = charge.balance_transaction
            if isinstance(transaction, str):
                transaction = await stripe.BalanceTransaction.retrieve_async(
                    transaction, stripe_account=account
                )
            if charge.paid and isinstance(transaction, stripe.BalanceTransaction):
                if fees is not None:
                    raise ValueError("more than one charged intent for the owned deposit")
                processing = sum(
                    d.amount for d in transaction.fee_details if d.type != "application_fee"
                )
                application = sum(
                    d.amount for d in transaction.fee_details if d.type == "application_fee"
                )
                if (
                    transaction.amount != 2000
                    or transaction.currency != "cad"
                    or transaction.fee != processing + application
                    or transaction.net != 2000 - processing - application
                    or (intent.application_fee_amount or 0) != application
                ):
                    raise ValueError("provider gross, fees and net do not reconcile")
                fees = {
                    "processingCents": processing,
                    "applicationCents": application,
                    "grossCents": transaction.amount,
                    "feeCents": transaction.fee,
                    "netCents": transaction.net,
                    "balanceTransactionId": transaction.id,
                    "chargeId": charge.id,
                }
        listed = await stripe.Refund.list_async(payment_intent=intent.id, stripe_account=account)
        async for refund in listed.auto_paging_iter():
            if refund.payment_intent != intent.id or refund.currency != "cad":
                raise ValueError("refund ownership mismatch")
            refunds.append(
                {
                    "id": refund.id,
                    "payment_intent": intent.id,
                    "status": refund.status,
                    "amount": refund.amount,
                    "currency": refund.currency,
                }
            )
    return {"intents": intents, "refunds": refunds, "fees": fees}


async def evidence(booking_id: str) -> dict[str, object]:
    account = guard()
    state = json.loads(state_path().read_text())
    expected = identity(account)
    if any(state.get(key) != value for key, value in expected.items()):
        raise ValueError("fixture manifest identity mismatch")
    fixture = load_deposit(state, booking_id)
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        ready = await db.scalar(
            text(
                "SELECT COUNT(*) FROM businesses b JOIN clients c ON c.business_id=b.id "
                "WHERE b.id=:business AND b.stripe_account_id=:account "
                "AND b.stripe_charges_enabled AND b.stripe_payouts_enabled "
                "AND c.id=:client AND c.stripe_customer_id=:customer"
            ),
            {
                "business": BUSINESS,
                "account": account,
                "client": fixture.client,
                "customer": fixture.customer,
            },
        )
        if ready != 1:
            raise ValueError("registered provider customer and local business do not match")
    result = await raw_evidence(BUSINESS, fixture.client, fixture.booking, fixture.invoice)
    result["provider"] = await provider_evidence(account, fixture, str(expected["run_id"]))
    return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("booking_id")
    args = parser.parse_args()
    try:
        print(json.dumps(await evidence(args.booking_id), default=str))
    finally:
        await close_stripe_client()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
