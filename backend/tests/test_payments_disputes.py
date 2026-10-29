"""Lost disputes unwind only what a sale still carries, and disputed payments can't be refunded."""

import json
from collections.abc import Mapping, Sequence

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import GiftCard
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Device
from clientbridge.services import ledger
from clientbridge.services.tax import TaxResult
from tests.conftest import BIZ, FakePushSender
from tests.helpers import STRIPE as GOOD
from tests.helpers import (
    booking_off_the_ledger,
    business_balance,
    card_pay,
    client_id,
    enable_payments,
    settle,
)
from tests.helpers import key as retry_key


async def _paid_invoice(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str]:
    """A $100 + $12 tax invoice, paid in full by card and settled."""
    await enable_payments(db)
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=await client_id(db),
        number=9800,
        status="sent",
        currency="CAD",
        subtotal_cents=10000,
        tax_total_cents=1200,
        total_cents=11200,
        issued_at=clock.now(),
    )
    db.add(inv)
    await db.flush()
    await ledger.post_invoice(db, inv, TaxResult(10000, 1200, 11200, {"GST": 1200}, []))
    pay_id = await card_pay(api, db, inv.id)
    await settle(api, db, pay_id)
    return inv.id, pay_id


async def _invoice_net(db: AsyncSession, inv_id: str, category: str) -> int:
    return await ledger.subject_balance(
        db, BIZ, category=category, subject_type="invoice", subject_id=inv_id
    )


async def _purchase(db: AsyncSession, amount: int, booking_id: str | None = None) -> Payment:
    payment = Payment(
        id=new_id("payment"),
        business_id=BIZ,
        client_id=await client_id(db),
        kind="deposit" if booking_id else "payment",
        booking_id=booking_id,
        amount_cents=amount,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=f"pi_{new_id('payment')[4:16]}",
        status="succeeded",
        paid_at=clock.now(),
    )
    db.add(payment)
    await db.flush()
    return payment


def _dispute(
    event_id: str,
    pi: str,
    status: str,
    amount: int,
    event: str = "closed",
    txns: Sequence[Mapping[str, object]] | None = None,
    dispute: str | None = None,
) -> str:
    obj: dict[str, object] = {
        "id": dispute or f"du_{event_id}",
        "payment_intent": pi,
        "amount": amount,
        "status": status,
    }
    if txns is not None:
        obj["balance_transactions"] = txns
    return json.dumps({"id": event_id, "type": f"charge.dispute.{event}", "data": {"object": obj}})


async def _loss(db: AsyncSession) -> int:
    return await business_balance(db, "loss")


async def _intent(db: AsyncSession, payment_id: str) -> str:
    pi = await db.scalar(select(Payment.provider_ref).where(Payment.id == payment_id))
    assert pi is not None
    return pi


