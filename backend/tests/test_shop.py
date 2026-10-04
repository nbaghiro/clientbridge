"""The online shop (pay online, collect in person), booking add-ons, and invoicing a visit."""

import json
import uuid

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.catalog import Item
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, BookingAddon
from clientbridge.services import ledger_service as ledger
from tests.conftest import BIZ, Factory, FakeEmailSender

SLUG = "birchbark"
GOOD = {"Stripe-Signature": "good"}
SHAMPOO = "it_shampoo"  # seeded product, $24.00, sold online
BRUSH = "it_brush"  # seeded product, $29.00, sold online
BATH = "it_bath"  # seeded service
ADDON_BOOKING = "bk_015"  # seeded upcoming visit (st_diego) with a shampoo add-on
OWNER_BOOKING = "bk_016"  # seeded upcoming visit for st_owner, no add-ons


def _key() -> dict[str, str]:
    return {"Idempotency-Key": uuid.uuid4().hex}


def _order(*lines: tuple[str, int], email: str = "shopper@example.com") -> dict[str, object]:
    return {
        "client": {"name": "Online Shopper", "email": email},
        "lines": [{"item_id": i, "quantity": q} for i, q in lines],
    }


async def _enable(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True, billing_email=None)
    )
    await db.flush()


async def _settle(api: httpx.AsyncClient, db: AsyncSession, order_id: str, event: str) -> None:
    pi = (
        await db.execute(select(Payment.provider_ref).where(Payment.order_id == order_id))
    ).scalar_one()
    body = json.dumps(
        {"id": event, "type": "payment_intent.succeeded", "data": {"object": {"id": pi}}}
    )
    assert (await api.post("/webhooks/stripe", content=body, headers=GOOD)).status_code == 200


# ── shop listing ──


async def test_shop_lists_online_products_without_cost_or_sku(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == BRUSH).values(sku="BR-1", cost_cents=900))
    await db.flush()
    res = await api.get(f"/book/{SLUG}/shop")
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert {i["id"] for i in items} == {SHAMPOO, BRUSH}
    assert all("sku" not in i and "cost_cents" not in i for i in items)


