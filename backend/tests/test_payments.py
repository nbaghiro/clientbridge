import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.services import ledger
from tests.conftest import Factory, book_invoice
from tests.helpers import card_pay, enable_payments, sent_invoice

BIZ = "bz_birchbark"


def _pi_event(
    event_id: str, pi_id: str, *, kind: str = "payment_intent.succeeded", fee: int = 0
) -> str:
    body: dict[str, object] = {
        "id": event_id,
        "type": kind,
        "data": {"object": {"id": pi_id, "application_fee_amount": fee}},
    }
    return json.dumps(body)


async def _provider_ref(db: AsyncSession, payment_id: str) -> str:
    ref = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    assert ref
    return ref


async def _charge_saved_card(
    api: httpx.AsyncClient, db: AsyncSession, invoice_id: str, amount: int, idem: str = "card"
) -> httpx.Response:
    inv = await db.get(Invoice, invoice_id)
    assert inv is not None
    pm = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.client_id == inv.client_id))
    ).scalar()
    if pm is None:
        await db.execute(
            update(Client).where(Client.id == inv.client_id).values(stripe_customer_id="cus_pay")
        )
        pm = PaymentMethod(
            id=new_id("payment_method"),
            business_id=BIZ,
            client_id=inv.client_id,
            method="card",
            provider="stripe",
            provider_ref="pm_pay",
            status="active",
        )
        db.add(pm)
        await db.flush()
    body = {"method": "card", "amount_cents": amount, "payment_method_id": pm.id}
    return await api.post(
        f"/v1/invoices/{invoice_id}/payments", json=body, headers={"Idempotency-Key": idem}
    )


async def test_pay_link_creates_intent(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = (
        await db.execute(select(Payment).where(Payment.id == await card_pay(as_owner, db, inv_id)))
    ).scalar_one()
    assert pay.status == "pending" and pay.amount_cents == 11200
    assert pay.provider_ref is not None and pay.provider_ref.startswith("pi_fake")


async def test_succeeded_webhook_marks_invoice_paid(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi_id = await _provider_ref(db, pay["payment_id"])
    res = await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_p1", pi_id), headers={"Stripe-Signature": "good"}
    )
    assert res.status_code == 200
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (await ledger.invoice_state(db, inv))[0] == "paid"
    assert await ledger.invoice_balance(db, inv) == 0
    assert await ledger.collected(db, BIZ, "invoice", inv_id) == (11200, False)


async def test_settlement_books_stripe_and_platform_fees(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # Stripe's processing fee and our application fee both come off the provider's balance
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi_id = await _provider_ref(db, pay["payment_id"])
    res = await as_owner.post(
        "/webhooks/stripe",
        content=_pi_event("evt_fee", pi_id, fee=250),
        headers={"Stripe-Signature": "good"},
    )
    assert res.status_code == 200
    row = (await db.execute(select(Payment).where(Payment.id == pay["payment_id"]))).scalar_one()
    assert row.status == "succeeded"
    legs = (
        await db.execute(
            select(Account.owner_type, Account.category, func.sum(Entry.amount_cents))
            .join(Account, Account.id == Entry.account_id)
            .where(Entry.source_id == row.id)
            .group_by(Account.owner_type, Account.category)
        )
    ).tuples()
    by_kind = {(owner, kind): int(cents) for owner, kind, cents in legs}
    assert by_kind[("business", "processing_fee")] == 355  # 2.9% + 30c
    assert by_kind[("business", "platform_fee")] == 224  # the 2% application fee
    assert by_kind[("business", "stripe")] == 11200 - 355 - 224
    assert by_kind[("platform", "fee_revenue")] == -224


async def test_partial_payment_marks_invoice_partial(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=10000)
    pay = (await _charge_saved_card(as_owner, db, inv_id, 4000)).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_pp", pi_id), headers={"Stripe-Signature": "good"}
    )
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (await ledger.invoice_state(db, inv))[0] == "partial"
    assert await ledger.collected(db, BIZ, "invoice", inv_id) == (4000, False)
    assert await ledger.invoice_balance(db, inv) == 6000


async def test_refund_credits_the_invoice(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_r1", pi_id), headers={"Stripe-Signature": "good"}
    )
    refunded = await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund", json={})
    assert refunded.status_code == 200
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert (await ledger.invoice_state(db, inv))[0] == "refunded"
    assert await ledger.invoice_balance(db, inv) == 0  # a credit note: nothing is owed again
    assert await ledger.collected(db, BIZ, "invoice", inv_id) == (0, True)
    assert (
        await ledger.subject_balance(
            db, BIZ, category="revenue", subject_type="invoice", subject_id=inv_id
        )
        == 0
    )


async def test_double_refund_rejected(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_dr", pi_id), headers={"Stripe-Signature": "good"}
    )
    assert (
        await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund", json={})
    ).status_code == 200
    again = await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund", json={})
    assert again.status_code == 409  # a fresh-key second refund — no second real refund


async def test_refund_same_idempotency_key_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    # a retried refund (same Idempotency-Key) replays the original 200, not a 409, and mints one row
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_ri", pi_id), headers={"Stripe-Signature": "good"}
    )
    headers = {"Idempotency-Key": "refund-key-1"}
    first = await as_owner.post(
        f"/v1/payments/{pay['payment_id']}/refund", json={}, headers=headers
    )
    second = await as_owner.post(
        f"/v1/payments/{pay['payment_id']}/refund", json={}, headers=headers
    )
    assert first.status_code == 200 and second.status_code == 200, second.text
    assert first.json()["refund_id"] == second.json()["refund_id"]
    refunds = (
        await db.execute(
            select(func.count())
            .select_from(Payment)
            .where(Payment.parent_payment_id == pay["payment_id"], Payment.kind == "refund")
        )
    ).scalar_one()
    assert refunds == 1


