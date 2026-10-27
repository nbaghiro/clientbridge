import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Order
from clientbridge.models.payments import Payment
from tests.conftest import Factory, FakePaymentGateway
from tests.helpers import enable_payments, key, ok, settle

LATTE = {"description": "Latte", "quantity": 2, "unit_amount_cents": 500}
MUFFIN = {"description": "Muffin", "quantity": 1, "unit_amount_cents": 350}


async def _sale(api: httpx.AsyncClient, db: AsyncSession) -> dict[str, object]:
    await enable_payments(db)
    return ok(await api.post("/v1/orders", json={"lines": [LATTE]}), 201).json()


async def _payments(db: AsyncSession, order_id: object) -> list[Payment]:
    rows = await db.execute(
        select(Payment)
        .where(Payment.order_id == order_id)
        .order_by(Payment.created_at, Payment.id)
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars().all())


async def test_canceling_a_tap_to_pay_checkout_frees_the_sale_for_cash_edit_and_void(
    as_staff: httpx.AsyncClient,
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
) -> None:
    sale = await _sale(as_staff, db)
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout", headers=key()))
    out = ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel")).json()
    assert out["status"] == "open" and out["due_cents"] == sale["total_cents"]
    [payment] = await _payments(db, sale["id"])
    assert payment.status == "canceled" and payment.provider_ref in gateway.canceled_intents
    ok(await as_staff.patch(f"/v1/orders/{sale['id']}", json={"lines": [LATTE, MUFFIN]}))
    ok(await as_owner.post(f"/v1/orders/{sale['id']}/void"))


async def test_canceling_a_card_checkout_lets_the_desk_take_cash(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _sale(as_staff, db)
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/pay", json={}, headers=key()))
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel"))
    cash = await as_staff.post(
        f"/v1/orders/{sale['id']}/cash", json={"tendered_cents": 5000}, headers=key()
    )
    assert cash.status_code == 200, cash.text
    statuses = sorted(p.status for p in await _payments(db, sale["id"]))
    assert statuses == ["canceled", "succeeded"]


async def test_a_new_checkout_after_a_cancel_opens_a_new_intent(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = await _sale(as_staff, db)
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout"))
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel"))
    again = ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout")).json()
    first, second = await _payments(db, sale["id"])
    assert first.provider_ref != second.provider_ref
    assert (second.id, second.status) == (again["payment_id"], "pending")


async def test_a_changed_tip_supersedes_the_open_card_intent(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _sale(as_staff, db)
    path = f"/v1/orders/{sale['id']}/pay"
    ok(await as_staff.post(path, json={"tip_cents": 100}, headers=key()))
    ok(await as_staff.post(path, json={"tip_cents": 200}, headers=key()))
    old, new = await _payments(db, sale["id"])
    assert (old.status, old.tip_cents) == ("canceled", 100)
    assert (new.status, new.tip_cents) == ("pending", 200)
    assert old.provider_ref in gateway.canceled_intents


async def test_a_changed_tip_supersedes_the_open_terminal_intent(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _sale(as_staff, db)
    path = f"/v1/orders/{sale['id']}/checkout"
    ok(await as_staff.post(path, json={"tip_cents": 0}, headers=key()))
    ok(await as_staff.post(path, json={"tip_cents": 150}, headers=key()))
    old, new = await _payments(db, sale["id"])
    assert (old.status, new.status, new.tip_cents) == ("canceled", "pending", 150)
    assert old.provider_ref in gateway.canceled_intents


async def test_a_second_checkout_for_the_same_charge_is_refused_without_orphaning_an_intent(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _sale(as_staff, db)
    path = f"/v1/orders/{sale['id']}/checkout"
    ok(await as_staff.post(path, headers=key()))
    second = await as_staff.post(path, headers=key())
    assert second.status_code == 409
    [payment] = await _payments(db, sale["id"])
    assert payment.status == "pending"
    assert len(gateway.canceled_intents) == 1
    assert payment.provider_ref not in gateway.canceled_intents


async def test_a_tip_change_on_a_confirmed_intent_is_refused(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _sale(as_staff, db)
    path = f"/v1/orders/{sale['id']}/pay"
    ok(await as_staff.post(path, json={}, headers=key()))
    [first] = await _payments(db, sale["id"])
    assert first.provider_ref is not None
    gateway.confirmed.add(first.provider_ref)
    res = await as_staff.post(path, json={"tip_cents": 300}, headers=key())
    assert (res.status_code, res.json()["error"]) == (409, "checkout_paid")
    [kept] = await _payments(db, sale["id"])
    assert kept.status == "pending"


async def test_cancel_after_the_card_went_through_is_refused(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _sale(as_staff, db)
    paid = ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout")).json()
    [payment] = await _payments(db, sale["id"])
    assert payment.provider_ref is not None
    gateway.confirmed.add(payment.provider_ref)
    res = await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel")
    assert (res.status_code, res.json()["error"]) == (409, "checkout_paid")
    [kept] = await _payments(db, sale["id"])
    assert kept.status == "pending"
    await settle(as_staff, db, paid["payment_id"])
    res = await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel")
    assert (res.status_code, res.json()["error"]) == (409, "checkout_paid")


async def test_cancel_is_idempotent_and_a_no_op_without_a_checkout(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _sale(as_staff, db)
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel"))
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout"))
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel"))
    ok(await as_staff.post(f"/v1/orders/{sale['id']}/checkout/cancel"))
    assert len(gateway.canceled_intents) == 1


async def test_cancel_on_a_void_sale_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    sale = await _sale(as_owner, db)
    ok(await as_owner.post(f"/v1/orders/{sale['id']}/void"))
    assert (await as_owner.post(f"/v1/orders/{sale['id']}/checkout/cancel")).status_code == 409


async def test_cancel_needs_a_login(unauth: httpx.AsyncClient) -> None:
    assert (await unauth.post("/v1/orders/ord_x/checkout/cancel")).status_code == 401


async def test_cancel_needs_a_sale_of_this_business(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    assert (await as_owner.post("/v1/orders/ord_x/checkout/cancel")).status_code == 404
    other = await factory.business()
    owner = await factory.staff(business=other, role="owner")
    order = Order(id=new_id("order"), business_id=other.id, staff_id=owner.id, status="open")
    db.add(order)
    await db.flush()
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=other.id,
            kind="payment",
            order_id=order.id,
            amount_cents=1000,
            method="card",
            provider="stripe",
            provider_ref="pi_foreign",
            status="pending",
        )
    )
    await db.flush()
    assert (await as_owner.post(f"/v1/orders/{order.id}/checkout/cancel")).status_code == 404
    assert gateway.canceled_intents == []
