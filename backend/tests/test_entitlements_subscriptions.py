"""EFT/PAD + recurring subscriptions: command surface + Stripe subscription webhooks."""

import json
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import Audit
from clientbridge.schemas.billing import InvoiceOut
from clientbridge.services import ledger
from clientbridge.services.payments import map_subscription_status
from tests.conftest import Factory, FakeEmailSender, FakePaymentGateway, FakeSmsSender
from tests.helpers import (
    business_balance,
    client_id,
    enable_payments,
    invoice,
    key,
    payment_by_ref,
    stripe_event,
)

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}
PAID_AT = datetime(2026, 9, 30, 23, 15, tzinfo=UTC)


async def _sub_item(
    db: AsyncSession,
    *,
    business_id: str = BIZ,
    kind: str = "subscription",
    interval: int | None = 1,
    frequency: str | None = "month",
    price: int = 5000,
) -> Item:
    item = Item(
        id=new_id("item"),
        business_id=business_id,
        kind=kind,
        name="Monthly Plan",
        price_cents=price,
        currency="CAD",
        interval=interval,
        frequency=frequency,
    )
    db.add(item)
    await db.flush()
    return item


async def _new_client(db: AsyncSession, *, business_id: str = BIZ, name: str = "Sub Client") -> str:
    client = Client(
        id=new_id("client"),
        business_id=business_id,
        name=name,
        phone="+16045550223",
        tags=[],
        custom_fields={},
    )
    db.add(client)
    await db.flush()
    return client.id


async def _saved_method(
    db: AsyncSession,
    cid: str,
    *,
    business_id: str = BIZ,
    ref: str = "pm_sub",
    method: str = "card",
) -> PaymentMethod:
    pm = PaymentMethod(
        id=new_id("payment_method"),
        business_id=business_id,
        client_id=cid,
        method=method,
        provider_ref=ref,
    )
    db.add(pm)
    await db.flush()
    return pm


def _body(cid: str, item_id: str, pm_id: str) -> dict[str, str]:
    return {"client_id": cid, "item_id": item_id, "payment_method_id": pm_id}


async def test_create_subscription_happy(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "active"
    assert body["id"].startswith("sub_")
    row = (await db.execute(select(Subscription).where(Subscription.id == body["id"]))).scalar_one()
    assert row.provider_ref is not None and row.provider_ref.startswith("sub_fake")
    assert row.provider_ref in gateway.created_subscriptions
    assert row.payment_method_id == pm.id
    assert row.current_period_end == datetime(2030, 2, 1, tzinfo=UTC)
    cached = (await db.execute(select(Item.stripe_price_id).where(Item.id == item.id))).scalar_one()
    assert cached is not None and cached.startswith("price_fake")
    assert len(gateway.created_prices) == 1


async def test_second_subscription_reuses_cached_price(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    item = await _sub_item(db)
    c1 = await _new_client(db, name="Client One")
    c2 = await _new_client(db, name="Client Two")
    pm1 = await _saved_method(db, c1, ref="pm_c1")
    pm2 = await _saved_method(db, c2, ref="pm_c2")
    r1 = await as_owner.post("/v1/subscriptions", json=_body(c1, item.id, pm1.id))
    r2 = await as_owner.post("/v1/subscriptions", json=_body(c2, item.id, pm2.id))
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    assert len(gateway.created_prices) == 1  # price created once, then reused across clients
    assert len(gateway.created_subscriptions) == 2


async def test_subscription_price_is_tax_inclusive(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db, price=5000)
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 201, res.text
    # BC + tax-registered: GST 5% + PST 7% on 5000 → 600 tax → a 5600 tax-inclusive Price
    assert gateway.created_price_amounts == [5600]


async def test_subscription_price_and_renewal_follow_the_item_tax_class(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db, price=5000)
    item.tax_class = "federal_only"
    await db.flush()
    pm = await _saved_method(db, cid)
    ok = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert ok.status_code == 201, ok.text
    assert gateway.created_price_amounts == [5250]
    gateway.pay_invoice("in_class", "pi_class_sub", 5250)
    charge: dict[str, object] = {
        "id": "in_class",
        "parent": {"subscription_details": {"subscription": gateway.created_subscriptions[-1]}},
        "amount_paid": 5250,
        "currency": "cad",
    }
    await stripe_event(as_owner, "invoice.payment_succeeded", charge)
    paid = await payment_by_ref(db, "pi_class_sub")
    assert paid.invoice_id is not None
    minted = await invoice(db, paid.invoice_id)
    assert (minted.tax_total_cents, minted.total_cents, minted.balance_cents) == (250, 5250, 0)


async def test_cached_price_is_replaced_when_the_taxed_amount_changes(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    item = await _sub_item(db, price=5000)
    clients = [await _new_client(db, name=f"Client {n}") for n in range(4)]
    methods = [await _saved_method(db, c, ref=f"pm_{n}") for n, c in enumerate(clients)]

    async def subscribe(n: int) -> None:
        res = await as_owner.post(
            "/v1/subscriptions", json=_body(clients[n], item.id, methods[n].id)
        )
        assert res.status_code == 201, res.text

    await subscribe(0)
    first = item.stripe_price_id
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=False))
    await db.flush()
    await subscribe(1)
    item.tax_class = "federal_only"
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=True))
    await db.flush()
    await subscribe(2)
    await subscribe(3)
    assert gateway.created_price_amounts == [5600, 5000, 5250]
    assert item.stripe_price_id == gateway.created_prices[-1] != first
    rows = (await db.execute(select(Subscription).where(Subscription.item_id == item.id))).scalars()
    assert len({row.provider_ref for row in rows}) == 4


