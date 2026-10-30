"""Application payment commands, genuine signed Stripe events and real ledger assertions."""

import asyncio

import httpx
import pytest
import stripe
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from tests.conftest import BIZ, Factory
from tests.helpers import pay_link_card
from tests.sandbox.conftest import StripeEvents, StripeRun

from clientbridge.core.errors import AppError
from clientbridge.models.business import Business, User
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from clientbridge.services import ledger
from clientbridge.services.business import apply_account_status
from clientbridge.services.payments import recover_stripe_source

pytestmark = [pytest.mark.sandbox, pytest.mark.wall_clock]


async def open_invoice(
    api: httpx.AsyncClient, db: AsyncSession, run: StripeRun, events: StripeEvents
) -> tuple[str, str, Payment]:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.stripe_account_id = run.account
    apply_account_status(business, await run.gateway.get_account(run.account))
    response = await api.post(
        "/v1/clients",
        json={
            "name": "QA Customer",
            "phone": "+16045550123",
        },
    )
    assert response.status_code == 201, response.text
    client = await db.get(Client, response.json()["id"])
    assert client is not None
    client.stripe_customer_id = await run.customer()
    await db.flush()
    response = await api.post(
        "/v1/invoices",
        json={
            "client_id": client.id,
            "send": True,
            "lines": [
                {"description": "QA service", "unit_amount_cents": 2000, "tax_class": "exempt"}
            ],
        },
        headers={"Idempotency-Key": f"{run.namespace}:invoice"},
    )
    assert response.status_code == 201, response.text
    invoice_id, token = response.json()["id"], response.json()["pay_token"]
    response = await pay_link_card(api, db, token, tip_cents=0)
    assert response.status_code == 200, response.text
    payment = await db.scalar(select(Payment).where(Payment.invoice_id == invoice_id))
    assert payment is not None and payment.provider_ref is not None
    events.owned.add(payment.provider_ref)
    assert response.json()["stripe_account_id"] == run.account
    assert response.json()["client_secret"].startswith(f"{payment.provider_ref}_secret_")
    return invoice_id, token, payment


async def deliver(api: httpx.AsyncClient, payload: bytes, signature: str) -> None:
    async with asyncio.timeout(30):
        while True:
            response = await api.post(
                "/webhooks/stripe", content=payload, headers={"Stripe-Signature": signature}
            )
            if response.status_code != 503:
                assert response.status_code == 200, response.text
                return
            await asyncio.sleep(0.25)


async def confirm(
    run: StripeRun, payment: Payment, method: str = "pm_card_visa"
) -> stripe.PaymentIntent:
    assert payment.provider_ref is not None
    return await stripe.PaymentIntent.confirm_async(
        payment.provider_ref,
        payment_method=method,
        return_url="https://clientbridge.test/qa-return",
        stripe_account=run.account,
    )


