"""Selling products: bookable kinds, tax classes, entitlement lines, stock, retail commission,
itemised receipts, sales by item, sale currency, and paying a sale online."""

import json

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.catalog import Item, StockMovement
from clientbridge.models.identity import Business, Staff
from clientbridge.models.ledger import Entry
from clientbridge.models.payments import Payment
from tests.conftest import BIZ, Factory, FakeEmailSender, FakePaymentGateway

GOOD = {"Stripe-Signature": "good"}
SHAMPOO = "it_shampoo"  # seeded product, $24.00
BATH = "it_bath"  # seeded service, $45.00


async def _enable(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
    )
    await db.flush()


async def _line(item_id: str, cents: int, quantity: int = 1, **extra: str) -> dict[str, object]:
    return {
        "description": item_id,
        "item_id": item_id,
        "quantity": quantity,
        "unit_amount_cents": cents,
        **extra,
    }


async def _settle(api: httpx.AsyncClient, db: AsyncSession, payment_id: str, event: str) -> None:
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    body = json.dumps(
        {"id": event, "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200


async def _paid_sale(
    api: httpx.AsyncClient,
    db: AsyncSession,
    lines: list[dict[str, object]],
    event: str,
    **order: str,
) -> dict[str, object]:
    await _enable(db)
    created = await api.post("/v1/orders", json={"lines": lines, **order})
    assert created.status_code == 201, created.text
    sale: dict[str, object] = created.json()
    pay = await api.post(f"/v1/orders/{sale['id']}/pay", json={})
    assert pay.status_code == 200, pay.text
    await _settle(api, db, pay.json()["payment_id"], event)
    sale["payment_id"] = pay.json()["payment_id"]
    return sale


async def _stock(db: AsyncSession, item_id: str) -> int | None:
    item = await db.get(Item, item_id, populate_existing=True)
    assert item is not None
    return item.stock_on_hand


async def _track(db: AsyncSession, item_id: str, on_hand: int) -> None:
    await db.execute(
        update(Item).where(Item.id == item_id).values(track_stock=True, stock_on_hand=on_hand)
    )
    await db.flush()


# ── online booking is for services and classes only ──


async def test_new_items_are_bookable_online_by_kind(as_owner: httpx.AsyncClient) -> None:
    product = await as_owner.post("/v1/items", json={"kind": "product", "name": "Brush"})
    service = await as_owner.post("/v1/items", json={"kind": "service", "name": "Trim"})
    assert product.json()["online_bookable"] is False
    assert service.json()["online_bookable"] is True
    page = (await as_owner.get("/book/birchbark/services")).json()
    assert product.json()["id"] not in {s["id"] for s in page["services"]}


async def test_bookable_product_is_rejected_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/items", json={"kind": "product", "name": "Brush", "online_bookable": True}
    )
    assert res.status_code == 422
    assert res.json()["message"] == "only services and classes can be booked online"


async def test_changing_a_service_to_a_product_unpublishes_it(as_owner: httpx.AsyncClient) -> None:
    item = (await as_owner.post("/v1/items", json={"kind": "service", "name": "Kit"})).json()
    res = await as_owner.patch(f"/v1/items/{item['id']}", json={"kind": "product"})
    assert res.status_code == 200, res.text
    assert res.json()["online_bookable"] is False


async def test_database_refuses_a_bookable_product(db: AsyncSession) -> None:
    with pytest.raises(IntegrityError):
        await db.execute(update(Item).where(Item.id == SHAMPOO).values(online_bookable=True))
    await db.rollback()


# ── tax class per item and line ──


async def test_tax_class_controls_bc_components(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == BATH).values(tax_class="federal_only"))
    await db.flush()
    res = await as_owner.post(
        "/v1/orders",
        json={
            "lines": [
                await _line(BATH, 10000),
                await _line(SHAMPOO, 2400),
                {"description": "Donation", "unit_amount_cents": 500, "tax_class": "exempt"},
            ]
        },
    )
    assert res.status_code == 201, res.text
    lines = {ln["description"]: ln for ln in res.json()["lines"]}
    assert lines[BATH]["tax_class"] == "federal_only"
    assert lines[BATH]["tax_amount_cents"] == 500  # GST only
    assert lines[SHAMPOO]["tax_amount_cents"] == 288  # GST + PST on a good
    assert lines["Donation"]["tax_amount_cents"] == 0


