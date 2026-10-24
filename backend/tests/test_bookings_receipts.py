import secrets
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory
from tests.helpers import key, ok

TITLE = "RMT · Reg. 12345"


async def _visit(db: AsyncSession) -> Booking:
    """A booked visit with no invoice or sale yet, its member titled and the business addressed."""
    booking = (
        await db.execute(
            select(Booking)
            .where(
                Booking.business_id == BIZ,
                Booking.invoice_id.is_(None),
                Booking.order_id.is_(None),
                Booking.package_id.is_(None),
                Booking.charged_at.is_(None),
                Booking.deleted_at.is_(None),
                Booking.staff_id.is_not(None),
                Booking.status.in_(("confirmed", "completed")),
                Booking.deposit_status == "none",
            )
            .order_by(Booking.id)
            .limit(1)
        )
    ).scalar_one()
    await db.execute(update(Staff).where(Staff.id == booking.staff_id).values(title=TITLE))
    await db.execute(
        update(Business)
        .where(Business.id == BIZ)
        .values(
            unit="4",
            street_number="1250",
            street_name="Main St",
            city="Victoria",
            province="BC",
            postal_code="V8W 1A1",
            legal_phone="+12505550142",
        )
    )
    booking.manage_token = secrets.token_urlsafe(18)
    await db.flush()
    return booking


async def _invoiced(api: httpx.AsyncClient, booking: Booking) -> dict[str, object]:
    created = ok(
        await api.post(f"/v1/invoices/from-booking/{booking.id}", headers=key()), 201
    ).json()
    return ok(await api.post(f"/v1/invoices/{created['id']}/send")).json()


async def test_an_invoice_paid_visit_prints_the_invoice_with_its_practitioner(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _visit(db)
    invoice = await _invoiced(as_owner, booking)
    early = await as_owner.get(f"/v1/bookings/{booking.id}/receipt")
    assert (early.status_code, early.json()["error"]) == (409, "visit_unpaid")
    ok(
        await as_owner.post(
            f"/v1/invoices/{invoice['id']}/payments",
            json={"method": "cash", "amount_cents": invoice["total_cents"]},
            headers=key(),
        ),
        201,
    )
    receipt = ok(await as_owner.get(f"/v1/bookings/{booking.id}/receipt")).json()
    assert (receipt["source"], receipt["number"]) == ("invoice", invoice["number"])
    assert receipt["practitioner_title"] == TITLE and receipt["practitioner"]
    assert receipt["status"] == "paid" and receipt["total_cents"] == invoice["total_cents"]
    assert receipt["address"]["street_name"] == "Main St"
    assert receipt["phone"] == "+12505550142"
    assert [p["method"] for p in receipt["payments"]] == ["cash"]
    slot = await db.get(Slot, booking.slot_id)
    assert slot is not None and receipt["visit_at"].startswith(slot.starts_at.date().isoformat())
    token = booking.manage_token
    assert ok(await as_owner.get(f"/manage/{token}")).json()["has_receipt"] is True
    public = ok(await as_owner.get(f"/manage/{token}/receipt")).json()
    assert public == receipt
    pay = ok(await as_owner.get(f"/pay/{invoice['pay_token']}")).json()
    assert pay["address"]["city"] == "Victoria" and pay["phone"] == "+12505550142"


async def test_a_visit_paid_at_the_desk_prints_the_sale(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _visit(db)
    line = {"description": "Visit", "unit_amount_cents": 8000, "booking_id": booking.id}
    sale = ok(
        await as_owner.post("/v1/orders", json={"client_id": booking.client_id, "lines": [line]}),
        201,
    ).json()
    ok(
        await as_owner.post(
            f"/v1/orders/{sale['id']}/cash",
            json={"tendered_cents": sale["due_cents"]},
            headers=key(),
        )
    )
    receipt = ok(await as_owner.get(f"/v1/bookings/{booking.id}/receipt")).json()
    assert (receipt["source"], receipt["number"]) == ("sale", sale["number"])
    assert receipt["practitioner_title"] == TITLE
    assert receipt["address"]["postal_code"] == "V8W 1A1"
    assert ok(await as_owner.get(f"/manage/{booking.manage_token}/receipt")).json() == receipt


async def test_a_visit_without_an_invoice_or_sale_has_no_receipt(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _visit(db)
    res = await as_owner.get(f"/v1/bookings/{booking.id}/receipt")
    assert (res.status_code, res.json()["error"]) == (409, "visit_not_billed")
    public = await as_owner.get(f"/manage/{booking.manage_token}/receipt")
    assert (public.status_code, public.json()["error"]) == (409, "visit_not_billed")
    assert ok(await as_owner.get(f"/manage/{booking.manage_token}")).json()["has_receipt"] is False
    invoice = await _invoiced(as_owner, booking)
    ok(await as_owner.post(f"/v1/invoices/{invoice['id']}/void"))
    voided = await as_owner.get(f"/v1/bookings/{booking.id}/receipt")
    assert voided.json()["error"] == "visit_not_billed"


async def test_a_wrong_manage_token_finds_no_receipt(unauth: httpx.AsyncClient) -> None:
    res = await unauth.get("/manage/not-a-real-token/receipt")
    assert res.status_code == 404


async def test_staff_cannot_print_a_visit_receipt(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    booking = await _visit(db)
    res = await as_staff.get(f"/v1/bookings/{booking.id}/receipt")
    assert res.status_code == 403


async def test_another_business_booking_is_not_found(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business()
    client = await factory.client(business=other)
    staff = await factory.staff(business=other)
    item = Item(id=new_id("item"), business_id=other.id, kind="service", name="Massage")
    db.add(item)
    await db.flush()
    start = datetime(2027, 3, 2, 18, tzinfo=UTC)
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=staff.id,
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=1,
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        starts_at=start,
        staff_id=staff.id,
        client_id=client.id,
        status="confirmed",
    )
    db.add(booking)
    await db.flush()
    res = await as_owner.get(f"/v1/bookings/{booking.id}/receipt")
    assert res.status_code == 404
