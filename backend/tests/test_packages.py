"""Package purchase (charge now, grant on settlement) + session consumption, vs the seeded DB."""

import json

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item, Package
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from tests.conftest import BIZ, Factory, FakePaymentGateway

PKG_ITEM = "it_pkg5"  # seeded package item: price $200, session_count = 5, GST+PST taxable
PKG_TAXED = 22400  # $200 + 12% (BC GST 5% + PST 7%)
CARD_CLIENT = "cl_marcus"  # seeded client with a default saved card (pm_demo_5454)


async def _enable(db: AsyncSession) -> None:
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(stripe_account_id="acct_test", stripe_charges_enabled=True)
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


async def _package_item(db: AsyncSession, *, business_id: str = BIZ, sessions: int | None) -> str:
    item = Item(
        id=new_id("item"),
        business_id=business_id,
        kind="package",
        name="Custom Package",
        price_cents=20000,
        session_count=sessions,
    )
    db.add(item)
    await db.flush()
    return item.id


async def _active_package(db: AsyncSession, *, total: int = 5, used: int = 0) -> Package:
    pkg = Package(
        id=new_id("package"),
        business_id=BIZ,
        client_id=CARD_CLIENT,
        item_id=PKG_ITEM,
        sessions_total=total,
        sessions_used=used,
        status="active",
    )
    db.add(pkg)
    await db.flush()
    return pkg


async def _settle(api: httpx.AsyncClient, db: AsyncSession, payment_id: str, event_id: str) -> None:
    ref = (
        await db.execute(select(Payment.provider_ref).where(Payment.id == payment_id))
    ).scalar_one()
    event = json.dumps(
        {"id": event_id, "type": "payment_intent.succeeded", "data": {"object": {"id": ref}}}
    )
    res = await api.post("/webhooks/stripe", content=event, headers={"Stripe-Signature": "good"})
    assert res.status_code == 200, res.text


