from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking, Slot
from tests.conftest import BIZ, Factory


async def _booking(db: AsyncSession, staff_id: str, status: str = "confirmed", day: int = 3) -> str:
    client_id = (await db.execute(select(Client.id).where(Client.business_id == BIZ))).scalars()
    item_id = (
        await db.execute(
            select(Item.id).where(Item.business_id == BIZ, Item.kind == "service").limit(1)
        )
    ).scalar_one()
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item_id,
        staff_id=staff_id,
        starts_at=datetime(2027, 8, day, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, day, 18, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        slot_id=slot.id,
        staff_id=staff_id,
        client_id=client_id.first(),
        status=status,
        source="manual",
        price_cents=7500,
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def _checked_in_at(db: AsyncSession, booking_id: str) -> datetime | None:
    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None
    return row.checked_in_at


async def test_owner_checks_a_client_in(as_owner: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_diego")
    res = await as_owner.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 200, res.text
    assert res.json()["checked_in_at"] is not None
    assert res.json()["status"] == "confirmed"
    assert await _checked_in_at(db, bid) is not None
    audit = await db.execute(
        select(Audit.action).where(Audit.entity_id == bid, Audit.action == "booking.check_in")
    )
    assert audit.scalar_one_or_none() == "booking.check_in"


async def test_staff_checks_in_their_own_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    res = await as_staff.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 200, res.text
    assert await _checked_in_at(db, bid) is not None


async def test_staff_cannot_check_in_another_members_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    res = await as_staff.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 403
    assert await _checked_in_at(db, bid) is None


async def test_unauth_cannot_check_in(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_owner")
    res = await unauth.post(f"/v1/bookings/{bid}/check-in")
    assert res.status_code == 401
    assert await _checked_in_at(db, bid) is None


async def test_unknown_booking_404(as_owner: httpx.AsyncClient) -> None:
    res = await as_owner.post("/v1/bookings/bk_missing/check-in")
    assert res.status_code == 404


async def test_another_business_booking_404(
    as_owner: httpx.AsyncClient, db: AsyncSession, factory: Factory
) -> None:
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    client = await factory.client(business=other)
    item = Item(
        id=new_id("item"),
        business_id=other.id,
        kind="service",
        name="Rival Groom",
        price_cents=5000,
        currency="CAD",
        duration_min=60,
    )
    db.add(item)
    await db.flush()
    slot = Slot(
        id=new_id("slot"),
        business_id=other.id,
        item_id=item.id,
        staff_id=owner.id,
        starts_at=datetime(2027, 8, 4, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, 4, 18, tzinfo=UTC),
        capacity=1,
        status="scheduled",
    )
    db.add(slot)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=other.id,
        slot_id=slot.id,
        staff_id=owner.id,
        client_id=client.id,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    res = await as_owner.post(f"/v1/bookings/{booking.id}/check-in")
    assert res.status_code == 404
    assert await _checked_in_at(db, booking.id) is None


async def test_closed_booking_cannot_be_checked_in(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    for day, status in enumerate(("completed", "canceled", "no_show"), start=10):
        bid = await _booking(db, "st_owner", status=status, day=day)
        res = await as_owner.post(f"/v1/bookings/{bid}/check-in")
        assert res.status_code == 409, status
        assert await _checked_in_at(db, bid) is None


async def test_checking_in_twice_keeps_the_first_arrival(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    first = (await as_owner.post(f"/v1/bookings/{bid}/check-in")).json()["checked_in_at"]
    again = await as_owner.post(f"/v1/bookings/{bid}/check-in")
    assert again.status_code == 200
    assert again.json()["checked_in_at"] == first
    audits = await db.execute(
        select(Audit.id).where(Audit.entity_id == bid, Audit.action == "booking.check_in")
    )
    assert len(audits.scalars().all()) == 1
