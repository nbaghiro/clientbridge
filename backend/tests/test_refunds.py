"""Partial and multiple refunds: credit notes on the ledger, guarded against over-refunding."""

import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice, Order
from clientbridge.models.catalog import GiftCard, Package
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking
from clientbridge.services import ledger_service as ledger
from clientbridge.services.tax_service import TaxResult
from tests.conftest import BIZ, Factory

GOOD = {"Stripe-Signature": "good"}


async def _enable(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def _client_id(db: AsyncSession) -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    return cid


def _settled(event_id: str, pi: str) -> str:
    return json.dumps(
        {"id": event_id, "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )


async def _paid_invoice(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str]:
    """A sent $100 + $12 tax invoice, paid in full by card and settled."""
    await _enable(db)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await _client_id(db),
        number=9700,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=1200,
        total_cents=11200,
        issued_at=datetime.now(UTC),
    )
    db.add(inv)
    await db.flush()
    await ledger.post_invoice(db, inv, TaxResult(10000, 1200, 11200, {"GST": 1200}, []))
    pay = (await api.post(f"/v1/payments/invoice/{inv.id}")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == pay["payment_id"]))
    ).scalar_one()
    assert pi is not None
    res = await api.post("/webhooks/stripe", content=_settled(f"evt_{inv.id}", pi), headers=GOOD)
    assert res.status_code == 200
    return inv.id, str(pay["payment_id"])


async def _invoice_net(db: AsyncSession, inv_id: str, kind: str) -> int:
    return await ledger.subject_balance(
        db, BIZ, category=kind, subject_type="invoice", subject_id=inv_id
    )


async def _status(db: AsyncSession, inv_id: str) -> str:
    return (
        await db.execute(select(ledger.invoice_status_expr()).where(Invoice.id == inv_id))
    ).scalar_one()


async def _refunds(db: AsyncSession, payment_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Payment)
            .where(Payment.parent_payment_id == payment_id, Payment.kind == "refund")
        )
    ).scalar_one()


async def _order_status(db: AsyncSession, order_id: str) -> str:
    query = select(ledger.order_status_expr()).where(Order.id == order_id)
    return str((await db.execute(query)).scalar_one())


