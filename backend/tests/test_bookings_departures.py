from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.messaging import Delivery
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.deliveries import DELIVERY_PAYLOAD, SmsDelivery
from tests.conftest import BIZ, Factory
from tests.helpers import replied_stop


async def _client(db: AsyncSession, business_id: str = BIZ, phone: str | None = None) -> Client:
    client = Client(
        id=new_id("client"),
        business_id=business_id,
        name="Maya Chen",
        phone=phone,
        tags=[],
        custom_fields={},
    )
    db.add(client)
    await db.flush()
    return client


async def _booking(
    db: AsyncSession,
    staff_id: str,
    *,
    status: str = "confirmed",
    starts_at: datetime = datetime(2027, 8, 3, 17, tzinfo=UTC),
    business_id: str = BIZ,
    phone: str | None = "+12505550142",
) -> str:
    client = await _client(db, business_id, phone)
    item_id = await db.scalar(
        select(Item.id).where(Item.business_id == business_id, Item.kind == "service").limit(1)
    )
    assert item_id is not None
    slot = Slot(
        id=new_id("slot"),
        business_id=business_id,
        item_id=item_id,
        staff_id=staff_id,
        starts_at=starts_at,
        ends_at=starts_at.replace(hour=starts_at.hour + 1),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=business_id,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=staff_id,
        client_id=client.id,
        status=status,
        source="manual",
        price_cents=7500,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def _texts(db: AsyncSession, booking_id: str) -> list[str]:
    rows = await db.scalars(
        select(Delivery).where(Delivery.key.startswith(f"booking:{booking_id}:depart"))
    )
    payloads = [DELIVERY_PAYLOAD.validate_python(d.payload) for d in rows.all()]
    return [p.message.body for p in payloads if isinstance(p, SmsDelivery)]


async def _departed_at(db: AsyncSession, booking_id: str) -> datetime | None:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    return row.departed_at


async def test_staff_on_the_booking_sets_off_and_the_client_gets_a_text(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    res = await as_staff.post(f"/v1/bookings/{bid}/depart")
    assert res.status_code == 200, res.text
    assert res.json()["departed_at"] is not None and res.json()["checked_in_at"] is None
    assert await _departed_at(db, bid) is not None
    business = await db.get(Business, BIZ)
    assert business is not None
    texts = await _texts(db, bid)
    assert texts == [
        f"Diego from {business.name} expects to arrive around 10:00 a.m. and is on the way now."
    ]
    audit = await db.scalar(
        select(Audit.action).where(Audit.entity_id == bid, Audit.action == "booking.depart")
    )
    assert audit == "booking.depart"


async def test_a_manager_sets_off_for_another_members_booking(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    assert (await as_owner.post(f"/v1/bookings/{bid}/depart")).status_code == 200


async def test_setting_off_after_the_start_leaves_out_the_arrival_time(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego", starts_at=datetime(2026, 10, 13, 16, tzinfo=UTC))
    assert (await as_owner.post(f"/v1/bookings/{bid}/depart")).status_code == 200
    texts = await _texts(db, bid)
    assert len(texts) == 1 and texts[0].endswith("is on the way to you now.")


async def test_setting_off_twice_keeps_the_first_time_and_texts_once(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    first = (await as_staff.post(f"/v1/bookings/{bid}/depart")).json()["departed_at"]
    again = await as_staff.post(f"/v1/bookings/{bid}/depart")
    assert again.status_code == 200 and again.json()["departed_at"] == first
    assert len(await _texts(db, bid)) == 1
    audits = await db.scalars(
        select(Audit.id).where(Audit.entity_id == bid, Audit.action == "booking.depart")
    )
    assert len(audits.all()) == 1


async def test_a_client_who_replied_stop_or_has_no_phone_gets_no_text(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    stopped = await _booking(db, "st_owner")
    booking = await db.get(Booking, stopped)
    assert booking is not None
    client = await db.get(Client, booking.client_id)
    assert client is not None
    await replied_stop(db, client.id)
    silent = await _booking(
        db, "st_owner", phone=None, starts_at=datetime(2027, 8, 4, 17, tzinfo=UTC)
    )
    for bid in (stopped, silent):
        assert (await as_owner.post(f"/v1/bookings/{bid}/depart")).status_code == 200
        assert await _departed_at(db, bid) is not None
        assert await _texts(db, bid) == []
    notices = await db.scalars(
        select(Delivery).where(Delivery.key.startswith(f"booking:{silent}:depart"))
    )
    assert notices.all() == []


async def test_staff_cannot_set_off_for_another_members_booking_403(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    assert (await as_staff.post(f"/v1/bookings/{bid}/depart")).status_code == 403
    assert await _departed_at(db, bid) is None and await _texts(db, bid) == []


async def test_unauth_401(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_owner")
    assert (await unauth.post(f"/v1/bookings/{bid}/depart")).status_code == 401


async def test_unknown_or_foreign_booking_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    assert (await as_owner.post("/v1/bookings/bk_missing/depart")).status_code == 404
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    db.add(
        Item(
            id=new_id("item"),
            business_id=other.id,
            kind="service",
            name="Rival visit",
            price_cents=5000,
            currency="CAD",
            duration_min=60,
        )
    )
    await db.flush()
    foreign = await _booking(db, owner.id, business_id=other.id)
    assert (await as_owner.post(f"/v1/bookings/{foreign}/depart")).status_code == 404
    assert await _departed_at(db, foreign) is None


@pytest.mark.parametrize("status", ["completed", "canceled", "no_show"])
async def test_a_closed_booking_cannot_be_started_409(
    as_owner: httpx.AsyncClient, db: AsyncSession, status: str
) -> None:
    bid = await _booking(db, "st_owner", status=status)
    assert (await as_owner.post(f"/v1/bookings/{bid}/depart")).status_code == 409
    assert await _departed_at(db, bid) is None and await _texts(db, bid) == []
