"""EFT/PAD + recurring subscriptions: command surface + Stripe subscription webhooks."""

import json
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.billing import Invoice
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment, PaymentMethod
from tests.conftest import Factory, FakeEmailSender, FakePaymentGateway

BIZ = "bz_birchbark"
GOOD = {"Stripe-Signature": "good"}


async def _enable(db: AsyncSession, *, account: str = "acct_test") -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id=account, stripe_charges_enabled=True)
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
        id=new_id("client"), business_id=business_id, name=name, tags=[], custom_fields={}
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
    type: str = "card",
) -> PaymentMethod:
    pm = PaymentMethod(
        id=new_id("payment_method"),
        business_id=business_id,
        client_id=cid,
        type=type,
        provider="stripe",
        provider_ref=ref,
        status="active",
    )
    db.add(pm)
    await db.flush()
    return pm


def _body(cid: str, item_id: str, pm_id: str) -> dict[str, str]:
    return {"client_id": cid, "item_id": item_id, "payment_method_id": pm_id}


async def test_create_subscription_happy(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    cid = await _client_id(db)
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
    assert row.current_period_start == datetime(2030, 1, 1, tzinfo=UTC)
    assert row.current_period_end == datetime(2030, 2, 1, tzinfo=UTC)
    cached = (await db.execute(select(Item.stripe_price_id).where(Item.id == item.id))).scalar_one()
    assert cached is not None and cached.startswith("price_fake")
    assert len(gateway.created_prices) == 1


async def test_second_subscription_reuses_cached_price(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
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
    await _enable(db)
    cid = await _client_id(db)
    item = await _sub_item(db, price=5000)
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 201, res.text
    # BC + tax-registered: GST 5% + PST 7% on 5000 → 600 tax → a 5600 tax-inclusive Price
    assert gateway.created_price_amounts == [5600]


async def test_same_idempotency_key_creates_one_subscription(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    cid = await _client_id(db)
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
    await _enable(db)
    cid = await _client_id(db)
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
    await _enable(db)
    cid = await _client_id(db)
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
    res = await as_owner.post(f"/v1/subscriptions/{sub.id}/cancel")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "canceled"
    assert "sub_existing" in gateway.canceled_subscriptions
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "canceled"


async def test_cancel_already_canceled_conflicts(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    cid = await _client_id(db)
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
    await _enable(db)
    cid = await _client_id(db)
    item = await _sub_item(db, kind="service")
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 409


async def test_create_missing_interval_422(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    cid = await _client_id(db)
    item = await _sub_item(db, interval=None, frequency=None)
    pm = await _saved_method(db, cid)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert res.status_code == 422


async def test_create_unknown_payment_method_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    item = await _sub_item(db)
    res = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, "pm_nope"))
    assert res.status_code == 404


async def test_staff_cannot_create_subscription(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    cid = await _client_id(db)
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


async def test_pad_setup_intent_returns_client_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    res = await as_owner.post(f"/v1/payments/pad-setup-intent/{cid}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["client_secret"].endswith("_secret")
    assert "seti_pad_fake" in body["client_secret"]
    assert body["stripe_account_id"] == "acct_test"


async def test_pad_setup_requires_onboarding(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await db.execute(update(Business).where(Business.id == BIZ).values(stripe_account_id=None))
    await db.flush()
    cid = await _client_id(db)
    assert (await as_owner.post(f"/v1/payments/pad-setup-intent/{cid}")).status_code == 409


async def test_staff_cannot_pad_setup(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    assert (await as_staff.post(f"/v1/payments/pad-setup-intent/{cid}")).status_code == 403


async def test_acss_debit_records_bank_eft_mandate(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db, account="acct_pad")
    cid = await _client_id(db)
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
    assert pm.type == "bank_eft"
    assert pm.mandate_status == "active"
    assert pm.brand == "TD Canada Trust" and pm.last4 == "0001"


def _sub_event(event_id: str, event_type: str, obj: dict[str, object]) -> str:
    return json.dumps(
        {"id": event_id, "type": event_type, "account": "acct_test", "data": {"object": obj}}
    )


async def _seed_sub(db: AsyncSession, *, ref: str, status: str = "active") -> Subscription:
    cid = await _client_id(db)
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


async def test_subscription_updated_flips_status(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    sub = await _seed_sub(db, ref="sub_wh1")
    event = _sub_event(
        "evt_su1",
        "customer.subscription.updated",
        {
            "id": "sub_wh1",
            "status": "past_due",
            "current_period_start": 1735689600,
            "current_period_end": 1738368000,
        },
    )
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    row = (await db.execute(select(Subscription).where(Subscription.id == sub.id))).scalar_one()
    assert row.status == "past_due"
    # the epoch timestamps parsed into the exact period, not just "something non-null"
    assert row.current_period_start == datetime(2025, 1, 1, tzinfo=UTC)
    assert row.current_period_end == datetime(2025, 2, 1, tzinfo=UTC)


async def test_invoice_payment_succeeded_records_payment(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    sub = await _seed_sub(db, ref="sub_inv1")
    obj: dict[str, object] = {
        "id": "in_1",
        "subscription": "sub_inv1",
        "payment_intent": "pi_sub1",
        "amount_paid": 5600,
        "currency": "cad",
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


async def test_recurring_charge_taxed_and_in_gst_report(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
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
    # ±1 day: the report computes bounds in the business tz, so a single UTC day can miss paid_at
    # near the boundary. The wide window is tz-stable; the before/after delta still isolates 600.
    day = datetime.now(UTC).date()
    start = (day - timedelta(days=1)).isoformat()
    end = (day + timedelta(days=1)).isoformat()
    before = (await as_owner.get(f"/v1/reports/gst-hst?start={start}&end={end}")).json()
    obj: dict[str, object] = {
        "id": "in_g1",
        "subscription": "sub_gst1",
        "payment_intent": "pi_gst1",
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
    assert inv.status == "paid" and inv.paid_at is not None
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
                select(Invoice).where(Invoice.client_id == sub.client_id, Invoice.status == "paid")
            )
        )
        .scalars()
        .all()
    )
    assert len(invoices) == 1


async def test_invoice_payment_failed_sets_past_due_and_notifies(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _enable(db)
    cid = await _new_client(db, name="Past Due Client")
    await db.execute(update(Client).where(Client.id == cid).values(email="pastdue@test.ca"))
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
        "evt_f1", "invoice.payment_failed", {"id": "in_2", "subscription": "sub_fail1"}
    )
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "past_due"
    assert any(e.to == "pastdue@test.ca" for e in email.sent)  # client warned of the failed charge


async def test_subscription_deleted_notifies_client(
    api: httpx.AsyncClient, db: AsyncSession, email: FakeEmailSender
) -> None:
    await _enable(db)
    cid = await _new_client(db, name="Canceled Client")
    await db.execute(update(Client).where(Client.id == cid).values(email="canceled@test.ca"))
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
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "canceled"
    assert any(e.to == "canceled@test.ca" for e in email.sent)


async def test_unknown_status_maps_to_past_due(api: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    sub = await _seed_sub(db, ref="sub_odd")
    event = _sub_event(
        "evt_odd",
        "customer.subscription.updated",
        {"id": "sub_odd", "status": "incomplete_expired"},
    )
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "past_due"  # an unrecognized status must not leave the sub serving


def test_map_subscription_status_unknown_is_past_due() -> None:
    from clientbridge.services.payment_service import map_subscription_status

    assert map_subscription_status("incomplete_expired") == "past_due"
    assert map_subscription_status("active") == "active"
    assert map_subscription_status("trialing") == "active"
