"""EFT/PAD + recurring subscriptions: command surface + Stripe subscription webhooks."""

import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment, PaymentMethod
from tests.conftest import Factory, FakePaymentGateway

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


# ── create / cancel ──────────────────────────────────────────────────────────────────────────
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
    assert row.current_period_start is not None and row.current_period_end is not None
    cached = (await db.execute(select(Item.stripe_price_id).where(Item.id == item.id))).scalar_one()
    assert cached is not None and cached.startswith("price_fake")
    assert len(gateway.created_prices) == 1


async def test_second_subscription_reuses_cached_price(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    item = await _sub_item(db)
    pm = await _saved_method(db, cid)
    r1 = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    r2 = await as_owner.post("/v1/subscriptions", json=_body(cid, item.id, pm.id))
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    assert len(gateway.created_prices) == 1  # price created once, then reused
    assert len(gateway.created_subscriptions) == 2


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


# ── PAD setup-intent + bank_eft mandate recording ────────────────────────────────────────────
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


# ── recurring lifecycle webhooks ─────────────────────────────────────────────────────────────
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
    assert row.current_period_start is not None and row.current_period_end is not None


async def test_invoice_payment_succeeded_records_payment(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    sub = await _seed_sub(db, ref="sub_inv1")
    obj: dict[str, object] = {
        "id": "in_1",
        "subscription": "sub_inv1",
        "payment_intent": "pi_sub1",
        "amount_paid": 5000,
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
    assert pay.amount_cents == 5000 and pay.currency == "CAD"
    assert pay.client_id == sub.client_id and pay.kind == "payment"
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


async def test_invoice_payment_failed_sets_past_due(
    api: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    sub = await _seed_sub(db, ref="sub_fail1")
    event = _sub_event(
        "evt_f1", "invoice.payment_failed", {"id": "in_2", "subscription": "sub_fail1"}
    )
    res = await api.post("/webhooks/stripe", content=event, headers=GOOD)
    assert res.status_code == 200
    status = (
        await db.execute(select(Subscription.status).where(Subscription.id == sub.id))
    ).scalar_one()
    assert status == "past_due"
