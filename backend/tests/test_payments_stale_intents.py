from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Order
from clientbridge.models.payments import Payment
from clientbridge.services import payments
from clientbridge.services.payments import run_cancel_stale_intents
from tests.conftest import BIZ, FakePaymentGateway
from tests.helpers import client_id, enable_payments, key, ok, sent_invoice

LATTE = {"description": "Latte", "quantity": 2, "unit_amount_cents": 500}
DAY = timedelta(hours=24)


async def _age(db: AsyncSession, payment_id: str, by: timedelta) -> None:
    await db.execute(
        update(Payment)
        .where(Payment.id == payment_id)
        .values(created_at=clock.now() - by)
        .execution_options(synchronize_session=False)
    )
    await db.flush()


async def _status(db: AsyncSession, payment_id: str) -> str:
    row = await db.execute(
        select(Payment.status)
        .where(Payment.id == payment_id)
        .execution_options(populate_existing=True)
    )
    return str(row.scalar_one())


async def _desk_checkout(api: httpx.AsyncClient) -> str:
    sale = ok(await api.post("/v1/orders", json={"lines": [LATTE]}), 201).json()
    return ok(await api.post(f"/v1/orders/{sale['id']}/checkout", headers=key())).json()[
        "payment_id"
    ]


async def test_staff_opened_intents_a_day_old_are_canceled(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    desk = await _desk_checkout(as_owner)
    card = ok(
        await as_owner.post(
            "/v1/gift-cards",
            json={"purchaser_client_id": cid, "amount_cents": 5000, "recipient": "Dana"},
            headers=key(),
        ),
        201,
    ).json()["payment_id"]
    fresh = await _desk_checkout(as_owner)
    for payment_id in (desk, card):
        await _age(db, payment_id, DAY + timedelta(minutes=1))
    await _age(db, fresh, DAY - timedelta(minutes=1))

    assert await run_cancel_stale_intents(db, gateway, clock.now()) >= 2

    assert (await _status(db, desk), await _status(db, card)) == ("canceled", "canceled")
    assert await _status(db, fresh) == "pending"
    refs = await db.execute(select(Payment.provider_ref).where(Payment.id.in_((desk, card))))
    assert set(refs.scalars().all()) <= set(gateway.canceled_intents)


async def test_client_opened_intents_are_left_to_their_own_expiry(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    invoice_id = await sent_invoice(db, client=cid)
    invoice_pay = new_id("payment")
    db.add(
        Payment(
            id=invoice_pay,
            business_id=BIZ,
            client_id=cid,
            kind="payment",
            invoice_id=invoice_id,
            amount_cents=5000,
            method="card",
            provider="stripe",
            provider_ref="pi_pay_link_stale",
            status="pending",
        )
    )
    await db.flush()
    online = await _desk_checkout(as_owner)
    order_id = await db.scalar(select(Payment.order_id).where(Payment.id == online))
    await db.execute(update(Order).where(Order.id == order_id).values(source="online"))
    for payment_id in (invoice_pay, online):
        await _age(db, payment_id, DAY * 3)

    await run_cancel_stale_intents(db, gateway, clock.now())

    assert (await _status(db, invoice_pay), await _status(db, online)) == ("pending", "pending")


async def test_an_intent_that_went_through_stays_for_its_webhook(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    desk = await _desk_checkout(as_owner)
    ref = await db.scalar(select(Payment.provider_ref).where(Payment.id == desk))
    assert ref is not None
    gateway.confirmed.add(ref)
    await _age(db, desk, DAY * 2)

    await run_cancel_stale_intents(db, gateway, clock.now())

    assert await _status(db, desk) == "pending"


async def test_a_run_cancels_a_bounded_batch(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await enable_payments(db)
    monkeypatch.setattr(payments, "_STALE_INTENT_BATCH", 1)
    for _ in range(2):
        await _age(db, await _desk_checkout(as_owner), DAY * 2)

    assert await run_cancel_stale_intents(db, gateway, clock.now()) == 1
    assert await run_cancel_stale_intents(db, gateway, clock.now()) == 1