async def test_invoice_signed_webhook_replay_and_partial_refunds(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    invoice_id, token, payment = await open_invoice(as_owner, db, stripe_run, stripe_events)
    before = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    intent = await confirm(stripe_run, payment)
    assert intent.status == "succeeded" and intent.amount == 2000 and intent.currency == "cad"
    assert (await as_owner.get(f"/pay/{token}")).json()["balance_cents"] == 2000
    payload, signature = await stripe_events.next("payment_intent.succeeded")
    assert (
        await as_owner.post(
            "/webhooks/stripe", content=payload, headers={"Stripe-Signature": "invalid"}
        )
    ).status_code == 400
    await deliver(as_owner, payload, signature)
    await deliver(as_owner, payload, signature)
    await db.refresh(payment)
    assert payment.status == "succeeded"
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (2000, False)
    assert (await pay_link_card(as_owner, db, token)).status_code == 409
    assert isinstance(intent.latest_charge, str)
    charge = await stripe.Charge.retrieve_async(
        intent.latest_charge, expand=["balance_transaction"], stripe_account=stripe_run.account
    )
    assert isinstance(charge.balance_transaction, stripe.BalanceTransaction)
    after = await ledger.balance(db, BIZ, owner_type="business", owner_id=BIZ, category="stripe")
    assert after - before == charge.balance_transaction.net
    assert charge.application_fee_amount == intent.application_fee_amount
    journals = await db.scalar(
        select(func.count(func.distinct(Entry.journal_id))).where(
            Entry.ref == f"payment:{payment.id}"
        )
    )
    assert journals == 1
    path = f"/v1/payments/{payment.id}/refund"
    body = {"amount_cents": 500, "notify": False}
    headers = {"Idempotency-Key": f"{stripe_run.namespace}:refund"}
    first = await as_owner.post(path, json=body, headers=headers)
    assert first.status_code == 200, first.text
    assert (await as_owner.post(path, json=body, headers=headers)).json() == first.json()
    assert (
        await as_owner.post(
            path,
            json={"amount_cents": 2000, "notify": False},
            headers={"Idempotency-Key": f"{stripe_run.namespace}:over-refund"},
        )
    ).status_code == 409
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (1500, True)
    rest = await as_owner.post(
        path, json={"notify": False}, headers={"Idempotency-Key": f"{stripe_run.namespace}:rest"}
    )
    assert rest.status_code == 200, rest.text
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (0, True)
    charge = await stripe.Charge.retrieve_async(
        intent.latest_charge, stripe_account=stripe_run.account
    )
    assert charge.amount_refunded == 2000


async def test_decline_leaves_invoice_due_then_retry_settles_once(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    invoice_id, token, payment = await open_invoice(as_owner, db, stripe_run, stripe_events)
    with pytest.raises(stripe.CardError):
        await confirm(stripe_run, payment, "pm_card_chargeDeclined")
    payload, signature = await stripe_events.next("payment_intent.payment_failed")
    await deliver(as_owner, payload, signature)
    assert (await as_owner.get(f"/pay/{token}")).json()["balance_cents"] == 2000
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (0, False)
    response = await pay_link_card(as_owner, db, token)
    assert response.status_code == 200, response.text
    current = await db.scalar(
        select(Payment).where(Payment.invoice_id == invoice_id, Payment.status == "pending")
    )
    assert current is not None and current.provider_ref is not None
    stripe_events.owned.add(current.provider_ref)
    await confirm(stripe_run, current)
    payload, signature = await stripe_events.next("payment_intent.succeeded")
    await deliver(as_owner, payload, signature)
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (2000, False)


async def test_a_card_that_needs_3d_secure_books_nothing_until_it_is_canceled(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    invoice_id, token, payment = await open_invoice(as_owner, db, stripe_run, stripe_events)
    intent = await confirm(stripe_run, payment, "pm_card_threeDSecure2Required")
    assert intent.status == "requires_action"
    assert (await as_owner.get(f"/pay/{token}")).json()["balance_cents"] == 2000
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (0, False)
    assert payment.provider_ref is not None
    await stripe.PaymentIntent.cancel_async(payment.provider_ref, stripe_account=stripe_run.account)
    await deliver(as_owner, *(await stripe_events.next("payment_intent.canceled")))
    await db.refresh(payment)
    assert payment.status == "canceled"
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (0, False)


async def test_withheld_webhook_is_repaired_from_the_owned_charge(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    invoice_id, _, payment = await open_invoice(as_owner, db, stripe_run, stripe_events)
    intent = await confirm(stripe_run, payment)
    payload, signature = await stripe_events.next("payment_intent.succeeded")
    event = stripe_events.gateway.verify_webhook(payload, signature)
    assert isinstance(intent.latest_charge, str)
    for _ in range(2):
        async with asyncio.timeout(30):
            while True:
                try:
                    refs = await recover_stripe_source(
                        db,
                        stripe_run.gateway,
                        BIZ,
                        stripe_run.account,
                        intent.latest_charge,
                        event.created,
                    )
                    break
                except AppError as exc:
                    if exc.status_code != 503 or exc.code != "retry_later":
                        raise
                    await asyncio.sleep(0.25)
        assert f"payment:{payment.id}" in refs
        await db.commit()
    await deliver(as_owner, payload, signature)
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (2000, False)


async def test_external_refund_arrives_through_a_genuine_event(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    invoice_id, _, payment = await open_invoice(as_owner, db, stripe_run, stripe_events)
    await confirm(stripe_run, payment)
    await deliver(as_owner, *(await stripe_events.next("payment_intent.succeeded")))
    assert payment.provider_ref is not None
    refund = await stripe.Refund.create_async(
        payment_intent=payment.provider_ref,
        amount=500,
        stripe_account=stripe_run.account,
        idempotency_key=f"{stripe_run.namespace}:external",
    )
    payload, signature = await stripe_events.next("refund.created")
    await deliver(as_owner, payload, signature)
    await deliver(as_owner, payload, signature)
    assert await ledger.collected(db, BIZ, "invoice", invoice_id) == (1500, True)
    rows = list(await db.scalars(select(Payment).where(Payment.provider_ref == refund.id)))
    assert len(rows) == 1 and rows[0].parent_payment_id == payment.id


async def test_cross_business_refund_does_not_touch_stripe(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    stripe_run: StripeRun,
    stripe_events: StripeEvents,
) -> None:
    _, _, payment = await open_invoice(as_owner, db, stripe_run, stripe_events)
    intent = await confirm(stripe_run, payment)
    await deliver(as_owner, *(await stripe_events.next("payment_intent.succeeded")))
    other = await Factory(db).business()
    owner = await db.get(User, "us_dev")
    assert owner is not None
    await Factory(db).staff(business=other, user=owner, role="owner")
    await db.commit()
    response = await as_owner.post(
        f"/v1/payments/{payment.id}/refund",
        json={"notify": False},
        headers={
            "X-Business-Id": other.id,
            "Idempotency-Key": f"{stripe_run.namespace}:foreign-refund",
        },
    )
    assert response.status_code == 404
    assert isinstance(intent.latest_charge, str)
    charge = await stripe.Charge.retrieve_async(
        intent.latest_charge, stripe_account=stripe_run.account
    )
    assert charge.amount_refunded == 0
