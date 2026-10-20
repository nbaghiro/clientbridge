"""Package purchase (charge now, grant on settlement) + session consumption, vs the seeded DB."""

from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, Package
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services import ledger
from tests.conftest import BIZ, Factory, FakePaymentGateway
from tests.helpers import client_id, enable_payments, key, provider_ref, settle, stripe_event
from tests.helpers import key as retry_key

PKG_ITEM = "it_pkg5"  # seeded package item: price $200, session_count = 5, GST+PST taxable
PKG_TAXED = 21000  # $200 + GST 5%; animal services are PST exempt
CARD_CLIENT = "cl_marcus"  # seeded client with a default saved card (pm_demo_5454)


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
        status="active",
    )
    db.add(pkg)
    await db.flush()
    for _ in range(used):
        await ledger.post_consumption(db, pkg)
    return pkg


async def test_purchase_off_session_creates_pending_package_and_payment(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
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
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], "evt_pkg_settle")

    pkg = (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()
    pay = (await db.execute(select(Payment).where(Payment.id == body["payment_id"]))).scalar_one()
    assert pkg.status == "active"
    assert pay.status == "succeeded"


async def test_consume_before_activation_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
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
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], "evt_pkg_consume")
    used = await as_owner.post(f"/v1/packages/{body['package_id']}/consume")
    assert used.status_code == 200, used.text
    assert used.json()["sessions_used"] == 1
    assert used.json()["status"] == "active"


