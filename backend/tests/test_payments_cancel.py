import json

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import AppError
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import GiftCard, Package
from clientbridge.models.payments import Payment
from tests.conftest import BIZ, Factory, FakePaymentGateway
from tests.helpers import client_id, enable_payments, key, ok, payment, provider_ref, settle

GOOD = {"Stripe-Signature": "good"}


async def _gift_sale(api: httpx.AsyncClient, cid: str, **extra: object) -> dict[str, str]:
    body = {"purchaser_client_id": cid, "amount_cents": 5000, **extra}
    return ok(await api.post("/v1/gift-cards", json=body, headers=key()), 201).json()


async def _card_status(db: AsyncSession, card_id: str) -> str:
    return str(
        await db.scalar(
            select(GiftCard.status)
            .where(GiftCard.id == card_id)
            .execution_options(populate_existing=True)
        )
    )


async def test_canceling_a_card_sale_stops_the_charge_and_voids_the_gift_card(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sale = await _gift_sale(as_owner, await client_id(db))
    res = await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=key())
    assert res.status_code == 200, res.text
    assert res.json() == {"id": sale["payment_id"], "status": "canceled"}
    assert await provider_ref(db, sale["payment_id"]) in gateway.canceled_intents
    assert (await payment(db, sale["payment_id"])).status == "canceled"
    assert await _card_status(db, sale["gift_card_id"]) == "void"


async def test_a_declined_card_sale_can_still_be_canceled(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sale = await _gift_sale(as_owner, await client_id(db))
    await db.execute(
        update(Payment).where(Payment.id == sale["payment_id"]).values(status="failed")
    )
    res = await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=key())
    assert res.status_code == 200, res.text
    assert await _card_status(db, sale["gift_card_id"]) == "void"


async def test_canceling_a_package_sale_cancels_the_package(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    body = {"client_id": await client_id(db), "item_id": "it_pkg5"}
    sale = ok(await as_owner.post("/v1/packages", json=body, headers=key()), 201).json()
    ok(await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=key()))
    status = await db.scalar(
        select(Package.status)
        .where(Package.id == sale["package_id"])
        .execution_options(populate_existing=True)
    )
    assert status == "canceled"


async def test_a_replayed_cancel_answers_the_same(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sale = await _gift_sale(as_owner, await client_id(db))
    headers = key()
    first = await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=headers)
    again = await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=headers)
    assert first.status_code == again.status_code == 200
    assert again.json() == first.json()
    assert gateway.canceled_intents.count(await provider_ref(db, sale["payment_id"])) == 1


async def test_a_paid_or_cash_sale_cannot_be_canceled(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    paid = await _gift_sale(as_owner, cid)
    await settle(as_owner, db, paid["payment_id"])
    cash = await _gift_sale(as_owner, cid, cash=True)
    confirmed = await _gift_sale(as_owner, cid)
    gateway.confirmed.add(await provider_ref(db, confirmed["payment_id"]))
    for sale in (paid, cash, confirmed):
        res = await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=key())
        assert res.status_code == 409 and res.json()["error"] == "payment_settled", res.text
        assert await _card_status(db, sale["gift_card_id"]) in ("active", "pending")
    assert await _card_status(db, confirmed["gift_card_id"]) == "pending"


async def test_a_provider_outage_is_not_read_as_a_settled_charge(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await enable_payments(db)
    sale = await _gift_sale(as_owner, await client_id(db))

    async def unreachable(account_id: str, *, payment_intent_id: str) -> None:
        raise AppError("stripe timed out", status_code=502, code="payment_provider_error")

    monkeypatch.setattr(gateway, "cancel_payment_intent", unreachable)
    res = await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=key())
    assert res.status_code == 502 and res.json()["error"] == "payment_provider_error"
    assert (await payment(db, sale["payment_id"])).status == "pending"
    assert await _card_status(db, sale["gift_card_id"]) == "pending"


async def test_only_a_gift_card_or_package_sale_is_canceled_here(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    line = {"description": "Latte", "quantity": 1, "unit_amount_cents": 500}
    sale = ok(await as_owner.post("/v1/orders", json={"lines": [line]}), 201).json()
    desk = ok(await as_owner.post(f"/v1/orders/{sale['id']}/checkout", headers=key())).json()
    res = await as_owner.post(f"/v1/payments/{desk['payment_id']}/cancel", headers=key())
    assert res.status_code == 409
    assert (await payment(db, desk["payment_id"])).status == "pending"


async def test_staff_cannot_cancel_a_sale(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    payment_id, card_id = new_id("payment"), new_id("gift_card")
    db.add(
        Payment(
            id=payment_id,
            business_id=BIZ,
            client_id=await client_id(db),
            kind="payment",
            amount_cents=5000,
            method="card",
            provider="stripe",
            provider_ref=f"pi_{payment_id}",
            status="pending",
        )
    )
    await db.flush()
    db.add(
        GiftCard(
            id=card_id,
            business_id=BIZ,
            code="STAFFCANCEL1",
            initial_cents=5000,
            status="pending",
            payment_id=payment_id,
        )
    )
    await db.flush()
    res = await as_staff.post(f"/v1/payments/{payment_id}/cancel", headers=key())
    assert res.status_code == 403
    assert await _card_status(db, card_id) == "pending"


async def test_another_business_payment_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    sale = await _gift_sale(as_owner, await client_id(db))
    elsewhere = await factory.business(name="Elsewhere")
    await db.execute(
        update(Payment).where(Payment.id == sale["payment_id"]).values(business_id=elsewhere.id)
    )
    res = await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel", headers=key())
    assert res.status_code == 404


async def test_a_cancel_needs_an_idempotency_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sale = await _gift_sale(as_owner, await client_id(db))
    assert (await as_owner.post(f"/v1/payments/{sale['payment_id']}/cancel")).status_code == 422


@pytest.mark.parametrize("before", ["pending", "failed"])
async def test_an_intent_canceled_at_stripe_voids_its_pending_gift_card(
    as_owner: httpx.AsyncClient, db: AsyncSession, before: str
) -> None:
    await enable_payments(db)
    sale = await _gift_sale(as_owner, await client_id(db))
    await db.execute(update(Payment).where(Payment.id == sale["payment_id"]).values(status=before))
    event = json.dumps(
        {
            "id": f"evt_gift_canceled_{before}",
            "type": "payment_intent.canceled",
            "data": {"object": {"id": await provider_ref(db, sale["payment_id"])}},
        }
    )
    ok(await as_owner.post("/webhooks/stripe", content=event, headers=GOOD))
    assert (await payment(db, sale["payment_id"])).status == "canceled"
    assert await _card_status(db, sale["gift_card_id"]) == "void"