async def test_line_keeps_the_class_it_was_sold_under(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = (await as_owner.post("/v1/orders", json={"lines": [await _line(BATH, 10000)]})).json()
    await db.execute(update(Item).where(Item.id == BATH).values(tax_class="exempt"))
    await db.flush()
    line = await db.get(Line, sale["lines"][0]["id"], populate_existing=True)
    assert line is not None and line.tax_class == "standard"


# ── gift cards, packages and subscriptions sell through their own checkout ──


@pytest.mark.parametrize("item_id", ["it_gift", "it_pkg5", "it_daycare"])
async def test_entitlements_cannot_be_order_lines_422(
    as_owner: httpx.AsyncClient, item_id: str
) -> None:
    res = await as_owner.post("/v1/orders", json={"lines": [await _line(item_id, 5000)]})
    assert res.status_code == 422
    assert "its own checkout" in res.json()["message"]


async def test_entitlements_cannot_be_invoice_lines_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    client_id = (await db.execute(select(Invoice.client_id).limit(1))).scalar_one()
    res = await as_owner.post(
        "/v1/invoices",
        json={"client_id": client_id, "lines": [await _line("it_pkg5", 20000)]},
    )
    assert res.status_code == 422


async def test_another_business_item_is_not_a_line_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    item = Item(id="it_other_shampoo", business_id=other.id, kind="product", name="X")
    db.add(item)
    await db.commit()
    res = await as_owner.post("/v1/orders", json={"lines": [await _line(item.id, 100)]})
    assert res.status_code == 404


# ── product fields and stock ──


async def test_product_fields_and_duplicate_sku_409(as_owner: httpx.AsyncClient) -> None:
    body = {
        "kind": "product",
        "name": "Detangling spray",
        "price_cents": 1800,
        "sku": "SPRAY-01",
        "cost_cents": 700,
        "track_stock": True,
        "low_stock_at": 3,
    }
    first = await as_owner.post("/v1/items", json=body)
    assert first.status_code == 201, first.text
    assert first.json()["stock_on_hand"] == 0
    assert first.json()["sku"] == "SPRAY-01"
    again = await as_owner.post("/v1/items", json={**body, "name": "Copy"})
    assert again.status_code == 409


async def test_only_products_track_stock_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/v1/items", json={"kind": "service", "name": "Trim", "track_stock": True}
    )
    assert res.status_code == 422


async def test_restock_adds_once_per_key(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _track(db, SHAMPOO, 2)
    key = {"Idempotency-Key": "restock-1"}
    first = await as_owner.post(f"/v1/items/{SHAMPOO}/restock", json={"quantity": 6}, headers=key)
    again = await as_owner.post(f"/v1/items/{SHAMPOO}/restock", json={"quantity": 6}, headers=key)
    assert first.status_code == 200, first.text
    assert again.json()["stock_on_hand"] == 8
    assert await _stock(db, SHAMPOO) == 8


async def test_restock_errors(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    untracked = await as_owner.post(f"/v1/items/{SHAMPOO}/restock", json={"quantity": 2})
    assert untracked.status_code == 409
    zero = await as_owner.post(f"/v1/items/{SHAMPOO}/restock", json={"quantity": 0})
    assert zero.status_code == 422
    missing = await as_owner.post("/v1/items/it_nope/restock", json={"quantity": 2})
    assert missing.status_code == 404


async def test_staff_cannot_restock_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    await _track(db, SHAMPOO, 2)
    await db.commit()
    res = await as_staff.post(f"/v1/items/{SHAMPOO}/restock", json={"quantity": 2})
    assert res.status_code == 403


async def test_paid_sale_moves_stock_once_and_full_refund_restores(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _track(db, SHAMPOO, 5)
    sale = await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400, quantity=2)], "evt_stk1")
    assert await _stock(db, SHAMPOO) == 3
    await _settle(as_owner, db, str(sale["payment_id"]), "evt_stk1_again")
    assert await _stock(db, SHAMPOO) == 3

    refund = await as_owner.post(f"/v1/payments/{sale['payment_id']}/refund")
    assert refund.status_code == 200, refund.text
    assert await _stock(db, SHAMPOO) == 5
    moves = (
        await db.execute(select(StockMovement.reason).where(StockMovement.item_id == SHAMPOO))
    ).scalars()
    assert sorted(moves) == ["refund", "sale"]