async def test_pending_payment_blocks_overpay(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    await card_pay(as_owner, db, inv_id)  # full balance
    # a second method while the first is still pending would overpay → rejected
    interac = await as_owner.post(f"/v1/invoices/{inv_id}/interac-request", json={})
    assert interac.status_code == 409


async def test_failed_webhook_marks_payment_failed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_event("evt_f1", pi_id, kind="payment_intent.payment_failed"),
        headers={"Stripe-Signature": "good"},
    )
    pmt = (await db.execute(select(Payment).where(Payment.id == pay["payment_id"]))).scalar_one()
    assert pmt.status == "failed"
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert inv.status == "sent"  # unchanged


async def test_canceled_intent_frees_room(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=11200)
    pay = {"payment_id": await card_pay(as_owner, db, inv_id)}
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_event("evt_c1", pi_id, kind="payment_intent.canceled"),
        headers={"Stripe-Signature": "good"},
    )
    pmt = (await db.execute(select(Payment).where(Payment.id == pay["payment_id"]))).scalar_one()
    assert pmt.status == "canceled"
    # the pending row no longer reserves the balance, so another method can take it
    interac = await as_owner.post(f"/v1/invoices/{inv_id}/interac-request", json={})
    assert interac.status_code == 200, interac.text


async def test_cannot_pay_when_not_onboarded(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_charges_enabled=False)
    )
    inv_id = await sent_invoice(db, number=9001, total=11200, pay_token="tok-not-onboarded")
    res = await as_owner.post("/pay/tok-not-onboarded/card", json={})
    assert res.status_code == 409
    assert (
        await db.execute(select(Payment.id).where(Payment.invoice_id == inv_id))
    ).first() is None


async def test_cannot_pay_void_invoice(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    await sent_invoice(db, number=9001, total=11200, status="void", pay_token="tok-void")
    assert (await as_owner.post("/pay/tok-void/card", json={})).status_code == 409


async def test_staff_cannot_charge_a_saved_card(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id = await sent_invoice(db, number=9001, total=11200)
    body = {"method": "card", "amount_cents": 1000, "payment_method_id": "default"}
    res = await as_staff.post(f"/v1/invoices/{inv_id}/payments", json=body)
    assert res.status_code == 403


async def test_distinct_partials_same_amount_not_deduped(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=10000)
    r1 = await _charge_saved_card(as_owner, db, inv_id, 4000, "k1")
    r2 = await _charge_saved_card(as_owner, db, inv_id, 4000, "k2")
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    assert r1.json()["payment_id"] != r2.json()["payment_id"]
    ref1 = await _provider_ref(db, r1.json()["payment_id"])
    ref2 = await _provider_ref(db, r2.json()["payment_id"])
    assert ref1 != ref2  # two distinct Stripe intents, no silent under-collection


async def test_same_key_partial_is_deduped(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    inv_id = await sent_invoice(db, number=9001, total=10000)
    r1 = await _charge_saved_card(as_owner, db, inv_id, 4000, "same")
    r2 = await _charge_saved_card(as_owner, db, inv_id, 4000, "same")
    assert r1.json()["payment_id"] == r2.json()["payment_id"]  # one charge for a true retry


async def _foreign_invoice(db: AsyncSession, factory: Factory) -> str:
    other = await factory.business()
    client = await factory.client(business=other)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=other.id,
        client_id=client.id,
        number=9300,
        status="sent",
        currency="CAD",
        subtotal_cents=5000,
        tax_total_cents=0,
        total_cents=5000,
    )
    db.add(inv)
    await db.flush()
    await book_invoice(db, inv)
    return inv.id


async def test_pay_foreign_invoice_404_by_scoping(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    # BIZ is onboarded, so the 404 comes from the business-scoped lookup, not a missing id
    await enable_payments(db)
    foreign_inv = await _foreign_invoice(db, factory)
    body = {"method": "card", "amount_cents": 1000, "payment_method_id": "default"}
    res = await as_owner.post(f"/v1/invoices/{foreign_inv}/payments", json=body)
    assert res.status_code == 404
    interac = await as_owner.post(f"/v1/invoices/{foreign_inv}/interac-request", json={})
    assert interac.status_code == 404
    # the foreign invoice is untouched — no payment was minted against it
    minted = (
        await db.execute(select(Payment.id).where(Payment.invoice_id == foreign_inv))
    ).scalar_one_or_none()
    assert minted is None


async def test_refund_foreign_payment_404_by_scoping(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    other = await factory.business()
    client = await factory.client(business=other)
    foreign_pay = Payment(
        id=new_id("payment"),
        business_id=other.id,
        client_id=client.id,
        kind="payment",
        amount_cents=5000,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref="pi_foreign",
        status="succeeded",
        paid_at=datetime.now(UTC),
    )
    db.add(foreign_pay)
    await db.flush()
    res = await as_owner.post(f"/v1/payments/{foreign_pay.id}/refund", json={})
    assert res.status_code == 404  # scoped out, not refunded across the tenant boundary
    # no refund row was created and the foreign payment is still a clean succeeded charge
    refund = (
        await db.execute(select(Payment.id).where(Payment.parent_payment_id == foreign_pay.id))
    ).scalar_one_or_none()
    assert refund is None
    still = await db.get(Payment, foreign_pay.id)
    assert still is not None and still.status == "succeeded"