async def test_a_dispute_lost_after_a_full_refund_is_a_loss_not_negative_sales(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id, pay_id = await _paid_invoice(as_owner, db)
    refund = await as_owner.post(f"/v1/payments/{pay_id}/refund", json={}, headers=retry_key())
    assert refund.status_code == 200, refund.text
    before = await _loss(db)
    lost = _dispute("evt_lost_after_refund", await _intent(db, pay_id), "lost", 11200)
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    assert await _invoice_net(db, inv_id, "revenue") == 0
    assert await _invoice_net(db, inv_id, "tax") == 0
    assert await _loss(db) - before == 11200
    again = await api.post("/webhooks/stripe", content=lost, headers=GOOD)
    assert again.status_code == 200
    assert await _loss(db) - before == 11200


async def test_a_dispute_lost_after_a_partial_refund_unwinds_the_rest_and_loses_the_overlap(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    inv_id, pay_id = await _paid_invoice(as_owner, db)
    refund = await as_owner.post(
        f"/v1/payments/{pay_id}/refund", json={"amount_cents": 5600}, headers=retry_key()
    )
    assert refund.status_code == 200, refund.text
    before = await _loss(db)
    lost = _dispute("evt_lost_after_part", await _intent(db, pay_id), "lost", 11200)
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    assert await _invoice_net(db, inv_id, "revenue") == 0
    assert await _invoice_net(db, inv_id, "tax") == 0
    assert await _loss(db) - before == 5600


async def test_a_lost_dispute_that_reinstates_the_refunded_part_loses_only_the_rest(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Stripe disputes the whole charge after a partial refund and gives the refunded part back."""
    inv_id, pay_id = await _paid_invoice(as_owner, db)
    refund = await as_owner.post(
        f"/v1/payments/{pay_id}/refund", json={"amount_cents": 5600}, headers=retry_key()
    )
    assert refund.status_code == 200, refund.text
    loss, stripe = await _loss(db), await business_balance(db, "stripe")
    pi = await _intent(db, pay_id)
    pulled = {"id": "txn_whole_out", "amount": -11200, "fee": 1500, "net": -12700}
    back = {"id": "txn_part_back", "amount": 5600, "fee": 0, "net": 5600}
    lost = _dispute("evt_whole_lost", pi, "lost", 11200, txns=[pulled], dispute="du_whole")
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    assert await _loss(db) - loss == 5600
    for event_id in ("evt_part_back", "evt_part_back_again"):
        reinstated = _dispute(
            event_id, pi, "lost", 11200, "funds_reinstated", [pulled, back], dispute="du_whole"
        )
        response = await api.post("/webhooks/stripe", content=reinstated, headers=GOOD)
        assert response.status_code == 200
        assert await _loss(db) == loss
        assert await business_balance(db, "stripe") == stripe - 12700 + 5600
    assert await _invoice_net(db, inv_id, "revenue") == 0
    assert await _invoice_net(db, inv_id, "tax") == 0


async def test_a_dispute_lost_on_a_part_used_gift_card_loses_the_used_part(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    payment = await _purchase(db, 5000)
    card = GiftCard(
        id=new_id("gift_card"),
        business_id=BIZ,
        code="DISPUTE-GC-01",
        initial_cents=5000,
        status="active",
        payment_id=payment.id,
    )
    db.add(card)
    await db.flush()
    await ledger.post_payment(db, payment)
    await ledger.post_redemption(db, card, 3000)
    before = await _loss(db)
    lost = _dispute("evt_lost_card", await _intent(db, payment.id), "lost", 5000)
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    await db.refresh(card)
    assert await ledger.gift_card_balance(db, card) == 0
    assert card.status == "void"
    assert await _loss(db) - before == 3000


async def test_a_dispute_lost_on_a_forfeited_deposit_takes_back_the_forfeit(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    booking = await booking_off_the_ledger(db)
    deposit = await _purchase(db, 2000, booking.id)
    await ledger.post_payment(db, deposit)
    await ledger.post_forfeit(db, booking)
    lost = _dispute("evt_lost_deposit", await _intent(db, deposit.id), "lost", 2000)
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    await db.refresh(booking)
    assert await ledger.deposit_held(db, booking) == 0
    revenue = await ledger.subject_balance(
        db, BIZ, category="revenue", subject_type="booking", subject_id=booking.id
    )
    assert revenue == 0
    assert booking.deposit_status == "refunded"


async def test_an_open_or_lost_dispute_refuses_a_refund_and_a_won_one_allows_it(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, pay_id = await _paid_invoice(as_owner, db)
    pi = await _intent(db, pay_id)
    opened = _dispute("evt_open_refund", pi, "needs_response", 11200, "created")
    assert (await api.post("/webhooks/stripe", content=opened, headers=GOOD)).status_code == 200
    res = await as_owner.post(
        f"/v1/payments/{pay_id}/refund", json={"amount_cents": 1000}, headers=retry_key()
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "payment_disputed"
    preview = await as_owner.get(f"/v1/payments/{pay_id}/refund-preview")
    assert preview.status_code == 200
    assert preview.json()["blocked"] is not None
    won = _dispute("evt_won_refund", pi, "won", 11200)
    assert (await api.post("/webhooks/stripe", content=won, headers=GOOD)).status_code == 200
    res = await as_owner.post(
        f"/v1/payments/{pay_id}/refund", json={"amount_cents": 1000}, headers=retry_key()
    )
    assert res.status_code == 200, res.text


async def test_an_inquiry_alerts_staff_once_and_books_nothing(
    api: httpx.AsyncClient, db: AsyncSession, push: FakePushSender
) -> None:
    payment = await _purchase(db, 4500)
    db.add(Device(id="dvt_inq", business_id=BIZ, user_id="us_dev", token="ExpoInq", platform="ios"))
    await db.flush()
    before = await business_balance(db, "stripe")
    asked = _dispute(
        "evt_inq_alert", await _intent(db, payment.id), "warning_needs_response", 4500, "created"
    )
    for _ in range(2):
        assert (await api.post("/webhooks/stripe", content=asked, headers=GOOD)).status_code == 200
    alerts = [p for p in push.sent if "bank asked" in p.body]
    assert len(alerts) == 1
    assert await business_balance(db, "stripe") == before


async def test_a_prevented_dispute_books_nothing_and_leaves_the_payment_refundable(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    payment = await _purchase(db, 4500)
    before = await business_balance(db, "stripe")
    intent = await _intent(db, payment.id)
    for verb in ("created", "closed"):
        event = _dispute(f"evt_prevented_{verb}", intent, "prevented", 4500, verb)
        assert (await api.post("/webhooks/stripe", content=event, headers=GOOD)).status_code == 200
    assert await business_balance(db, "stripe") == before
    await db.refresh(payment)
    assert payment.dispute_status is None


async def test_a_lost_dispute_reads_as_money_back_not_lower_sales(
    as_owner: httpx.AsyncClient, api: httpx.AsyncClient, db: AsyncSession
) -> None:
    _, pay_id = await _paid_invoice(as_owner, db)
    day = clock.now().date().isoformat()

    async def income() -> dict[str, int]:
        res = await as_owner.get(f"/v1/reports/summary?start={day}&end={day}")
        assert res.status_code == 200, res.text
        return res.json()["income"]

    before = await income()
    lost = _dispute("evt_lost_report", await _intent(db, pay_id), "lost", 11200)
    assert (await api.post("/webhooks/stripe", content=lost, headers=GOOD)).status_code == 200
    after = await income()
    assert after["sales_cents"] == before["sales_cents"]
    assert after["refunds_cents"] - before["refunds_cents"] == 10000