async def test_same_idempotency_key_creates_one_subscription(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid)
    body = _body(cid, item.id, pm.id)
    headers = {"Idempotency-Key": "sub-key-1"}
    r1 = await as_owner.post("/v1/subscriptions", json=body, headers=headers)
    r2 = await as_owner.post("/v1/subscriptions", json=body, headers=headers)
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    assert r1.json()["id"] == r2.json()["id"]
    assert len(gateway.created_subscriptions) == 1  # one Stripe sub
    rows = (
        (
            await db.execute(
                select(Subscription).where(
                    Subscription.client_id == cid, Subscription.item_id == item.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1


async def test_duplicate_active_subscription_conflicts(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid)
    r1 = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert r1.status_code == 201, r1.text
    r2 = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert r2.status_code == 409, r2.text
    assert len(gateway.created_subscriptions) == 1  # the duplicate never minted a second Stripe sub


async def test_cancel_subscription(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=cid,
        item_id=item.id,
        status="active",
        provider_ref="sub_existing",
    )
    db.add(sub)
    await db.flush()
    headers = key()
    res = await as_owner.post(f"/v1/subscriptions/{sub.id}/cancel", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "canceled"
    assert gateway.canceled_subscriptions.count("sub_existing") == 1
    replay = await as_owner.post(f"/v1/subscriptions/{sub.id}/cancel", headers=headers)
    assert replay.json() == res.json()
    assert gateway.canceled_subscriptions.count("sub_existing") == 1
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "canceled"


async def test_cancel_already_canceled_conflicts(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=cid,
        item_id=item.id,
        status="active",
        provider_ref="sub_cx",
    )
    db.add(sub)
    await db.flush()
    r1 = await as_owner.post(f"/v1/subscriptions/{sub.id}/cancel")
    assert r1.status_code == 200, r1.text
    r2 = await as_owner.post(f"/v1/subscriptions/{sub.id}/cancel")
    assert r2.status_code == 409, r2.text
    assert gateway.canceled_subscriptions.count("sub_cx") == 1  # Stripe canceled once only


async def test_create_with_non_subscription_item_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db, kind="service")
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 409


async def test_create_missing_interval_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db, interval=None, frequency=None)
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 422


async def test_create_unknown_payment_method_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, "pm_nope"))
    assert res.status_code == 404


async def test_staff_cannot_create_subscription(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await client_id(db)
    res = await as_staff.post("/v1/subscriptions", json=_body(cid, "it_x", "pm_x"))
    assert res.status_code == 403


async def test_cancel_cross_tenant_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other_biz = await factory.business()
    other_client = await factory.client(business=other_biz)
    other_item = await _sub_item(db, business_id=other_biz.id)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=other_biz.id,
        client_id=other_client.id,
        item_id=other_item.id,
        status="active",
        provider_ref="sub_other_biz",
    )
    db.add(sub)
    await db.flush()
    res = await as_owner.post(f"/v1/subscriptions/{sub.id}/cancel")
    assert res.status_code == 404


async def test_acss_debit_records_bank_eft_mandate(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db, account="acct_pad")
    cid = await client_id(db)
    await db.execute(update(Client).where(Client.id == cid).values(stripe_customer_id="cus_pad"))
    await db.flush()
    event = json.dumps(
        {
            "id": "evt_pad1",
            "type": "payment_method.attached",
            "account": "acct_pad",
            "data": {
                "object": {
                    "id": "pm_acss",
                    "customer": "cus_pad",
                    "type": "acss_debit",
                    "acss_debit": {"bank_name": "TD Canada Trust", "last4": "0001"},
                }
            },
        }
    )
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    pm = (
        await db.execute(select(PaymentMethod).where(PaymentMethod.provider_ref == "pm_acss"))
    ).scalar_one()
    assert pm.method == "bank_eft"
    assert pm.mandate_status == "pending"
    assert pm.brand == "TD Canada Trust" and pm.last4 == "0001"


def _sub_event(event_id: str, event_type: str, obj: dict[str, object]) -> str:
    return json.dumps(
        {"id": event_id, "type": event_type, "account": "acct_test", "data": {"object": obj}}
    )


async def _seed_sub(db: AsyncSession, *, ref: str, status: str = "active") -> Subscription:
    cid = await client_id(db)
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=cid,
        item_id=item.id,
        status=status,
        provider_ref=ref,
    )
    db.add(sub)
    await db.flush()
    return sub