async def test_shop_hides_inactive_and_shows_out_of_stock(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await db.execute(update(Item).where(Item.id == BRUSH).values(active=False))
    await db.execute(
        update(Item).where(Item.id == SHAMPOO).values(track_stock=True, stock_on_hand=0)
    )
    await db.flush()
    items = (await api.get(f"/book/{SLUG}/shop")).json()["items"]
    assert [(i["id"], i["in_stock"]) for i in items] == [(SHAMPOO, False)]


async def test_shop_unknown_slug_404(api: httpx.AsyncClient) -> None:
    assert (await api.get("/book/nope/shop")).status_code == 404


async def test_only_products_sell_online_422(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.patch(f"/v1/items/{BATH}", json={"sell_online": True})
    assert res.status_code == 422


# ── placing an order ──


async def test_order_is_online_for_pickup_and_taxed(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    res = await api.post(f"/book/{SLUG}/shop/orders", json=_order((BRUSH, 2)), headers=_key())
    assert res.status_code == 200, res.text
    body = res.json()
    order = await db.get(Order, body["order_id"])
    assert order is not None
    assert (order.source, order.pickup_status, order.status) == ("online", "unfulfilled", "open")
    assert order.subtotal_cents == 5800
    assert order.total_cents == body["total_cents"] > 5800  # BC tax on goods
    assert body["client_secret"]


async def test_order_replay_returns_the_same_order(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    key = _key()
    first = await api.post(f"/book/{SLUG}/shop/orders", json=_order((SHAMPOO, 1)), headers=key)
    again = await api.post(f"/book/{SLUG}/shop/orders", json=_order((SHAMPOO, 1)), headers=key)
    assert first.status_code == again.status_code == 200
    assert first.json()["order_id"] == again.json()["order_id"]
    count = await db.scalar(select(func.count()).select_from(Order).where(Order.source == "online"))
    assert count == 2  # the seeded online order + this one


async def test_order_needs_an_idempotency_key_422(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    assert (
        await api.post(f"/book/{SLUG}/shop/orders", json=_order((SHAMPOO, 1)))
    ).status_code == 422


async def test_order_refuses_items_not_sold_online_404(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    other = await Factory(db).business()
    foreign = Item(
        id="it_foreign", business_id=other.id, kind="product", name="X", sell_online=True
    )
    db.add(foreign)
    await db.execute(update(Item).where(Item.id == BRUSH).values(active=False))
    await db.commit()
    for item in (BATH, BRUSH, "it_foreign", "it_missing"):
        res = await api.post(f"/book/{SLUG}/shop/orders", json=_order((item, 1)), headers=_key())
        assert res.status_code == 404, (item, res.text)


async def test_order_blocks_more_than_in_stock_409(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    await db.execute(
        update(Item).where(Item.id == SHAMPOO).values(track_stock=True, stock_on_hand=1)
    )
    await db.commit()
    res = await api.post(f"/book/{SLUG}/shop/orders", json=_order((SHAMPOO, 2)), headers=_key())
    assert res.status_code == 409
    assert "only 1 left" in res.json()["message"]


async def test_order_needs_card_payments_on_409(api: httpx.AsyncClient) -> None:
    res = await api.post(f"/book/{SLUG}/shop/orders", json=_order((SHAMPOO, 1)), headers=_key())
    assert res.status_code == 409


async def test_paid_order_notifies_owner_and_client_with_pickup(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _enable(db)
    await db.execute(update(Business).where(Business.id == BIZ).values(billing_email="o@x.ca"))
    await db.flush()
    body = (
        await api.post(f"/book/{SLUG}/shop/orders", json=_order((BRUSH, 1)), headers=_key())
    ).json()
    await _settle(api, db, body["order_id"], "evt_shop_paid")
    order = await db.get(Order, body["order_id"], populate_existing=True)
    assert order is not None and (await ledger.order_state(db, order))[0] == "paid"
    to = {e.to: e for e in email.sent}
    assert "Online order paid" in to["o@x.ca"].subject
    assert "Collect your order" in to["shopper@example.com"].body


# ── pickup ──


async def test_staff_mark_an_online_order_ready_then_picked_up(
    as_staff: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    ready = await as_staff.post("/v1/orders/ord_web/pickup", json={"status": "ready"})
    assert ready.status_code == 200, ready.text
    assert ready.json()["pickup_status"] == "ready"
    assert any("ready to pick up" in e.body for e in email.sent)
    done = await as_staff.post("/v1/orders/ord_web/pickup", json={"status": "picked_up"})
    assert done.json()["pickup_status"] == "picked_up"
    back = await as_staff.post("/v1/orders/ord_web/pickup", json={"status": "ready"})
    assert back.status_code == 409


async def test_pickup_only_for_paid_online_orders_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    assert (
        await as_owner.post("/v1/orders/ord_open/pickup", json={"status": "ready"})
    ).status_code == 409  # an in-person sale
    await _enable(db)
    unpaid = (
        await as_owner.post(f"/book/{SLUG}/shop/orders", json=_order((BRUSH, 1)), headers=_key())
    ).json()
    assert (
        await as_owner.post(f"/v1/orders/{unpaid['order_id']}/pickup", json={"status": "ready"})
    ).status_code == 409  # not paid yet
    assert (
        await as_owner.post("/v1/orders/ord_nope/pickup", json={"status": "ready"})
    ).status_code == 404


# ── booking add-ons ──


async def test_booking_page_offers_add_ons_and_stores_them(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    page = (await api.get(f"/book/{SLUG}/services")).json()
    assert {a["id"] for a in page["addons"]} == {SHAMPOO, BRUSH}
    res = await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": "it_groom_sm",
            "staff_id": "st_owner",
            "starts_at": "2027-03-02T18:00:00Z",
            "client": {"name": "Add On", "email": "addon@example.com"},
            "addons": [{"item_id": BRUSH, "quantity": 1}, {"item_id": BRUSH, "quantity": 1}],
        },
    )
    assert res.status_code == 200, res.text
    rows = (
        (
            await db.execute(
                select(BookingAddon).where(BookingAddon.booking_id == res.json()["booking_id"])
            )
        )
        .scalars()
        .all()
    )
    assert [(r.item_id, r.quantity, r.unit_amount_cents) for r in rows] == [(BRUSH, 2, 2900)]


async def test_booking_refuses_an_add_on_not_sold_online_404(api: httpx.AsyncClient) -> None:
    res = await api.post(
        f"/book/{SLUG}",
        json={
            "item_id": "it_groom_sm",
            "staff_id": "st_owner",
            "starts_at": "2027-03-02T18:00:00Z",
            "client": {"name": "Add On", "email": "addon@example.com"},
            "addons": [{"item_id": BATH}],
        },
    )
    assert res.status_code == 404


async def test_invoice_for_a_visit_includes_its_add_ons(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_owner.post(f"/v1/invoices/from-booking/{ADDON_BOOKING}", headers=_key())
    assert res.status_code == 201, res.text
    lines = res.json()["lines"]
    assert [ln["booking_id"] for ln in lines] == [ADDON_BOOKING, None]
    assert lines[1]["item_id"] == SHAMPOO
    booking = await db.get(Booking, ADDON_BOOKING, populate_existing=True)
    assert booking is not None and booking.invoice_id == res.json()["id"]
    again = await as_owner.post(f"/v1/invoices/from-booking/{ADDON_BOOKING}", headers=_key())
    assert again.status_code == 409


async def test_invoice_for_a_visit_replays_with_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    key = _key()
    first = await as_owner.post(f"/v1/invoices/from-booking/{OWNER_BOOKING}", headers=key)
    again = await as_owner.post(f"/v1/invoices/from-booking/{OWNER_BOOKING}", headers=key)
    assert first.status_code == again.status_code == 201
    assert first.json()["id"] == again.json()["id"]
    count = await db.scalar(
        select(func.count()).select_from(Line).where(Line.booking_id == OWNER_BOOKING)
    )
    assert count == 1


async def test_invoice_for_a_visit_errors(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    assert (await as_staff.post(f"/v1/invoices/from-booking/{ADDON_BOOKING}")).status_code == 403


async def test_invoice_for_another_business_visit_404(as_owner: httpx.AsyncClient) -> None:
    assert (await as_owner.post("/v1/invoices/from-booking/bk_nope")).status_code == 404


async def test_staff_remove_an_add_on_from_their_own_visit(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    res = await as_staff.delete(f"/v1/bookings/{ADDON_BOOKING}/addons/bka_demo_shampoo")
    assert res.status_code == 200, res.text
    assert await db.get(BookingAddon, "bka_demo_shampoo") is None
    missing = await as_staff.delete(f"/v1/bookings/{ADDON_BOOKING}/addons/bka_demo_shampoo")
    assert missing.status_code == 404


async def test_add_on_removal_rules(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    created = await as_owner.post(f"/v1/invoices/from-booking/{ADDON_BOOKING}", headers=_key())
    assert created.status_code == 201
    res = await as_owner.delete(f"/v1/bookings/{ADDON_BOOKING}/addons/bka_demo_shampoo")
    assert res.status_code == 409  # already invoiced
    invoice = await db.get(Invoice, created.json()["id"])
    assert invoice is not None


async def test_staff_cannot_remove_add_ons_from_another_members_visit(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    db.add(
        BookingAddon(
            id="bka_owner_visit",
            business_id=BIZ,
            booking_id=OWNER_BOOKING,
            staff_id="st_owner",
            item_id=SHAMPOO,
            description="Shampoo",
            quantity=1,
            unit_amount_cents=2400,
        )
    )
    await db.commit()
    res = await as_staff.delete(f"/v1/bookings/{OWNER_BOOKING}/addons/bka_owner_visit")
    assert res.status_code == 403
