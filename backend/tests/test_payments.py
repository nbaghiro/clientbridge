import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment

BIZ = "bz_birchbark"


async def _enable_payments(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def _invoice(db: AsyncSession, *, total: int = 11200, status: str = "sent") -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    inv = Invoice(
        id=new_id("invoice"),
        business_id=BIZ,
        client_id=cid,
        number=9001,
        status=status,
        currency="CAD",
        subtotal_cents=total,
        tax_total_cents=0,
        total_cents=total,
        balance_cents=total,
    )
    db.add(inv)
    await db.flush()
    return inv.id


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


async def test_pay_invoice_creates_intent(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db)
    res = await as_owner.post(f"/v1/payments/invoice/{inv_id}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["amount_cents"] == 11200
    assert body["client_secret"].startswith("pi_fake")
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert pay.status == "pending"
    assert pay.provider_ref is not None and pay.provider_ref.startswith("pi_fake")


async def test_succeeded_webhook_marks_invoice_paid(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    res = await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_p1", pi_id), headers={"Stripe-Signature": "good"}
    )
    assert res.status_code == 200
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert inv.status == "paid"
    assert inv.balance_cents == 0
    assert inv.amount_paid_cents == 11200


async def test_partial_payment_marks_invoice_partial(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db, total=10000)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}?amount_cents=4000")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_pp", pi_id), headers={"Stripe-Signature": "good"}
    )
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert inv.status == "partial"
    assert inv.amount_paid_cents == 4000
    assert inv.balance_cents == 6000


async def test_refund_reverts_invoice(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_r1", pi_id), headers={"Stripe-Signature": "good"}
    )
    refunded = await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund")
    assert refunded.status_code == 200
    inv = (await db.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one()
    assert inv.status == "sent"
    assert inv.amount_paid_cents == 0
    assert inv.balance_cents == 11200


async def test_double_refund_rejected(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe", content=_pi_event("evt_dr", pi_id), headers={"Stripe-Signature": "good"}
    )
    assert (await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund")).status_code == 200
    again = await as_owner.post(f"/v1/payments/{pay['payment_id']}/refund")
    assert again.status_code == 409  # already refunded — no second real refund


async def test_pending_payment_blocks_overpay(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db)
    assert (
        await as_owner.post(f"/v1/payments/invoice/{inv_id}")
    ).status_code == 200  # full balance
    # a second method while the first is still pending would overpay → rejected
    assert (await as_owner.post(f"/v1/payments/invoice/{inv_id}/interac")).status_code == 409


async def test_failed_webhook_marks_payment_failed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
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
    await _enable_payments(db)
    inv_id = await _invoice(db)
    pay = (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).json()
    pi_id = await _provider_ref(db, pay["payment_id"])
    await as_owner.post(
        "/webhooks/stripe",
        content=_pi_event("evt_c1", pi_id, kind="payment_intent.canceled"),
        headers={"Stripe-Signature": "good"},
    )
    pmt = (await db.execute(select(Payment).where(Payment.id == pay["payment_id"]))).scalar_one()
    assert pmt.status == "canceled"
    # the pending row no longer reserves the balance → the invoice can be charged again
    assert (await as_owner.post(f"/v1/payments/invoice/{inv_id}")).status_code == 200


async def test_cannot_pay_when_not_onboarded(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(
        update(Business).where(Business.id == BIZ).values(stripe_charges_enabled=False)
    )
    await db.flush()
    inv_id = await _invoice(db)
    res = await as_owner.post(f"/v1/payments/invoice/{inv_id}")
    assert res.status_code == 409


async def test_cannot_pay_void_invoice(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db, status="void")
    res = await as_owner.post(f"/v1/payments/invoice/{inv_id}")
    assert res.status_code == 409


async def test_unknown_invoice_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable_payments(db)
    res = await as_owner.post("/v1/payments/invoice/inv_nope")
    assert res.status_code == 404


async def test_staff_cannot_pay(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    inv_id = await _invoice(db)
    res = await as_staff.post(f"/v1/payments/invoice/{inv_id}")
    assert res.status_code == 403


async def test_pay_idempotent_replays(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable_payments(db)
    inv_id = await _invoice(db)
    headers = {"Idempotency-Key": "pay-1"}
    first = await as_owner.post(f"/v1/payments/invoice/{inv_id}", headers=headers)
    second = await as_owner.post(f"/v1/payments/invoice/{inv_id}", headers=headers)
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["payment_id"] == second.json()["payment_id"]