async def test_partial_refund_keeps_stock_out(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _track(db, SHAMPOO, 5)
    sale = await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400)], "evt_stk2")
    res = await as_owner.post(f"/v1/payments/{sale['payment_id']}/refund?amount_cents=500")
    assert res.status_code == 200, res.text
    assert await _stock(db, SHAMPOO) == 4


async def test_selling_past_zero_is_allowed(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _track(db, SHAMPOO, 1)
    await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400, quantity=3)], "evt_stk3")
    assert await _stock(db, SHAMPOO) == -2


async def test_stock_is_not_sync_writable_403(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [{"op": "PATCH", "type": "items", "id": SHAMPOO, "data": {"stock_on_hand": 99}}]
        },
    )
    assert res.status_code == 403


async def test_sync_cannot_publish_a_product_for_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.post(
        "/sync/upload",
        json={
            "ops": [
                {"op": "PATCH", "type": "items", "id": SHAMPOO, "data": {"online_bookable": True}}
            ]
        },
    )
    assert res.status_code == 422
    item = await db.get(Item, SHAMPOO, populate_existing=True)
    assert item is not None and item.online_bookable is False


# ── retail commission ──


async def _commission(db: AsyncSession, staff_id: str, bps: int) -> None:
    await db.execute(
        update(Staff).where(Staff.id == staff_id).values(is_payee=True, retail_rate_bps=bps)
    )
    await db.flush()


async def test_paid_sale_accrues_commission_on_products_only(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _commission(db, "st_owner", 1000)
    sale = await _paid_sale(
        as_owner, db, [await _line(SHAMPOO, 2400), await _line(BATH, 4500)], "evt_com1"
    )
    journal = (
        (
            await db.execute(
                select(Entry.journal_id).where(
                    Entry.type == "earning",
                    Entry.subject_type == "order",
                    Entry.subject_id == sale["id"],
                )
            )
        )
        .scalars()
        .first()
    )
    assert journal is not None
    approved = await as_owner.post(f"/v1/earnings/{journal}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["order_id"] == sale["id"]
    assert approved.json()["booking_id"] is None
    assert approved.json()["amount_cents"] == 240  # 10% of the $24 shampoo, not the bath
    assert approved.json()["status"] == "approved"


async def test_refund_reverses_pending_commission(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _commission(db, "st_owner", 1000)
    sale = await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400)], "evt_com2")
    await as_owner.post(f"/v1/payments/{sale['payment_id']}/refund")
    refs = (await db.execute(select(Entry.ref).where(Entry.subject_id == sale["id"]))).scalars()
    assert any(ref.endswith(":reversal") for ref in refs)


async def test_no_commission_without_a_retail_rate(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    sale = await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400)], "evt_com3")
    found = (
        await db.execute(
            select(Entry.id).where(Entry.subject_id == sale["id"], Entry.type == "earning")
        )
    ).first()
    assert found is None


async def test_owner_sets_staff_pay(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch(
        "/v1/staff/st_diego/pay", json={"retail_rate_bps": 1500, "is_payee": True}
    )
    assert res.status_code == 200, res.text
    assert res.json()["retail_rate_bps"] == 1500
    assert (
        await as_owner.patch("/v1/staff/st_diego/pay", json={"retail_rate_bps": 20000})
    ).status_code == 422
    assert (
        await as_owner.patch("/v1/staff/st_nope/pay", json={"is_payee": True})
    ).status_code == 404


async def test_staff_cannot_set_pay_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.patch("/v1/staff/st_diego/pay", json={"retail_rate_bps": 9000})
    assert res.status_code == 403


# ── itemised receipts ──


async def test_walk_in_gets_an_itemised_receipt(
    as_owner: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _paid_sale(
        as_owner,
        db,
        [await _line(SHAMPOO, 2400, quantity=2)],
        "evt_rcp1",
        receipt_email="walkin@example.ca",
    )
    (receipt,) = [m for m in email.sent if m.to == "walkin@example.ca"]
    assert "it_shampoo x2  $48.00 CAD" in receipt.body
    assert "GST  $2.40 CAD" in receipt.body
    assert "PST  $3.36 CAD" in receipt.body
    assert "Total  $53.76 CAD" in receipt.body


async def test_bad_receipt_email_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/orders", json={"lines": [], "receipt_email": "not-an-email"})
    assert res.status_code == 422


# ── sales by item ──


async def test_sales_by_item_report(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400, quantity=3)], "evt_rep1")
    sale = await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400)], "evt_rep2")
    await as_owner.post(f"/v1/payments/{sale['payment_id']}/refund")
    order = await db.get(Order, sale["id"])
    assert order is not None and order.paid_at is not None
    day = order.paid_at.date().isoformat()
    res = await as_owner.get(f"/v1/reports/sales-by-item?start={day}&end={day}")
    assert res.status_code == 200, res.text
    (row,) = [r for r in res.json() if r["item_id"] == SHAMPOO]
    assert row["quantity"] >= 4
    assert row["sales_cents"] >= 9600
    assert row["refunded_cents"] >= 2400
    csv = await as_owner.get(f"/v1/reports/sales-by-item.csv?start={day}&end={day}")
    assert csv.status_code == 200 and "Oatmeal" in csv.text