async def test_subscription_updated_flips_status(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sub = await _seed_sub(db, ref="sub_wh1")
    event = _sub_event(
        "evt_su1",
        "customer.subscription.updated",
        {
            "id": "sub_wh1",
            "status": "past_due",
            "items": {
                "data": [{"current_period_start": 1735689600, "current_period_end": 1738368000}]
            },
        },
    )
    current = dict(json.loads(event)["data"]["object"])
    gateway.objects[("acct_test", "subscription", str(current["id"]))] = current
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    row = (await db.execute(select(Subscription).where(Subscription.id == sub.id))).scalar_one()
    assert row.status == "past_due"
    # the epoch timestamps parsed into the exact period, not just "something non-null"
    assert row.current_period_end == datetime(2025, 2, 1, tzinfo=UTC)


async def test_invoice_payment_succeeded_records_payment(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.pay_invoice("in_1", "pi_sub1", 5600)
    sub = await _seed_sub(db, ref="sub_inv1")
    obj: dict[str, object] = {
        "id": "in_1",
        "parent": {"subscription_details": {"subscription": "sub_inv1"}},
        "amount_paid": 5600,
        "currency": "cad",
        "status_transitions": {"paid_at": int(PAID_AT.timestamp())},
    }
    res = await api.post(
        "/webhooks/stripe",
        content=_sub_event("evt_inv1", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res.status_code == 200
    pay = (await db.execute(select(Payment).where(Payment.provider_ref == "pi_sub1"))).scalar_one()
    assert pay.status == "succeeded"
    assert pay.amount_cents == 5600 and pay.currency == "CAD"
    assert pay.client_id == sub.client_id and pay.kind == "payment"
    assert pay.invoice_id is not None  # the recurring charge minted a paid invoice
    assert pay.paid_at == PAID_AT  # when Stripe took the money, not when the webhook arrived
    # re-delivery (different event id, same charge) must not double-record
    res2 = await api.post(
        "/webhooks/stripe",
        content=_sub_event("evt_inv2", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res2.status_code == 200
    rows = (
        (await db.execute(select(Payment).where(Payment.provider_ref == "pi_sub1"))).scalars().all()
    )
    assert len(rows) == 1


async def test_a_recurring_charge_in_another_currency_is_refused(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.pay_invoice("in_usd", "pi_sub_usd", 5600)
    await _seed_sub(db, ref="sub_usd")
    obj: dict[str, object] = {
        "id": "in_usd",
        "parent": {"subscription_details": {"subscription": "sub_usd"}},
        "amount_paid": 5600,
        "currency": "usd",
    }
    res = await api.post(
        "/webhooks/stripe",
        content=_sub_event("evt_usd", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res.status_code == 200
    booked = await db.execute(select(Payment.id).where(Payment.provider_ref == "pi_sub_usd"))
    assert booked.scalar_one_or_none() is None
    refused = await db.execute(
        select(Audit.changes).where(Audit.action == "payment.refused", Audit.business_id == BIZ)
    )
    assert {"id": "pi_sub_usd", "currency": "USD", "amount_cents": 5600} in refused.scalars().all()


async def test_recurring_charge_taxed_and_in_gst_report(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.pay_invoice("in_g1", "pi_gst1", 5600)
    cid = await _new_client(db, name="GST Client")
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=cid,
        item_id=item.id,
        status="active",
        provider_ref="sub_gst1",
    )
    db.add(sub)
    await db.flush()
    # ±1 day keeps the window stable across timezones; the before/after delta still isolates 600
    day = clock.now().date()
    start = (day - timedelta(days=1)).isoformat()
    end = (day + timedelta(days=1)).isoformat()
    before = (await as_owner.get(f"/v1/reports/gst-hst?start={start}&end={end}")).json()
    obj: dict[str, object] = {
        "id": "in_g1",
        "parent": {"subscription_details": {"subscription": "sub_gst1"}},
        "amount_paid": 5600,
        "currency": "cad",
    }
    res = await as_owner.post(
        "/webhooks/stripe",
        content=_sub_event("evt_g1", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res.status_code == 200
    pay = (await db.execute(select(Payment).where(Payment.provider_ref == "pi_gst1"))).scalar_one()
    assert pay.invoice_id is not None
    inv = (await db.execute(select(Invoice).where(Invoice.id == pay.invoice_id))).scalar_one()
    status, paid_at = await ledger.invoice_state(db, inv)
    assert status == "paid" and paid_at is not None
    assert inv.subtotal_cents == 5000 and inv.tax_total_cents == 600 and inv.total_cents == 5600
    after = (await as_owner.get(f"/v1/reports/gst-hst?start={start}&end={end}")).json()
    # BC 12% tax on $50 = 600, split 250 federal GST/HST + 350 PST
    assert after["tax_collected_cents"] - before["tax_collected_cents"] == 250
    assert after["pst_cents"] - before["pst_cents"] == 350
    # re-delivery must not mint a second invoice/payment
    res2 = await as_owner.post(
        "/webhooks/stripe",
        content=_sub_event("evt_g2", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res2.status_code == 200
    pays = (
        (await db.execute(select(Payment).where(Payment.provider_ref == "pi_gst1"))).scalars().all()
    )
    assert len(pays) == 1
    invoices = (
        (
            await db.execute(
                select(Invoice).where(
                    Invoice.client_id == sub.client_id, ledger.invoice_status_expr() == "paid"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(invoices) == 1


async def test_invoice_payment_failed_sets_past_due_and_notifies(
    api: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
    gateway: FakePaymentGateway,
) -> None:
    await enable_payments(db)
    cid = await _new_client(db, name="Past Due Client")
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=cid,
        item_id=item.id,
        status="active",
        provider_ref="sub_fail1",
    )
    db.add(sub)
    await db.flush()
    event = _sub_event(
        "evt_f1",
        "invoice.payment_failed",
        {"id": "in_2", "parent": {"subscription_details": {"subscription": "sub_fail1"}}},
    )
    current: dict[str, object] = {"id": "sub_fail1", "status": "past_due"}
    gateway.objects[("acct_test", "subscription", str(current["id"]))] = current
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "past_due"
    assert any(m.to == "+16045550223" for m in sms.sent)


async def test_subscription_deleted_notifies_client(
    api: httpx.AsyncClient,
    db: AsyncSession,
    sms: FakeSmsSender,
    gateway: FakePaymentGateway,
) -> None:
    await enable_payments(db)
    cid = await _new_client(db, name="Canceled Client")
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=cid,
        item_id=item.id,
        status="active",
        provider_ref="sub_del1",
    )
    db.add(sub)
    await db.flush()
    event = _sub_event("evt_del1", "customer.subscription.deleted", {"id": "sub_del1"})
    current = dict(json.loads(event)["data"]["object"])
    current["status"] = "canceled"
    gateway.objects[("acct_test", "subscription", str(current["id"]))] = current
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "canceled"
    assert any(m.to == "+16045550223" for m in sms.sent)


async def test_an_expired_incomplete_membership_reads_as_canceled(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sub = await _seed_sub(db, ref="sub_odd", status="past_due")
    event = _sub_event(
        "evt_odd",
        "customer.subscription.updated",
        {"id": "sub_odd", "status": "incomplete_expired"},
    )
    current = dict(json.loads(event)["data"]["object"])
    gateway.objects[("acct_test", "subscription", str(current["id"]))] = current
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "canceled"


@pytest.mark.parametrize(
    ("stripe_status", "ours"),
    [
        ("active", "active"),
        ("trialing", "active"),
        ("past_due", "past_due"),
        ("unpaid", "past_due"),
        ("incomplete", "past_due"),
        ("incomplete_expired", "canceled"),
        ("paused", "paused"),
        ("canceled", "canceled"),
        ("something_new", "past_due"),
    ],
)
def test_each_stripe_status_maps_to_ours(stripe_status: str, ours: str) -> None:
    assert map_subscription_status(stripe_status) == ours


async def test_a_paid_invoice_without_an_invoice_payment_is_audited_once_and_not_retried(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sub = await _seed_sub(db, ref="sub_oob")
    payments = select(func.count()).select_from(Payment).where(Payment.client_id == sub.client_id)
    before = await db.scalar(payments)
    obj: dict[str, object] = {
        "id": "in_oob",
        "parent": {"subscription_details": {"subscription": "sub_oob"}},
        "amount_paid": 5600,
        "currency": "cad",
    }
    for event_id in ("evt_oob1", "evt_oob2"):
        res = await api.post(
            "/webhooks/stripe",
            content=_sub_event(event_id, "invoice.payment_succeeded", obj),
            headers=GOOD,
        )
        assert res.status_code == 200
    assert await db.scalar(payments) == before
    audits = await db.execute(
        select(Audit.changes).where(
            Audit.action == "subscription.paid_outside_stripe", Audit.entity_id == sub.id
        )
    )
    assert audits.scalars().all() == [{"invoice": "in_oob", "amount_cents": 5600}]


async def test_a_renewal_books_the_invoice_payment_amount(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    await _seed_sub(db, ref="sub_part")
    gateway.pay_invoice("in_part", "pi_part", 5600)
    obj: dict[str, object] = {
        "id": "in_part",
        "parent": {"subscription_details": {"subscription": "sub_part"}},
        "amount_paid": 7000,
        "currency": "cad",
    }
    await stripe_event(api, "invoice.payment_succeeded", obj)
    paid = await payment_by_ref(db, "pi_part")
    assert paid.amount_cents == 5600


async def test_zero_amount_invoice_records_nothing(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    await _seed_sub(db, ref="sub_free")
    obj: dict[str, object] = {
        "id": "in_free",
        "parent": {"subscription_details": {"subscription": "sub_free"}},
        "amount_paid": 0,
        "currency": "cad",
    }
    res = await api.post(
        "/webhooks/stripe",
        content=_sub_event("evt_free", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res.status_code == 200


async def _active_sub(db: AsyncSession, ref: str) -> Subscription:
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=await client_id(db),
        item_id=item.id,
        status="active",
        provider_ref=ref,
    )
    db.add(sub)
    await db.flush()
    return sub


async def test_create_without_stripe_connected_409(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db, None)
    cid = await client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 409
    assert gateway.created_subscriptions == []


async def test_create_unknown_or_foreign_client_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    await enable_payments(db)
    item = await _sub_item(db)
    foreign = await factory.client(business=await factory.business())
    for cid in ("cl_nope", foreign.id):
        res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, "pm_x"))
        assert res.status_code == 404


async def test_create_unknown_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, "it_nope", pm.id))
    assert res.status_code == 404


async def test_staff_cannot_cancel_subscription(
    as_staff: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    sub = await _active_sub(db, "sub_staff")
    assert (await as_staff.post(f"/v1/subscriptions/{sub.id}/cancel")).status_code == 403
    assert gateway.canceled_subscriptions == []


@pytest.mark.parametrize("path", ["/v1/subscriptions", "/v1/subscriptions/sub_x/cancel"])
async def test_writes_need_a_session_401(unauth: httpx.AsyncClient, path: str) -> None:
    body = {"client_id": "cl_x", "item_id": "it_x", "payment_method_id": "pm_x"}
    assert (await unauth.post(path, json=body)).status_code == 401


async def test_a_cached_price_gone_from_stripe_is_replaced(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    item.stripe_price_id = "price_deleted"
    await db.flush()
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 201, res.text
    await db.refresh(item)
    assert item.stripe_price_id == gateway.created_prices[-1] != "price_deleted"


async def _renew(
    api: httpx.AsyncClient, gateway: FakePaymentGateway, db: AsyncSession, ref: str, paid: int
) -> InvoiceOut:
    sub_ref = gateway.created_subscriptions[-1]
    gateway.pay_invoice(f"in_{ref}", f"pi_{ref}", paid)
    details = {"subscription": sub_ref, "metadata": gateway.subscription_metadata[sub_ref]}
    charge: dict[str, object] = {
        "id": f"in_{ref}",
        "parent": {"subscription_details": details},
        "amount_paid": paid,
        "currency": "cad",
    }
    await stripe_event(api, "invoice.payment_succeeded", charge)
    payment = await payment_by_ref(db, f"pi_{ref}")
    assert payment.invoice_id is not None
    return await invoice(db, payment.invoice_id)


async def _subscribe(as_owner: httpx.AsyncClient, db: AsyncSession, item: Item) -> None:
    cid = await client_id(db)
    pm = await _saved_method(db, cid)
    ok = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert ok.status_code == 201, ok.text


async def _set_registered(db: AsyncSession, registered: bool) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(tax_registered=registered))
    await db.flush()


async def test_a_renewal_books_what_was_charged_when_price_or_tax_class_changed(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    item = await _sub_item(db, price=5000)
    await _subscribe(as_owner, db, item)
    assert gateway.created_price_amounts == [5600]
    item.price_cents = 7000
    item.tax_class = "federal_only"
    await db.flush()
    renewed = await _renew(as_owner, gateway, db, "renew", 5600)
    assert (renewed.tax_total_cents, renewed.total_cents, renewed.balance_cents) == (600, 5600, 0)


async def test_registering_mid_membership_taxes_the_next_renewal(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    await _set_registered(db, False)
    item = await _sub_item(db, price=5000)
    await _subscribe(as_owner, db, item)
    assert gateway.created_price_amounts == [5000]
    await _set_registered(db, True)
    renewed = await _renew(as_owner, gateway, db, "registered", 5000)
    # BC 12% backed out of the unchanged 5000 tax-inclusive price
    assert (renewed.subtotal_cents, renewed.tax_total_cents, renewed.total_cents) == (
        4464,
        536,
        5000,
    )


async def test_deregistering_mid_membership_stops_taxing_renewals(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    item = await _sub_item(db, price=5000)
    await _subscribe(as_owner, db, item)
    assert gateway.created_price_amounts == [5600]
    await _set_registered(db, False)
    renewed = await _renew(as_owner, gateway, db, "deregistered", 5600)
    assert (renewed.subtotal_cents, renewed.tax_total_cents, renewed.total_cents) == (
        5600,
        0,
        5600,
    )


async def test_a_renewal_is_issued_and_taxed_at_the_period_stripe_billed(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    gateway.pay_invoice("in_period", "pi_period", 5600)
    await _seed_sub(db, ref="sub_period")
    start = datetime(2026, 9, 1, tzinfo=UTC)
    obj: dict[str, object] = {
        "id": "in_period",
        "parent": {"subscription_details": {"subscription": "sub_period"}},
        "amount_paid": 5600,
        "currency": "cad",
        "status_transitions": {"paid_at": int(PAID_AT.timestamp())},
        "lines": {"data": [{"period": {"start": int(start.timestamp())}}]},
    }
    res = await api.post(
        "/webhooks/stripe",
        content=_sub_event("evt_period", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res.status_code == 200
    paid = await payment_by_ref(db, "pi_period")
    assert paid.invoice_id is not None
    renewed = await invoice(db, paid.invoice_id)
    assert renewed.issued_at == start and paid.paid_at == PAID_AT


@pytest.mark.parametrize(
    ("start", "split"),
    [
        # 2026-10-01 05:00 UTC is still September 30 in Vancouver
        (datetime(2026, 10, 1, 5, tzinfo=UTC), (5600, 0)),
        (datetime(2026, 10, 1, 8, tzinfo=UTC), (5000, 600)),
    ],
)
async def test_a_late_renewal_is_split_with_the_registration_at_its_period_start(
    api: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    start: datetime,
    split: tuple[int, int],
) -> None:
    await enable_payments(db)
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(tax_registered=True, tax_registered_on=date(2026, 10, 1))
    )
    gateway.pay_invoice("in_late", "pi_late", 5600)
    await _seed_sub(db, ref="sub_late")
    obj: dict[str, object] = {
        "id": "in_late",
        "parent": {"subscription_details": {"subscription": "sub_late"}},
        "amount_paid": 5600,
        "currency": "cad",
        "status_transitions": {"paid_at": int(PAID_AT.timestamp())},
        "lines": {"data": [{"period": {"start": int(start.timestamp())}}]},
    }
    res = await api.post(
        "/webhooks/stripe",
        content=_sub_event("evt_late", "invoice.payment_succeeded", obj),
        headers=GOOD,
    )
    assert res.status_code == 200
    paid = await payment_by_ref(db, "pi_late")
    assert paid.invoice_id is not None
    renewed = await invoice(db, paid.invoice_id)
    assert (renewed.subtotal_cents, renewed.tax_total_cents, renewed.total_cents) == (*split, 5600)


async def test_stale_subscription_update_cannot_restore_canceled_membership(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sub = await _seed_sub(db, ref="sub_stale")
    gateway.objects[("acct_test", "subscription", "sub_stale")] = {
        "id": "sub_stale",
        "status": "canceled",
    }
    event = _sub_event(
        "evt_stale", "customer.subscription.updated", {"id": "sub_stale", "status": "active"}
    )
    assert (await api.post("/webhooks/stripe", content=event, headers=GOOD)).status_code == 200
    await db.refresh(sub)
    assert sub.status == "canceled"


async def test_old_failed_invoice_does_not_mark_recovered_subscription_past_due(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway, email: FakeEmailSender
) -> None:
    await enable_payments(db)
    sub = await _seed_sub(db, ref="sub_recovered")
    gateway.objects[("acct_test", "subscription", "sub_recovered")] = {
        "id": "sub_recovered",
        "status": "active",
    }
    event = _sub_event(
        "evt_old_failure",
        "invoice.payment_failed",
        {"id": "in_old", "parent": {"subscription_details": {"subscription": "sub_recovered"}}},
    )
    assert (await api.post("/webhooks/stripe", content=event, headers=GOOD)).status_code == 200
    await db.refresh(sub)
    assert sub.status == "active"
    assert email.sent == []


async def test_a_lapsed_business_can_cancel_a_subscription_but_not_start_one(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=cid,
        item_id=item.id,
        status="active",
        provider_ref="sub_lapsed",
    )
    db.add(sub)
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(plan=None, plan_status="trialing", trial_ends_at=clock.now() - timedelta(days=1))
    )
    pm = await _saved_method(db, cid)
    started = await as_owner.post(
        "/v1/subscriptions", json=_body(cid, item.id, pm.id), headers=key()
    )
    assert started.status_code == 402
    res = await as_owner.post(f"/v1/subscriptions/{sub.id}/cancel", headers=key())
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "canceled"
    assert gateway.canceled_subscriptions.count("sub_lapsed") == 1


async def test_a_new_membership_names_the_business_and_client_on_stripe(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid)
    ok = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert ok.status_code == 201, ok.text
    assert gateway.subscription_metadata[gateway.created_subscriptions[-1]] == {
        "business_id": BIZ,
        "client_id": cid,
        "tax_class": "standard",
    }


def _early_invoice(sub_ref: str, business_id: str = BIZ) -> dict[str, object]:
    metadata = {"business_id": business_id, "client_id": "cl_early"}
    details = {"subscription": sub_ref, "metadata": metadata}
    return {
        "id": f"in_{sub_ref}",
        "parent": {"subscription_details": details},
        "amount_paid": 5600,
        "currency": "cad",
    }


async def test_an_early_renewal_event_for_our_membership_is_retried_until_the_row_commits(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    await db.commit()
    gateway.pay_invoice("in_sub_early", "pi_early", 5600)
    event = _sub_event("evt_early", "invoice.payment_succeeded", _early_invoice("sub_early"))
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 503 and res.json()["error"] == "retry_later"
    await db.rollback()
    await _seed_sub(db, ref="sub_early")
    again = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert again.status_code == 200
    assert (await payment_by_ref(db, "pi_early")).amount_cents == 5600


async def test_an_early_update_for_our_membership_is_retried(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    await db.commit()
    obj: dict[str, object] = {
        "id": "sub_early_up",
        "status": "active",
        "metadata": {"business_id": BIZ, "client_id": "cl_early"},
    }
    event = _sub_event("evt_early_up", "customer.subscription.updated", obj)
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 503


@pytest.mark.parametrize(
    ("account", "metadata"),
    [
        ("acct_test", {}),
        ("acct_test", {"business_id": "bz_nope"}),
        ("acct_other", {"business_id": BIZ, "client_id": "cl_early"}),
        ("acct_test", {"business_id": BIZ}),
    ],
)
async def test_an_unknown_subscription_that_is_not_ours_is_ignored(
    api: httpx.AsyncClient, db: AsyncSession, account: str, metadata: dict[str, str]
) -> None:
    await enable_payments(db)
    details = {"subscription": "sub_foreign", "metadata": metadata}
    obj = {"id": "in_foreign", "parent": {"subscription_details": details}, "amount_paid": 5600}
    event = json.dumps(
        {
            "id": f"evt_foreign_{account}_{len(metadata)}",
            "type": "invoice.payment_succeeded",
            "account": account,
            "data": {"object": obj},
        }
    )
    assert (await api.post("/webhooks/stripe", content=event, headers=GOOD)).status_code == 200


@pytest.mark.parametrize(("method", "percent"), [("card", 0.3), ("bank_eft", 2.0)])
async def test_a_membership_charges_the_platform_fee_at_the_charge_rate(
    as_owner: httpx.AsyncClient,
    db: AsyncSession,
    gateway: FakePaymentGateway,
    method: str,
    percent: float,
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid, method=method)
    pm.mandate_status = "active"
    await db.flush()
    ok = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert ok.status_code == 201, ok.text
    assert gateway.subscription_fee_percents[gateway.created_subscriptions[-1]] == percent


async def test_a_renewal_books_the_application_fee_stripe_took(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    await _subscribe(as_owner, db, await _sub_item(db, price=5000))
    before = await business_balance(db, "platform_fee")
    gateway.charges["pi_fee"] = (5600, 17)
    await _renew(as_owner, gateway, db, "fee", 5600)
    assert await business_balance(db, "platform_fee") - before == 17


async def _fail_invoice(
    api: httpx.AsyncClient, event_id: str, invoice_id: str, sub_ref: str
) -> None:
    obj: dict[str, object] = {
        "id": invoice_id,
        "parent": {"subscription_details": {"subscription": sub_ref}},
    }
    event = _sub_event(event_id, "invoice.payment_failed", obj)
    assert (await api.post("/webhooks/stripe", content=event, headers=GOOD)).status_code == 200


async def test_each_failed_invoice_sends_one_past_due_notice(
    api: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sub = await _seed_sub(db, ref="sub_episodes")
    phone = await db.scalar(select(Client.phone).where(Client.id == sub.client_id))
    gateway.objects[("acct_test", "subscription", "sub_episodes")] = {
        "id": "sub_episodes",
        "status": "past_due",
    }
    await _fail_invoice(api, "evt_ep1", "in_ep1", "sub_episodes")
    await _fail_invoice(api, "evt_ep1_retry", "in_ep1", "sub_episodes")
    assert len([m for m in sms.sent if m.to == phone]) == 1
    await _fail_invoice(api, "evt_ep2", "in_ep2", "sub_episodes")
    assert len([m for m in sms.sent if m.to == phone]) == 2


async def test_archiving_a_client_ends_their_memberships_at_period_end(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sub = await _active_sub(db, "sub_archive")
    ended = await _seed_sub(db, ref="sub_archive_done", status="canceled")
    res = await as_owner.post(f"/v1/clients/{sub.client_id}/archive", headers=key())
    assert res.status_code == 200, res.text
    assert gateway.period_end_cancels == ["sub_archive"]
    assert ended.provider_ref not in gateway.canceled_subscriptions
    await db.refresh(sub)
    assert sub.status == "active"  # it bills nothing more and ends when Stripe says so


async def test_archiving_clients_in_bulk_ends_their_memberships_at_period_end(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    sub = await _active_sub(db, "sub_bulk")
    res = await as_owner.post(
        "/v1/clients/archive", json={"client_ids": [sub.client_id]}, headers=key()
    )
    assert res.status_code == 200, res.text
    assert gateway.period_end_cancels == ["sub_bulk"]


async def test_a_lost_dispute_on_a_renewal_cancels_the_membership_now(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    await _subscribe(as_owner, db, await _sub_item(db, price=5000))
    sub_ref = gateway.created_subscriptions[-1]
    await _renew(as_owner, gateway, db, "disputed", 5600)
    dispute = {"id": "dp_sub", "payment_intent": "pi_disputed", "amount": 5600}
    await stripe_event(as_owner, "charge.dispute.created", {**dispute, "status": "needs_response"})
    assert gateway.canceled_subscriptions == []
    await stripe_event(as_owner, "charge.dispute.closed", {**dispute, "status": "lost"})
    assert gateway.canceled_subscriptions == [sub_ref]
    status = await db.scalar(
        select(Subscription.status).where(Subscription.provider_ref == sub_ref)
    )
    assert status == "canceled"


async def test_a_price_edit_leaves_existing_members_on_their_price(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    item = await _sub_item(db, price=5000)
    await _subscribe(as_owner, db, item)
    first = gateway.created_subscriptions[-1]
    old_price = gateway.subscription_prices[first]
    edited = await as_owner.patch(f"/v1/items/{item.id}", json={"price_cents": 7000})
    assert edited.status_code == 200, edited.text
    newcomer = await _new_client(db, name="Newcomer")
    pm = await _saved_method(db, newcomer, ref="pm_newcomer")
    ok = await as_owner.post("/v1/subscriptions", json=_body(newcomer, item.id, pm.id))
    assert ok.status_code == 201, ok.text
    assert gateway.subscription_prices[first] == old_price
    assert gateway.subscription_prices[gateway.created_subscriptions[-1]] != old_price
    assert gateway.created_price_amounts == [5600, 7840]


async def test_resubscribing_after_a_cancel_starts_a_new_stripe_subscription(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid)
    first = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id), headers=key())
    assert first.status_code == 201, first.text
    canceled = await as_owner.post(f"/v1/subscriptions/{first.json()['id']}/cancel", headers=key())
    assert canceled.status_code == 200, canceled.text
    again = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id), headers=key())
    assert again.status_code == 201, again.text
    assert again.json()["id"] != first.json()["id"]
    assert len(set(gateway.created_subscriptions)) == 2


async def test_a_new_attempt_with_another_card_is_not_replayed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    item = await _sub_item(db)
    declined = await _saved_method(db, cid, ref="pm_card_declined")
    good = await _saved_method(db, cid, ref="pm_good_sub")
    first, second = _body(cid, item.id, declined.id), _body(cid, item.id, good.id)
    refused = await as_owner.post("/v1/subscriptions", json=first, headers=key())
    assert refused.status_code == 402, refused.text
    ok = await as_owner.post("/v1/subscriptions", json=second, headers=key())
    assert ok.status_code == 201, ok.text
