"""Selling flows: a POS sale with stock and commission, a package, and a gift card."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.catalog import GiftCard, Package
from clientbridge.services.entitlements import run_expiry_sweeps
from tests.conftest import FakeEmailSender
from tests.flows import (
    business_balance,
    earning_status,
    earnings,
    enable_payments,
    gift_card,
    lapse,
    ok,
    order,
    owner_balance,
    package,
    settle,
)

SHAMPOO = "it_shampoo"  # $24 product
BATH = "it_bath"  # $45 service
MARCUS = "cl_marcus"  # seeded client with a default saved card


def _line(item_id: str, cents: int, quantity: int = 1) -> dict[str, object]:
    return {
        "description": item_id,
        "item_id": item_id,
        "quantity": quantity,
        "unit_amount_cents": cents,
    }


async def _stock(api: httpx.AsyncClient, item_id: str) -> int:
    return int(ok(await api.get(f"/v1/items/{item_id}")).json()["stock_on_hand"])


async def test_pos_sale_moves_stock_pays_commission_and_refunds(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    api = as_owner
    await enable_payments(db)
    ok(await api.patch(f"/v1/items/{SHAMPOO}", json={"track_stock": True}))
    restocked = ok(await api.post(f"/v1/items/{SHAMPOO}/restock", json={"quantity": 5})).json()
    assert restocked["stock_on_hand"] == 5
    ok(await api.patch("/v1/staff/st_owner/pay", json={"payee": True, "retail_rate_bps": 1000}))

    sale = ok(
        await api.post(
            "/v1/orders",
            json={
                "lines": [_line(SHAMPOO, 2400, quantity=2), _line(BATH, 4500)],
                "receipt_email": "walkin-flow@example.ca",
            },
        ),
        201,
    ).json()
    assert (sale["status"], sale["subtotal_cents"]) == ("open", 9300)
    assert sale["balance_cents"] == sale["total_cents"]
    charge = ok(await api.post(f"/v1/orders/{sale['id']}/pay", json={})).json()
    await settle(api, db, charge["payment_id"])

    paid = await order(db, sale["id"])
    assert (paid.status, paid.balance_cents) == ("paid", 0)
    assert paid.amount_paid_cents == sale["total_cents"] and paid.paid_at is not None
    assert await _stock(api, SHAMPOO) == 3
    [commission] = await earnings(db, "order", sale["id"])
    assert await earning_status(db, commission) == "pending"
    (receipt,) = [m for m in email.sent if m.to == "walkin-flow@example.ca"]
    assert "it_shampoo x2  $48.00 CAD" in receipt.body

    await settle(api, db, charge["payment_id"])  # a redelivered settlement changes nothing
    assert await _stock(api, SHAMPOO) == 3
    assert await earnings(db, "order", sale["id"]) == [commission]

    ok(await api.post(f"/v1/payments/{charge['payment_id']}/refund"))
    refunded = await order(db, sale["id"])
    assert (refunded.status, refunded.amount_paid_cents) == ("refunded", 0)
    assert await _stock(api, SHAMPOO) == 5
    assert await earning_status(db, commission) == "reversed"


async def test_package_sell_consume_and_expire(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    api = as_owner
    await enable_payments(db)
    bought = ok(
        await api.post(
            "/v1/packages",
            json={"client_id": MARCUS, "item_id": "it_pkg5", "payment_method_id": "default"},
        ),
        201,
    ).json()
    pid = bought["package_id"]
    assert (await package(db, pid)).status == "pending"
    assert (await api.post(f"/v1/packages/{pid}/consume")).status_code == 409

    await settle(api, db, bought["payment_id"])
    assert (await package(db, pid)).status == "active"
    deferred = await owner_balance(db, "package", pid, "deferred")
    assert deferred == -20000  # the $200 pre-tax price waits as deferred revenue

    used = ok(await api.post(f"/v1/packages/{pid}/consume")).json()
    assert (used["sessions_total"], used["sessions_used"], used["status"]) == (5, 1, "active")
    unused = await owner_balance(db, "package", pid, "deferred")
    assert unused == -16000  # one of five sessions recognized

    revenue = await business_balance(db, "revenue")
    await run_expiry_sweeps(db, await lapse(db, Package, pid))
    assert (await package(db, pid)).status == "expired"
    assert await owner_balance(db, "package", pid, "deferred") == 0
    assert await business_balance(db, "revenue") - revenue == unused


async def test_gift_card_sell_redeem_and_expire(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    api = as_owner
    await enable_payments(db)
    sold = ok(
        await api.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 5000,
                "purchaser_client_id": MARCUS,
                "payment_method_id": "default",
                "recipient": "gift-flow@example.com",
            },
        ),
        201,
    ).json()
    gid = sold["gift_card_id"]
    assert await gift_card(db, gid) == ("pending", 0)
    assert (
        await api.post("/v1/gift-cards/redeem", json={"code": sold["code"], "amount_cents": 100})
    ).status_code == 409

    await settle(api, db, sold["payment_id"])
    assert await gift_card(db, gid) == ("active", 5000)
    assert any(sold["code"] in m.body for m in email.sent if m.to == "gift-flow@example.com")

    redeemed = ok(
        await api.post("/v1/gift-cards/redeem", json={"code": sold["code"], "amount_cents": 2000})
    ).json()
    assert (redeemed["balance_cents"], redeemed["status"]) == (3000, "active")
    spent = ok(
        await api.post("/v1/gift-cards/redeem", json={"code": sold["code"], "amount_cents": 3000})
    ).json()
    assert (spent["balance_cents"], spent["status"]) == (0, "redeemed")
    assert (
        await api.post("/v1/gift-cards/redeem", json={"code": sold["code"], "amount_cents": 1})
    ).status_code == 409

    second = ok(
        await api.post(
            "/v1/gift-cards",
            json={
                "amount_cents": 4000,
                "purchaser_client_id": MARCUS,
                "payment_method_id": "default",
            },
        ),
        201,
    ).json()
    await settle(api, db, second["payment_id"])
    ok(await api.post("/v1/gift-cards/redeem", json={"code": second["code"], "amount_cents": 1500}))
    revenue = await business_balance(db, "revenue")
    await run_expiry_sweeps(db, await lapse(db, GiftCard, second["gift_card_id"]))
    assert await gift_card(db, second["gift_card_id"]) == ("expired", 0)
    assert await business_balance(db, "revenue") - revenue == -2500