async def test_partial_refunds_unwind_revenue_and_tax_pro_rata(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id, pay_id = await _paid_invoice(as_owner, db)

    first = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=2800")
    assert first.status_code == 200, first.text
    assert await _status(db, inv_id) == "paid"  # a partial credit note leaves it settled
    assert await ledger.collected(db, BIZ, "invoice", inv_id) == (8400, True)
    assert await _invoice_net(db, inv_id, "revenue") == -7500
    assert await _invoice_net(db, inv_id, "tax") == -900

    second = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=5600")
    assert second.status_code == 200, second.text
    assert await _invoice_net(db, inv_id, "revenue") == -2500
    assert await _invoice_net(db, inv_id, "tax") == -300

    rest = await as_owner.post(f"/v1/payments/{pay_id}/refund")  # no amount = what's left
    assert rest.status_code == 200, rest.text
    assert await _status(db, inv_id) == "refunded"
    assert await ledger.collected(db, BIZ, "invoice", inv_id) == (0, True)
    assert await _invoice_net(db, inv_id, "revenue") == 0
    assert await _invoice_net(db, inv_id, "tax") == 0
    assert await _refunds(db, pay_id) == 3


async def test_uneven_partial_refunds_clear_every_cent_of_tax(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id, pay_id = await _paid_invoice(as_owner, db)
    for amount in (3701, 3700):
        res = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents={amount}")
        assert res.status_code == 200, res.text
    assert await _invoice_net(db, inv_id, "tax") == -(1200 - 792)
    assert (await as_owner.post(f"/v1/payments/{pay_id}/refund")).status_code == 200
    assert await _invoice_net(db, inv_id, "tax") == 0
    assert await _invoice_net(db, inv_id, "revenue") == 0


async def test_over_refund_and_bad_amounts_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, pay_id = await _paid_invoice(as_owner, db)
    for amount in (11201, 0, -5):
        res = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents={amount}")
        assert res.status_code == 409, amount
    assert (await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=11000")).is_success
    assert (
        await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=300")
    ).status_code == 409  # only 200 left
    assert (await as_owner.post(f"/v1/payments/{pay_id}/refund")).is_success
    again = await as_owner.post(f"/v1/payments/{pay_id}/refund")
    assert again.status_code == 409  # fully refunded
    assert await _refunds(db, pay_id) == 2


async def test_refund_replay_does_not_refund_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, pay_id = await _paid_invoice(as_owner, db)
    headers = {"Idempotency-Key": "refund-once"}
    url = f"/v1/payments/{pay_id}/refund?amount_cents=1000"
    first = await as_owner.post(url, headers=headers)
    retry = await as_owner.post(url, headers=headers)
    assert first.status_code == retry.status_code == 200
    assert retry.json()["refund_id"] == first.json()["refund_id"]
    assert await _refunds(db, pay_id) == 1


async def test_staff_cannot_refund_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    payment = await _entitlement_payment(db, 5000)
    res = await as_staff.post(f"/v1/payments/{payment.id}/refund?amount_cents=100")
    assert res.status_code == 403
    assert await _refunds(db, payment.id) == 0


async def test_other_business_payment_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await _enable(db)
    other = await factory.business()
    client = await factory.client(business=other)
    foreign = Payment(
        id=new_id("payment"),
        business_id=other.id,
        client_id=client.id,
        kind="payment",
        amount_cents=5000,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref="pi_foreign_refund",
        status="succeeded",
    )
    db.add(foreign)
    await db.flush()
    res = await as_owner.post(f"/v1/payments/{foreign.id}/refund?amount_cents=100")
    assert res.status_code == 404


async def test_order_stays_paid_until_fully_refunded(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    line = {"description": "Latte", "quantity": 2, "unit_amount_cents": 500}
    order = (await as_owner.post("/v1/orders", json={"lines": [line]})).json()
    checkout = (await as_owner.post(f"/v1/orders/{order['id']}/checkout")).json()
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == checkout["payment_id"]))
    ).scalar_one()
    assert pi is not None
    await as_owner.post("/webhooks/stripe", content=_settled("evt_ord_ref", pi), headers=GOOD)
    total = order["total_cents"]

    part = await as_owner.post(f"/v1/payments/{checkout['payment_id']}/refund?amount_cents=300")
    assert part.status_code == 200, part.text
    status = (
        await db.execute(select(ledger.order_status_expr()).where(Order.id == order["id"]))
    ).scalar_one()
    assert status == "paid"
    assert await ledger.collected(db, BIZ, "order", order["id"]) == (total - 300, True)

    assert (await as_owner.post(f"/v1/payments/{checkout['payment_id']}/refund")).is_success
    status = (
        await db.execute(select(ledger.order_status_expr()).where(Order.id == order["id"]))
    ).scalar_one()
    assert status == "refunded"
    assert await ledger.collected(db, BIZ, "order", order["id"]) == (0, True)


async def _entitlement_payment(db: AsyncSession, amount: int) -> Payment:
    payment = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=await _client_id(db),
        kind="payment",
        amount_cents=amount,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=f"pi_{new_id('payment')[4:16]}",
        status="succeeded",
        paid_at=datetime.now(UTC),
    )
    db.add(payment)
    await db.flush()
    return payment


async def test_gift_card_purchase_refunds_in_full_only(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    payment = await _entitlement_payment(db, 5000)
    card = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code="REFUND-GC-01",
        initial_cents=5000,
        status="active",
        payment_id=payment.id,
    )
    db.add(card)
    await db.flush()
    await ledger.post_payment(db, payment)
    await db.commit()  # the 409 below rolls the request back; keep the setup
    pay_id, card_id = payment.id, card.id

    part = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=1000")
    assert part.status_code == 409
    assert part.json()["message"] == "a gift card purchase is refunded in full"
    full = await as_owner.post(f"/v1/payments/{pay_id}/refund")
    assert full.status_code == 200, full.text
    card = (await db.execute(select(GiftCard).where(GiftCard.id == card_id))).scalar_one()
    assert await ledger.gift_card_balance(db, card) == 0
    status = (await db.execute(select(GiftCard.status).where(GiftCard.id == card_id))).scalar_one()
    assert status == "void"