async def test_purchase_interactive_returns_client_secret(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": PKG_ITEM})
    assert res.status_code == 201, res.text
    assert res.json()["client_secret"]
    assert gateway.charged_methods == []  # nothing charged off-session — frontend confirms
    pay = (
        await db.execute(select(Payment).where(Payment.id == res.json()["payment_id"]))
    ).scalar_one()
    assert pay.status == "pending"


async def test_purchase_not_onboarded_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    business = await db.get(Business, BIZ)
    assert business is not None
    business.stripe_account_id = None
    business.stripe_charges_enabled = False
    await db.flush()
    cid = await client_id(db)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": PKG_ITEM})
    assert res.status_code == 409


async def test_purchase_unknown_item_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    cid = await client_id(db)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": "it_nope"})
    assert res.status_code == 404


async def test_purchase_unknown_client_404(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    res = await as_owner.post("/v1/packages", json={"client_id": "cl_nope", "item_id": PKG_ITEM})
    assert res.status_code == 404


async def test_purchase_non_package_item_409(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    await enable_payments(db)
    cid = await client_id(db)
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
    await enable_payments(db)
    cid = await client_id(db)
    item_id = await _package_item(db, sessions=None)
    res = await as_owner.post("/v1/packages", json={"client_id": cid, "item_id": item_id})
    assert res.status_code == 422


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
        status="active",
    )
    db.add(pkg)
    await db.flush()
    res = await as_owner.post(f"/v1/packages/{pkg.id}/consume")
    assert res.status_code == 404


async def test_idempotent_purchase_replays(
    as_owner: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    await enable_payments(db)
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
    await enable_payments(db)
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
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], "evt_pkg_refund")
    pkg = (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()
    assert pkg.status == "active"
    refunded = await as_owner.post(
        f"/v1/payments/{body['payment_id']}/refund", json={}, headers=retry_key()
    )
    assert refunded.status_code == 200, refunded.text
    pkg = (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()
    assert pkg.status == "canceled"


async def _settled_package(as_owner: httpx.AsyncClient, db: AsyncSession, event: str) -> Package:
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    await settle(as_owner, db, body["payment_id"], event)
    return (await db.execute(select(Package).where(Package.id == body["package_id"]))).scalar_one()


async def test_a_lost_chargeback_cancels_the_package(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    """Otherwise consume_session keeps granting sessions the business was never paid for."""
    await enable_payments(db)
    pkg = await _settled_package(as_owner, db, "evt_pkg_dispute")
    assert pkg.payment_id is not None
    pi = await provider_ref(db, pkg.payment_id)
    dispute = {"id": "dp_pkg", "payment_intent": pi, "amount": PKG_TAXED}
    await stripe_event(as_owner, "charge.dispute.created", {**dispute, "status": "needs_response"})
    assert await _package_status(db, pkg.id) == "active"  # the case is open; it may still be won
    await stripe_event(as_owner, "charge.dispute.closed", {**dispute, "status": "lost"})
    assert await _package_status(db, pkg.id) == "canceled"
    refused = await as_owner.post(f"/v1/packages/{pkg.id}/consume", headers=key())
    assert refused.status_code == 409


async def test_a_refund_that_fails_restores_the_package(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    pkg = await _settled_package(as_owner, db, "evt_pkg_refund_fails")
    assert pkg.payment_id is not None
    pi = await provider_ref(db, pkg.payment_id)
    refund = {"id": "re_pkg", "payment_intent": pi, "amount": PKG_TAXED}
    await stripe_event(as_owner, "refund.created", {**refund, "status": "succeeded"})
    assert await _package_status(db, pkg.id) == "canceled"
    await stripe_event(as_owner, "refund.updated", {**refund, "status": "failed"})
    assert await _package_status(db, pkg.id) == "active"


async def _package_status(db: AsyncSession, package_id: str) -> str:
    query = select(Package.status).where(Package.id == package_id)
    return str((await db.execute(query.execution_options(populate_existing=True))).scalar_one())


async def test_consume_replays_on_the_same_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = await _active_package(db, total=3)
    headers = key()
    first = await as_owner.post(f"/v1/packages/{pkg.id}/consume", headers=headers)
    again = await as_owner.post(f"/v1/packages/{pkg.id}/consume", headers=headers)
    assert first.status_code == again.status_code == 200
    assert again.json() == first.json()
    assert await ledger.sessions_used(db, pkg) == 1


@pytest.mark.parametrize("path", ["/v1/packages", "/v1/packages/pkg_whatever/consume"])
async def test_writes_need_a_session_401(unauth: httpx.AsyncClient, path: str) -> None:
    body = {"client_id": CARD_CLIENT, "item_id": PKG_ITEM}
    assert (await unauth.post(path, json=body)).status_code == 401


async def test_settlement_books_the_tax_charged_even_after_registration_changed(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    body = (
        await as_owner.post(
            "/v1/packages",
            json={"client_id": CARD_CLIENT, "item_id": PKG_ITEM, "payment_method_id": "default"},
        )
    ).json()
    business = await db.get(Business, BIZ)
    assert business is not None
    business.tax_registered = False
    await db.flush()
    before = await ledger.balance(
        db, BIZ, owner_type="business", owner_id=BIZ, category="tax", code="GST"
    )
    await settle(as_owner, db, body["payment_id"], "evt_pkg_unregistered")
    after = await ledger.balance(
        db, BIZ, owner_type="business", owner_id=BIZ, category="tax", code="GST"
    )
    assert abs(after - before) == PKG_TAXED - 20000


async def _bath_visit(db: AsyncSession, *, starts_in: timedelta = timedelta(days=-400)) -> Booking:
    start = clock.now() + starts_in
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id="it_bath",
        staff_id="st_owner",
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        starts_at=start,
        staff_id="st_owner",
        client_id=CARD_CLIENT,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    return booking


async def _cover(api: httpx.AsyncClient, pkg: Package, booking: Booking) -> httpx.Response:
    return await api.post(
        f"/v1/packages/{pkg.id}/cover", json={"booking_id": booking.id}, headers=retry_key()
    )


async def test_a_package_covers_a_started_visit_and_completes_it(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = await _active_package(db, total=5, used=4)
    booking = await _bath_visit(db)
    res = await _cover(as_owner, pkg, booking)
    assert res.status_code == 200, res.text
    assert (res.json()["sessions_used"], res.json()["status"]) == (5, "used")
    row = await db.get(Booking, booking.id, populate_existing=True)
    slot = await db.get(Slot, booking.slot_id, populate_existing=True)
    assert row is not None and slot is not None
    assert (row.status, row.package_id, slot.status) == ("completed", pkg.id, "completed")


async def test_covering_replays_and_refuses_a_second_use(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = await _active_package(db)
    booking = await _bath_visit(db)
    headers = retry_key()
    path = f"/v1/packages/{pkg.id}/cover"
    first = await as_owner.post(path, json={"booking_id": booking.id}, headers=headers)
    again = await as_owner.post(path, json={"booking_id": booking.id}, headers=headers)
    assert first.status_code == again.status_code == 200
    assert again.json()["sessions_used"] == 1
    assert (await _cover(as_owner, pkg, booking)).status_code == 409


@pytest.mark.parametrize("case", ["ahead", "used_up", "other_client", "other_service"])
async def test_covering_refuses_a_visit_the_package_cannot_settle(
    as_owner: httpx.AsyncClient, db: AsyncSession, case: str
) -> None:
    pkg = await _active_package(db, used=5 if case == "used_up" else 0)
    booking = await _bath_visit(
        db, starts_in=timedelta(days=400) if case == "ahead" else timedelta(days=-400)
    )
    if case == "other_client":
        booking.client_id = await client_id(db)
        assert booking.client_id != CARD_CLIENT
    if case == "other_service":
        slot = await db.get(Slot, booking.slot_id)
        assert slot is not None
        slot.item_id = "it_groom_lg"
    await db.flush()
    assert (await _cover(as_owner, pkg, booking)).status_code == 409


async def test_staff_cover_only_their_own_visits(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg = await _active_package(db)
    booking = await _bath_visit(db)
    assert (await _cover(as_staff, pkg, booking)).status_code == 403


async def test_a_package_from_another_business_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Elsewhere")
    pkg = await _active_package(db)
    pkg.business_id = other.id
    await db.flush()
    assert (await _cover(as_owner, pkg, await _bath_visit(db))).status_code == 404


async def test_a_package_cannot_cover_a_billed_visit_or_one_with_a_paid_deposit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    pkg_id = (await _active_package(db)).id
    billed_id = (await _bath_visit(db)).id
    held_id = (await _bath_visit(db, starts_in=timedelta(days=-401))).id
    await db.execute(
        update(Booking).where(Booking.id == held_id).values(deposit_status="collected")
    )
    await db.flush()
    line = {"description": "Bath", "unit_amount_cents": 4500, "booking_id": billed_id}
    body = {"client_id": CARD_CLIENT, "lines": [line], "send": True}
    assert (await as_owner.post("/v1/invoices", json=body)).status_code == 201
    for booking_id in (billed_id, held_id):
        res = await as_owner.post(
            f"/v1/packages/{pkg_id}/cover", json={"booking_id": booking_id}, headers=retry_key()
        )
        assert res.status_code == 409, res.text
