"""A membership's included visits cover started visits, up to its count each billing period."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item, Subscription
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.entitlements import period_start
from tests.helpers import client_id, enable_payments, key

BIZ = "bz_birchbark"


async def _membership(
    db: AsyncSession, *, visits: int = 2, covers: str | None = None, status: str = "active"
) -> Subscription:
    item = Item(
        id=new_id("item"),
        business_id=BIZ,
        kind="subscription",
        name="Bath club",
        price_cents=6000,
        currency="CAD",
        interval=1,
        frequency="month",
        visits_per_period=visits,
        covers_item_id=covers,
    )
    db.add(item)
    await db.flush()
    sub = Subscription(
        id=new_id("subscription"),
        business_id=BIZ,
        client_id=await client_id(db),
        item_id=item.id,
        status=status,
        provider_ref=f"sub_{new_id('subscription')}",
        current_period_end=clock.now() + timedelta(days=20),
    )
    db.add(sub)
    await db.flush()
    return sub


async def _started_visit(
    db: AsyncSession, client: str, *, item: str = "it_bath", hours_ago: int = 1
) -> Booking:
    start = clock.now() - timedelta(hours=hours_ago)
    slot = Slot(
        id=new_id("slot"),
        business_id=BIZ,
        item_id=item,
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
        client_id=client,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    return booking


async def _cover(api: httpx.AsyncClient, sub: str, booking: str) -> httpx.Response:
    return await api.post(
        f"/v1/subscriptions/{sub}/cover", json={"booking_id": booking}, headers=key()
    )


async def test_an_included_visit_settles_a_started_visit(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sub = await _membership(db)
    visit = await _started_visit(db, sub.client_id)
    res = await _cover(as_owner, sub.id, visit.id)
    assert res.status_code == 200, res.text
    covered = await db.scalar(
        select(Booking).where(Booking.id == visit.id).execution_options(populate_existing=True)
    )
    assert covered is not None
    assert (covered.status, covered.subscription_id) == ("completed", sub.id)


async def test_the_included_visits_run_out_for_the_period(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sub = await _membership(db, visits=1)
    first = await _started_visit(db, sub.client_id, hours_ago=3)
    second = await _started_visit(db, sub.client_id)
    assert (await _cover(as_owner, sub.id, first.id)).status_code == 200
    refused = await _cover(as_owner, sub.id, second.id)
    assert (refused.status_code, refused.json()["error"]) == (409, "membership_visits_used")


async def test_a_visit_covered_last_period_leaves_this_periods_visits(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sub = await _membership(db, visits=1)
    earlier = await _started_visit(db, sub.client_id, hours_ago=3)
    earlier.subscription_id = sub.id
    earlier.status = "completed"
    earlier.completed_at = clock.now() - timedelta(days=40)
    visit = await _started_visit(db, sub.client_id)
    await db.flush()
    assert (await _cover(as_owner, sub.id, visit.id)).status_code == 200


async def test_a_membership_for_one_service_covers_only_that_service(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sub = await _membership(db, covers="it_groom_sm")
    visit = await _started_visit(db, sub.client_id)
    assert (await _cover(as_owner, sub.id, visit.id)).status_code == 409


async def test_a_membership_that_isnt_active_covers_nothing(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sub = await _membership(db, status="past_due")
    visit = await _started_visit(db, sub.client_id)
    assert (await _cover(as_owner, sub.id, visit.id)).status_code == 409


async def test_covering_needs_an_idempotency_key(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    await enable_payments(db)
    sub = await _membership(db)
    visit = await _started_visit(db, sub.client_id)
    res = await as_owner.post(f"/v1/subscriptions/{sub.id}/cover", json={"booking_id": visit.id})
    assert res.status_code == 422


def test_a_period_starts_one_interval_before_it_ends() -> None:
    end = datetime(2026, 3, 31, 12, tzinfo=UTC)
    assert period_start(end, 1, "month") == datetime(2026, 2, 28, 12, tzinfo=UTC)
    assert period_start(end, 1, "year") == datetime(2025, 3, 31, 12, tzinfo=UTC)
    assert period_start(end, 2, "week") == end - timedelta(weeks=2)
    assert period_start(end, 3, "day") == end - timedelta(days=3)
