import asyncio
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.scheduling import Booking, Hours, Slot
from clientbridge.schemas.public import PublicBookingClient, PublicBookingCreate
from clientbridge.services.bookings import (
    load_availability,
    open_slots,
    slot_problem,
    windows_on,
)
from clientbridge.services.public import PublicBookingService
from tests.conftest import BIZ, FakePaymentGateway

SLUG = "birchbark"
ST_OWNER = "st_owner"
NAILS = "it_nails"


def _nth_sunday(year: int, month: int, nth: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (nth - 1))


def _upcoming(month: int, nth: int) -> date:
    soon = datetime.now(UTC).date() + timedelta(days=2)
    this_year = _nth_sunday(soon.year, month, nth)
    return this_year if this_year >= soon else _nth_sunday(soon.year + 1, month, nth)


# the next fall-back and spring-forward Sundays in Toronto and Halifax, still bookable from now
TRANSITIONS = (_upcoming(11, 1), _upcoming(3, 2))
WINDOWS = ((time(0, 0), time(5, 0)), (time(21, 0), time(23, 59)))


async def _open_week(db: AsyncSession, zone: ZoneInfo, sunday: date) -> list[date]:
    await db.execute(update(Business).where(Business.id == BIZ).values(timezone=zone.key))
    days = [sunday + timedelta(days=offset) for offset in range(-1, 2)]
    await db.execute(delete(Hours).where(Hours.staff_id == ST_OWNER, Hours.date.in_(days)))
    for day in days:
        for opens, closes in WINDOWS:
            db.add(
                Hours(
                    id=new_id("hours"),
                    business_id=BIZ,
                    staff_id=ST_OWNER,
                    basis="date",
                    date=day,
                    start_time=opens,
                    end_time=closes,
                    available=True,
                )
            )
    busy = datetime.combine(sunday, time(1, 20), tzinfo=zone).astimezone(UTC)
    db.add(
        Slot(
            id=new_id("slot"),
            business_id=BIZ,
            item_id=NAILS,
            staff_id=ST_OWNER,
            starts_at=busy,
            ends_at=busy + timedelta(minutes=15),
            capacity=1,
            status="scheduled",
        )
    )
    late = datetime.combine(sunday, time(23, 0), tzinfo=zone)
    db.add(
        Hours(
            id=new_id("hours"),
            business_id=BIZ,
            staff_id=ST_OWNER,
            basis="exception",
            starts_at=late,
            ends_at=late + timedelta(hours=1),
            reason="Errand",
            available=False,
        )
    )
    await db.flush()
    return days


@pytest.mark.parametrize("zone", ["America/Toronto", "America/Vancouver", "America/Halifax"])
@pytest.mark.parametrize("sunday", TRANSITIONS)
async def test_open_times_and_accepted_starts_agree_across_daylight_saving(
    api: httpx.AsyncClient, db: AsyncSession, zone: str, sunday: date
) -> None:
    tz = ZoneInfo(zone)
    item = await db.get(Item, NAILS)
    assert item is not None
    days = await _open_week(db, tz, sunday)
    found = await load_availability(db, BIZ, [ST_OWNER], days[0], days[-1], tz, [item])
    hours = list(await db.scalars(select(Hours).where(Hours.staff_id == ST_OWNER)))
    length = timedelta(minutes=item.duration_min or 0)
    step = length + timedelta(minutes=item.buffer_before_min + item.buffer_after_min)
    offered: set[datetime] = set()
    for day in days:
        starts = found.open_starts(item, ST_OWNER, day)
        assert starts, day
        assert starts == await open_slots(db, BIZ, item, ST_OWNER, day)
        for opens, closes in windows_on(hours, day) or []:
            start = datetime.combine(day, opens, tzinfo=tz).astimezone(UTC)
            limit = datetime.combine(day, closes, tzinfo=tz).astimezone(UTC)
            while start + length <= limit:
                problem = await slot_problem(db, BIZ, item, ST_OWNER, start, start + length)
                assert (start in starts) == (problem is None), (day, start, problem)
                start += step
        offered.update(starts)
    first = datetime.combine(sunday, time(0), tzinfo=tz).astimezone(UTC)
    late = datetime.combine(sunday, time(22, 50), tzinfo=tz).astimezone(UTC)
    candidates = [first + timedelta(minutes=30 * n) for n in range(10)]
    candidates += [late + timedelta(minutes=10 * n) for n in range(4)]
    accepted = 0
    for n, start in enumerate(candidates):
        res = await api.post(
            f"/book/{SLUG}",
            json={
                "item_id": NAILS,
                "staff_id": ST_OWNER,
                "starts_at": start.isoformat(),
                "client": {"name": "Property", "email": f"property{n}@example.com"},
            },
        )
        assert res.status_code in (200, 409), res.text
        if res.status_code == 200:
            accepted += 1
            assert start in offered, start
    assert accepted > 0


async def test_two_connections_racing_for_one_public_slot_book_it_once(db: AsyncSession) -> None:
    starts_at = datetime(2027, 5, 4, 16, tzinfo=UTC)
    emails = ["race-a@example.com", "race-b@example.com"]
    ready = asyncio.Barrier(2)

    async def book(email: str) -> str | Conflict:
        async with SessionLocal() as session:
            service = PublicBookingService(session, FakePaymentGateway())
            await ready.wait()
            try:
                result = await service.book(
                    SLUG,
                    PublicBookingCreate(
                        item_id="it_groom_sm",
                        staff_id=ST_OWNER,
                        starts_at=starts_at,
                        client=PublicBookingClient(name="Racer", email=email),
                    ),
                )
            except Conflict as exc:
                return exc
            return result.booking_id

    try:
        results = await asyncio.gather(*(book(email) for email in emails))
        assert sum(isinstance(r, str) for r in results) == 1
        assert sum(isinstance(r, Conflict) for r in results) == 1
        async with SessionLocal() as check:
            held = await check.scalars(
                select(Slot.id).where(
                    Slot.staff_id == ST_OWNER,
                    Slot.starts_at == starts_at,
                    Slot.status != "canceled",
                )
            )
            assert len(list(held)) == 1
    finally:
        async with SessionLocal() as cleanup:
            clients = list(await cleanup.scalars(select(Client.id).where(Client.email.in_(emails))))
            slots = list(
                await cleanup.scalars(select(Booking.slot_id).where(Booking.client_id.in_(clients)))
            )
            await cleanup.execute(delete(Booking).where(Booking.client_id.in_(clients)))
            await cleanup.execute(delete(Slot).where(Slot.id.in_(slots)))
            await cleanup.execute(delete(Client).where(Client.id.in_(clients)))
            await cleanup.commit()
