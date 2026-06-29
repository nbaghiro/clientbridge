import json

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Order
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from tests.conftest import Factory

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}
LATTE = {"description": "Latte", "quantity": 2, "unit_amount_cents": 500}
MUFFIN = {"description": "Muffin", "quantity": 1, "unit_amount_cents": 350}


async def _enable(db: AsyncSession, *, account: str | None = "acct_test") -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id=account, stripe_charges_enabled=account is not None)
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


async def test_create_order_computes_totals(as_owner: httpx.AsyncClient) -> None:
    cid = None  # walk-in is fine, but exercise the client path
    res = await as_owner.post("/v1/orders", json={"client_id": cid, "lines": [LATTE, MUFFIN]})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "open"
    assert body["staff_id"]
    assert body["subtotal_cents"] == 1350  # 2x500 + 1x350
    assert body["total_cents"] == body["subtotal_cents"] + body["tax_total_cents"]
    assert body["balance_cents"] == body["total_cents"]
    assert len(body["lines"]) == 2


async def test_create_order_with_client(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_owner.post("/v1/orders", json={"client_id": cid, "lines": [LATTE]})
    assert res.status_code == 201, res.text
    assert res.json()["client_id"] == cid


async def test_create_order_idempotent_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    async def order_count() -> int:
        return (
            await db.execute(
                select(func.count()).select_from(Order).where(Order.business_id == BIZ)
            )
        ).scalar_one()

    before = await order_count()
    headers = {"Idempotency-Key": "sale-1"}
    first = await as_owner.post("/v1/orders", json={"lines": [LATTE]}, headers=headers)
    assert first.status_code == 201, first.text
    retry = await as_owner.post("/v1/orders", json={"lines": [LATTE]}, headers=headers)
    assert retry.status_code == 201, retry.text
    assert retry.json()["id"] == first.json()["id"]  # same order replayed, not a second sale
    assert await order_count() == before + 1


async def test_update_order_reapplies_totals(as_owner: httpx.AsyncClient) -> None:
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    assert order["subtotal_cents"] == 1000
    res = await as_owner.patch(f"/v1/orders/{order['id']}", json={"lines": [LATTE, MUFFIN]})
    assert res.status_code == 200, res.text
    assert res.json()["subtotal_cents"] == 1350


async def test_staff_can_ring_and_checkout(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    order = (await as_staff.post("/v1/orders", json={"lines": [LATTE]})).json()
    res = await as_staff.post(f"/v1/orders/{order['id']}/checkout")
    assert res.status_code == 200, res.text  # POS is staff-operated front-desk work
    assert res.json()["client_secret"]


async def test_checkout_and_webhook_settles_order(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    checkout = await as_owner.post(f"/v1/orders/{order['id']}/checkout")
    assert checkout.status_code == 200, checkout.text
    pay_id = checkout.json()["payment_id"]
    pi = (await db.execute(select(Payment.provider_ref).where(Payment.id == pay_id))).scalar_one()
    assert (
        await db.execute(select(Payment.order_id).where(Payment.id == pay_id))
    ).scalar_one() == order["id"]

    event = json.dumps(
        {"id": "evt_o1", "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    assert (await as_owner.post("/webhooks/stripe", content=event, headers=GOOD)).status_code == 200

    status, balance = (
        await db.execute(select(Order.status, Order.balance_cents).where(Order.id == order["id"]))
    ).one()
    assert status == "paid" and balance == 0


async def test_checkout_empty_order_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    order = (await as_owner.post("/v1/orders", json={"lines": []})).json()
    assert (await as_owner.post(f"/v1/orders/{order['id']}/checkout")).status_code == 409


async def test_checkout_without_onboarding_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db, account=None)
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    assert (await as_owner.post(f"/v1/orders/{order['id']}/checkout")).status_code == 409


async def test_void_flips_status_and_blocks_edit(as_owner: httpx.AsyncClient) -> None:
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    voided = await as_owner.post(f"/v1/orders/{order['id']}/void")
    assert voided.status_code == 200 and voided.json()["status"] == "void"
    # a void order can't be edited
    assert (
        await as_owner.patch(f"/v1/orders/{order['id']}", json={"lines": []})
    ).status_code == 409


async def test_staff_cannot_void(as_staff: httpx.AsyncClient) -> None:
    order = (await as_staff.post("/v1/orders", json={"lines": [LATTE]})).json()
    assert (await as_staff.post(f"/v1/orders/{order['id']}/void")).status_code == 403


async def test_order_tenant_isolation(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    staff = await factory.staff(business=other)
    foreign = Order(
        id=new_id("order"),
        business_id=other.id,
        staff_id=staff.id,
        status="open",
        currency="CAD",
        total_cents=5000,
        balance_cents=5000,
    )
    db.add(foreign)
    await db.flush()
    assert (await as_owner.post(f"/v1/orders/{foreign.id}/checkout")).status_code == 404
    assert (await as_owner.post(f"/v1/orders/{foreign.id}/void")).status_code == 404
    assert (await as_owner.patch(f"/v1/orders/{foreign.id}", json={"lines": []})).status_code == 404


async def test_unknown_order_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/orders/ord_nope/checkout")).status_code == 404


async def test_refund_order_payment_reverts_order(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    pay_id = (await as_owner.post(f"/v1/orders/{order['id']}/checkout")).json()["payment_id"]
    pi = (await db.execute(select(Payment.provider_ref).where(Payment.id == pay_id))).scalar_one()
    settle = json.dumps(
        {"id": "evt_or1", "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    assert (
        await as_owner.post("/webhooks/stripe", content=settle, headers=GOOD)
    ).status_code == 200

    refunded = await as_owner.post(f"/v1/payments/{pay_id}/refund")
    assert refunded.status_code == 200, refunded.text
    status, paid, balance, total = (
        await db.execute(
            select(
                Order.status, Order.amount_paid_cents, Order.balance_cents, Order.total_cents
            ).where(Order.id == order["id"])
        )
    ).one()
    assert status == "refunded"
    assert paid == 0 and balance == total
    refund_order_id = (
        await db.execute(
            select(Payment.order_id).where(
                Payment.parent_payment_id == pay_id, Payment.kind == "refund"
            )
        )
    ).scalar_one()
    assert refund_order_id == order["id"]  # the refund row is linked to the order


async def test_second_checkout_with_pending_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    first = await as_owner.post(
        f"/v1/orders/{order['id']}/checkout", headers={"Idempotency-Key": "ck1"}
    )
    assert first.status_code == 200, first.text
    # a true retry (same key) replays the one intent
    retry = await as_owner.post(
        f"/v1/orders/{order['id']}/checkout", headers={"Idempotency-Key": "ck1"}
    )
    assert retry.json()["payment_id"] == first.json()["payment_id"]
    # a fresh checkout while one is pending would mint a second intent → rejected
    second = await as_owner.post(
        f"/v1/orders/{order['id']}/checkout", headers={"Idempotency-Key": "ck2"}
    )
    assert second.status_code == 409


async def test_update_after_checkout_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    assert (await as_owner.post(f"/v1/orders/{order['id']}/checkout")).status_code == 200
    # editing the total after checkout started must not be allowed (it could double-charge)
    res = await as_owner.patch(f"/v1/orders/{order['id']}", json={"lines": [LATTE, MUFFIN]})
    assert res.status_code == 409


async def test_checkout_same_key_mints_one_intent(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    order = (await as_owner.post("/v1/orders", json={"lines": [LATTE]})).json()
    headers = {"Idempotency-Key": "co-replay"}
    first = await as_owner.post(f"/v1/orders/{order['id']}/checkout", headers=headers)
    second = await as_owner.post(f"/v1/orders/{order['id']}/checkout", headers=headers)
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    assert first.json()["payment_id"] == second.json()["payment_id"]
    # state-level: the replay didn't mint a second charge — one Payment, one Stripe intent
    payments = (
        (await db.execute(select(Payment).where(Payment.order_id == order["id"]))).scalars().all()
    )
    assert len(payments) == 1
    assert payments[0].provider_ref is not None