async def test_package_purchase_refunds_in_full_only(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    payment = await _entitlement_payment(db, 5600)
    package = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=payment.client_id,
        item_id="it_pkg5",
        sessions_total=5,
        status="active",
        payment_id=payment.id,
    )
    db.add(package)
    await db.flush()
    await ledger.post_payment(db, payment)
    await db.commit()  # the 409 below rolls the request back; keep the setup
    pay_id, package_id = payment.id, package.id

    part = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=1000")
    assert part.status_code == 409
    assert part.json()["message"] == "a package purchase is refunded in full"
    assert (await as_owner.post(f"/v1/payments/{pay_id}/refund")).status_code == 200
    deferred = await ledger.balance(
        db, BIZ, owner_type="package", owner_id=package_id, category="deferred"
    )
    assert deferred == 0


async def test_forfeited_deposit_refunds_in_full_only(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    booking_id = (
        (await db.execute(select(Booking.id).where(Booking.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert booking_id
    await db.execute(
        update(Booking).where(Booking.id == booking_id).values(deposit_status="forfeited")
    )
    deposit = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=await _client_id(db),
        kind="deposit",
        booking_id=booking_id,
        amount_cents=2000,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref="pi_forfeited_dep",
        status="succeeded",
    )
    db.add(deposit)
    await db.flush()
    res = await as_owner.post(f"/v1/payments/{deposit.id}/refund?amount_cents=500")
    assert res.status_code == 409
    assert res.json()["message"] == "a forfeited deposit is refunded in full"


def _refund_event(
    event_id: str, pi: str, refund_id: str, amount: int, *, status: str = "succeeded"
) -> str:
    return json.dumps(
        {
            "id": event_id,
            "type": "refund.created",
            "data": {
                "object": {
                    "id": refund_id,
                    "object": "refund",
                    "payment_intent": pi,
                    "amount": amount,
                    "status": status,
                }
            },
        }
    )


async def test_stripe_side_refunds_record_each_object_once(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    payment = await _entitlement_payment(db, 5000)
    pi = str(payment.provider_ref)
    for event_id, refund_id, amount in [("evt_a", "re_a", 2000), ("evt_b", "re_b", 1000)]:
        body = _refund_event(event_id, pi, refund_id, amount)
        assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    assert await _refunds(db, payment.id) == 2
    await api.post(
        "/webhooks/stripe", content=_refund_event("evt_a", pi, "re_a", 2000), headers=GOOD
    )
    updated = _refund_event("evt_a_upd", pi, "re_a", 2000).replace(
        "refund.created", "refund.updated"
    )
    await api.post("/webhooks/stripe", content=updated, headers=GOOD)
    assert await _refunds(db, payment.id) == 2
    amounts = (
        (
            await db.execute(
                select(Payment.amount_cents)
                .where(Payment.parent_payment_id == payment.id)
                .order_by(Payment.amount_cents)
            )
        )
        .scalars()
        .all()
    )
    assert list(amounts) == [1000, 2000]


async def test_failed_stripe_side_refund_records_nothing(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    payment = await _entitlement_payment(db, 5000)
    body = _refund_event("evt_fail", str(payment.provider_ref), "re_fail", 2000, status="failed")
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    assert await _refunds(db, payment.id) == 0


async def test_stripe_side_refund_skips_one_we_already_recorded(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, pay_id = await _paid_invoice(as_owner, db)
    ours = await as_owner.post(f"/v1/payments/{pay_id}/refund?amount_cents=2000")
    assert ours.status_code == 200
    our_ref = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == ours.json()["refund_id"]))
    ).scalar_one()
    pi = str(
        (await db.execute(select(Payment.provider_ref).where(Payment.id == pay_id))).scalar_one()
    )
    for event_id, refund_id, amount in [
        ("evt_ours", str(our_ref), 2000),
        ("evt_dash", "re_dash", 1500),
    ]:
        body = _refund_event(event_id, pi, refund_id, amount)
        assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200
    assert await _refunds(db, pay_id) == 2


async def test_used_package_cannot_be_refunded(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    payment = await _entitlement_payment(db, 5600)
    package = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=payment.client_id,
        item_id="it_pkg5",
        sessions_total=5,
        status="active",
        payment_id=payment.id,
    )
    db.add(package)
    await db.flush()
    await ledger.post_payment(db, payment)
    for _ in range(2):
        await ledger.post_consumption(db, package)
    res = await as_owner.post(f"/v1/payments/{payment.id}/refund")
    assert res.status_code == 409
    assert res.json()["message"] == "can't refund a package with sessions already used"