# ── purchase: charge now, grant pending, activate on settlement ───────────────────────────────
async def test_purchase_off_session_creates_pending_package_and_payment(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    res = await as_owner.post(
        "/v1/packages",
        json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["package_id"].startswith("pkg_")
    assert body["payment_id"].startswith("pay_")
    assert body["client_secret"]

    pkg = (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert pkg.status == "pending"
    assert pkg.payment_id == pay.id
    assert pkg.sessions_total == 5
    assert pay.status == "pending" and pay.kind == "payment"
    assert pay.amount_cents == PKG_TAXED  # taxed purchase amount
    assert gateway.charged_methods == ["pm_demo_5454"]  # charged off-session now


async def test_purchase_settles_to_active(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    await _settle(as_owner, db, body["payment_id"], "evt_pkg_settle")

    pkg = (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert pkg.status == "active"
    assert pay.status == "succeeded"


async def test_consume_before_activation_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    res = await as_owner.post(f"/v1/packages/{body['package_id']}/consume")
    assert res.status_code == 409


async def test_purchase_then_settle_then_consume(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    await _settle(as_owner, db, body["payment_id"], "evt_pkg_consume")
    used = await as_owner.post(f"/v1/packages/{body['package_id']}/consume")
    assert used.status_code == 200, used.text
    assert used.json()["sessions_used"] == 1
    assert used.json()["status"] == "active"


async def test_purchase_interactive_returns_client_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": PKG_ITEM})
    assert res.status_code == 201, res.text
    assert res.json()["client_secret"]
    assert gateway.charged_methods == []  # nothing charged off-session — frontend confirms
    pay = (
        await db.execute(select(Payment).where(Payment.id == res.json()["payment_id"]))
    ).scalar_one()
    assert pay.status == "pending"


async def test_purchase_not_onboarded_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    cid = await _client_id(db)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": PKG_ITEM})
    assert res.status_code == 409


async def test_purchase_unknown_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    cid = await _client_id(db)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": "it_nope"})
    assert res.status_code == 404


async def test_purchase_unknown_client_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    res = await as_owner.post("/v1/packages", json={"client_id": "cl_nope", "item_id": PKG_ITEM})
    assert res.status_code == 404


async def test_purchase_non_package_item_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await _enable(db)
    cid = await _client_id(db)
    item_id = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ, Item.kind == "product")))
        .scalars()
        .first()
    )
    assert item_id
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": item_id})
    assert res.status_code == 409


async def test_purchase_package_without_sessions_422(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    cid = await _client_id(db)
    item_id = await _package_item(db, sessions=None)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": item_id})
    assert res.status_code == 422


# ── consume lifecycle on an already-active package ────────────────────────────────────────────
async def test_consume_unknown_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/packages/pkg_nope/consume")
    assert res.status_code == 404


async def test_consume_to_full_marks_used(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    pkg = await _active_package(db, total=1)
    used = await as_owner.post(f"/v1/packages/{pkg.id}/consume")
    assert used.status_code == 200
    assert used.json()["sessions_used"] == 1
    assert used.json()["status"] == "used"
    again = await as_owner.post(f"/v1/packages/{pkg.id}/consume")
    assert again.status_code == 409


async def test_consume_active_but_exhausted_409(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = await _active_package(db, total=2, used=2)
    res = await as_owner.post(f"/v1/packages/{pkg.id}/consume")
    assert res.status_code == 409


# ── role + tenancy ────────────────────────────────────────────────────────────────────────────
async def test_staff_cannot_purchase_403(as_staff: httpx.AsyncClient, db: AsyncSession) -> None:
    res = await as_staff.post("/v1/packages", json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM})
    assert res.status_code == 403


async def test_staff_cannot_consume_403(as_staff: httpx.AsyncClient) -> None:
    res = await as_staff.post("/v1/packages/pkg_whatever/consume")
    assert res.status_code == 403


async def test_other_business_package_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    pkg = Package(
        id=new_id("package"),
        business_id=other.id,
        client_id=CARD_CLIENT,
        item_id=PKG_ITEM,
        sessions_total=5,
        sessions_used=0,
        status="active",
    )
    db.add(pkg)
    await db.flush()
    res = await as_owner.post(f"/v1/packages/{pkg.id}/consume")
    assert res.status_code == 404


async def test_idempotent_purchase_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    headers = {"Idempotency-Key": "pkg-buy-1"}
    body = {"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"}
    first = await as_owner.post("/v1/packages", json=body, headers=headers)
    second = await as_owner.post("/v1/packages", json=body, headers=headers)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["package_id"] == second.json()["package_id"]
    assert first.json()["payment_id"] == second.json()["payment_id"]
    assert gateway.charged_methods.count("pm_demo_5454") == 1  # one off-session charge
    packages = (
        await db.execute(select(Package.id).where(Package.id == first.json()["package_id"]))
    ).all()
    payments = (
        await db.execute(select(Payment.id).where(Payment.id == first.json()["payment_id"]))
    ).all()
    assert len(packages) == 1 and len(payments) == 1


async def test_distinct_keys_purchase_twice(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await _enable(db)
    body = {"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"}
    first = await as_owner.post("/v1/packages", json=body, headers={"Idempotency-Key": "k1"})
    second = await as_owner.post("/v1/packages", json=body, headers={"Idempotency-Key": "k2"})
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["package_id"] != second.json()["package_id"]
    assert first.json()["payment_id"] != second.json()["payment_id"]
    assert gateway.charged_methods.count("pm_demo_5454") == 2


async def test_refund_cancels_settled_package(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await _enable(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    await _settle(as_owner, db, body["payment_id"], "evt_pkg_refund")
    pkg = (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()
    assert pkg.status == "active"
    refunded = await as_owner.post(f"/v1/payments/{body['payment_id']}/refund")
    assert refunded.status_code == 200, refunded.text
    pkg = (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()
    assert pkg.status == "canceled"
