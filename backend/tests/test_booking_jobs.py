from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Session
from clientbridge.tasks.booking_jobs import run_reap_unpaid_bookings

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
# far-future so the global scan can't collide with seeded data
NOW = datetime(2030, 1, 1, 0, 0, tzinfo=UTC)


async def _online_booking(
    db: AsyncSession,
    *,
    created_at: datetime,
    deposit_status: str = "pending",
    deposit_required: bool = True,
    status: str = "confirmed",
    source: str = "online",
) -> tuple[str, str]:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    starts = NOW + timedelta(days=2)
    session = Session(
        id=new_id("session"),
        business_id=BIZ,
        item_id=iid,
        staff_id=ST_OWNER,
        starts_at=starts,
        ends_at=starts + timedelta(hours=1),
        capacity=1,
        booked_count=1,
        status="scheduled",
    )
    db.add(session)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        session_id=session.id,
        staff_id=ST_OWNER,
        client_id=cid,
        status=status,
        source=source,
        price_cents=11000,
        deposit_required=deposit_required,
        deposit_amount_cents=2750,
        deposit_status=deposit_status,
        created_at=created_at,
    )
    db.add(booking)
    await db.flush()
    return booking.id, session.id


async def test_reaps_stale_unpaid_online_booking(db: AsyncSession) -> None:
    bid, sid = await _online_booking(db, created_at=NOW - timedelta(hours=1))
    assert await run_reap_unpaid_bookings(db, NOW) == 1
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "canceled" and booking.canceled_at == NOW
    session = (await db.execute(select(Session).where(Session.id == sid))).scalar_one()
    assert session.status == "canceled" and session.booked_count == 0  # slot freed


async def test_fresh_unpaid_booking_is_untouched(db: AsyncSession) -> None:
    bid, _ = await _online_booking(db, created_at=NOW - timedelta(minutes=5))  # inside the TTL
    assert await run_reap_unpaid_bookings(db, NOW) == 0
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "confirmed"


async def test_settled_deposit_is_untouched(db: AsyncSession) -> None:
    bid, _ = await _online_booking(db, created_at=NOW - timedelta(hours=1))
    db.add(
        Payment(
            id=new_id("payment"),
            business_id=BIZ,
            booking_id=bid,
            kind="deposit",
            amount_cents=2750,
            method="card",
            provider="stripe",
            status="succeeded",
        )
    )
    await db.flush()
    assert await run_reap_unpaid_bookings(db, NOW) == 0
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "confirmed"


async def test_manual_booking_is_untouched(db: AsyncSession) -> None:
    # only online bookings auto-cancel on non-payment; a staff-made booking is left to the provider.
    bid, _ = await _online_booking(db, created_at=NOW - timedelta(hours=1), source="manual")
    assert await run_reap_unpaid_bookings(db, NOW) == 0
    booking = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert booking.status == "confirmed"