async def test_sales_by_item_is_owner_only_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.get("/v1/reports/sales-by-item?start=2026-01-01&end=2026-12-31")
    assert res.status_code == 403


# ── sale currency ──


async def test_sale_takes_its_items_currency(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(update(Item).where(Item.id == SHAMPOO).values(currency="USD"))
    await db.commit()
    single = await as_owner.post("/v1/orders", json={"lines": [await _line(SHAMPOO, 2400)]})
    assert single.json()["currency"] == "USD"
    mixed = await as_owner.post(
        "/v1/orders", json={"lines": [await _line(SHAMPOO, 2400), await _line(BATH, 4500)]}
    )
    assert mixed.status_code == 422


# ── paying a sale online (the web till) ──


async def test_walk_in_pays_with_a_new_card(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sale = await _paid_sale(as_owner, db, [await _line(SHAMPOO, 2400)], "evt_pay1")
    order = await db.get(Order, sale["id"], populate_existing=True)
    assert order is not None and order.status == "paid"


async def test_client_sale_charges_a_saved_card(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    sale = (
        await as_owner.post(
            "/v1/orders", json={"client_id": "cl_amelie", "lines": [await _line(SHAMPOO, 2400)]}
        )
    ).json()
    res = await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={"payment_method_id": "default"})
    assert res.status_code == 200, res.text
    assert gateway.charged_methods  # charged off-session


async def test_pay_errors(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    sale = (await as_owner.post("/v1/orders", json={"lines": [await _line(SHAMPOO, 2400)]})).json()
    await db.commit()
    not_connected = await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={})
    assert not_connected.status_code == 409
    await _enable(db)
    await db.commit()
    walk_in_saved = await as_owner.post(
        f"/v1/orders/{sale['id']}/pay", json={"payment_method_id": "default"}
    )
    assert walk_in_saved.status_code == 422
    missing = await as_owner.post("/v1/orders/ord_nope/pay", json={})
    assert missing.status_code == 404


async def test_pay_is_idempotent(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    sale = (await as_owner.post("/v1/orders", json={"lines": [await _line(SHAMPOO, 2400)]})).json()
    key = {"Idempotency-Key": "till-1"}
    first = await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={}, headers=key)
    again = await as_owner.post(f"/v1/orders/{sale['id']}/pay", json={}, headers=key)
    assert first.json()["payment_id"] == again.json()["payment_id"]


async def test_paid_invoice_moves_stock(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    await _track(db, SHAMPOO, 4)
    invoice = await as_owner.post(
        "/v1/invoices",
        json={"client_id": "cl_amelie", "lines": [await _line(SHAMPOO, 2400, quantity=2)]},
    )
    assert invoice.status_code == 201, invoice.text
    inv_id = invoice.json()["id"]
    assert (await as_owner.post(f"/v1/invoices/{inv_id}/send")).status_code == 200
    pay = await as_owner.post(f"/v1/payments/invoice/{inv_id}")
    assert pay.status_code in (200, 201), pay.text
    await _settle(as_owner, db, pay.json()["payment_id"], "evt_inv_stk")
    assert await _stock(db, SHAMPOO) == 2
