import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.integrations.twilio import Sms
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.bookings import run_reminders
from clientbridge.services.notifications import Notifier
from tests.conftest import (
    BIZ,
    DownEmailSender,
    DownSmsSender,
    Factory,
    FakeEmailSender,
    FakePushSender,
    FakeSmsSender,
)


async def _booking(
    db: AsyncSession, staff_id: str, *, business_id: str = BIZ, client_id: str = "cl_amelie"
) -> str:
    item_id = "it_groom_sm"
    if business_id != BIZ:
        item = Item(
            id=new_id("item"),
            business_id=business_id,
            kind="service",
            name="Rival Groom",
            price_cents=5000,
            currency="CAD",
            duration_min=60,
        )
        db.add(item)
        await db.flush()
        item_id = item.id
    slot = Slot(
        id=new_id("slot"),
        business_id=business_id,
        item_id=item_id,
        staff_id=staff_id,
        starts_at=datetime(2027, 8, 3, 17, tzinfo=UTC),
        ends_at=datetime(2027, 8, 3, 18, tzinfo=UTC),
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
        client_id=client_id,
        status="confirmed",
        source="manual",
    )
    db.add(booking)
    await db.flush()
    return booking.id


async def test_reminder_preview_matches_what_is_sent(as_owner: httpx.AsyncClient) -> None:
    created = await as_owner.post(
        "/v1/bookings",
        json={
            "client_id": "cl_amelie",
            "item_id": "it_groom_sm",
            "staff_id": "st_priya",
            "starts_at": "2027-03-01T18:00:00Z",
        },
    )
    bid = created.json()["id"]
    res = await as_owner.get(f"/v1/bookings/{bid}/reminder")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["body"].startswith("Reminder: you have an appointment")
    assert "Change or cancel:" in body["body"]
    assert body["sends_at"].startswith("2027-02-28T18:00")
    assert body["sent_at"] is None
    assert (await as_owner.get("/v1/bookings/bk_missing/reminder")).status_code == 404


async def test_staff_previews_their_own_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_diego")
    assert (await as_staff.get(f"/v1/bookings/{bid}/reminder")).status_code == 200


async def test_staff_cannot_preview_another_members_booking(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    bid = await _booking(db, "st_owner")
    assert (await as_staff.get(f"/v1/bookings/{bid}/reminder")).status_code == 403


async def test_another_business_booking_404(
    as_owner: httpx.AsyncClient, factory: Factory, db: AsyncSession
) -> None:
    other = await factory.business(name="Rival Co")
    owner = await factory.staff(business=other, user=await factory.user(), role="owner")
    client = await factory.client(business=other)
    bid = await _booking(db, owner.id, business_id=other.id, client_id=client.id)
    assert (await as_owner.get(f"/v1/bookings/{bid}/reminder")).status_code == 404


async def test_unauth_cannot_preview(unauth: httpx.AsyncClient, db: AsyncSession) -> None:
    bid = await _booking(db, "st_owner")
    assert (await unauth.get(f"/v1/bookings/{bid}/reminder")).status_code == 401


async def test_a_moved_visit_is_reminded_again_before_its_new_time(
    as_owner: httpx.AsyncClient, db: AsyncSession, sms: FakeSmsSender
) -> None:
    bid = await _booking(db, "st_owner")
    notifier = Notifier(FakeEmailSender(), sms, FakePushSender())
    first = datetime(2027, 8, 3, 17, tzinfo=UTC)
    assert await run_reminders(db, notifier, first - timedelta(hours=20)) >= 1
    moved = await as_owner.patch(f"/v1/bookings/{bid}", json={"starts_at": "2027-08-10T17:00:00Z"})
    assert moved.status_code == 200, moved.text
    booking = await db.get(Booking, bid, populate_existing=True)
    assert booking is not None and booking.reminded_at is None
    sent = len(sms.sent)
    await run_reminders(db, notifier, first + timedelta(days=7) - timedelta(hours=20))
    assert len(sms.sent) > sent


async def test_a_failed_reminder_stays_due_and_goes_on_the_next_run(
    db: AsyncSession, sms: FakeSmsSender
) -> None:
    bid = await _booking(db, "st_owner")
    at = datetime(2027, 8, 3, 17, tzinfo=UTC) - timedelta(hours=20)
    down = Notifier(DownEmailSender(), DownSmsSender(), FakePushSender())
    await run_reminders(db, down, at)
    booking = await db.get(Booking, bid, populate_existing=True)
    assert booking is not None and booking.reminded_at is None

    await run_reminders(db, Notifier(FakeEmailSender(), sms, FakePushSender()), at)
    booking = await db.get(Booking, bid, populate_existing=True)
    assert booking is not None and booking.reminded_at == at
    assert len(sms.sent) >= 1


class _StopsAfterOne(FakeSmsSender):
    """Sends one text, then the worker dies mid-run."""

    async def send(self, sms: Sms) -> str | None:
        if self.sent:
            raise asyncio.CancelledError
        return await super().send(sms)


async def test_an_interrupted_run_keeps_what_it_sent_and_never_repeats_it(
    db: AsyncSession, sms: FakeSmsSender
) -> None:
    first = await _booking(db, "st_owner")
    second = await _booking(db, "st_diego")
    at = datetime(2027, 8, 3, 17, tzinfo=UTC) - timedelta(hours=20)
    dying = _StopsAfterOne()
    with pytest.raises(asyncio.CancelledError):
        await run_reminders(db, Notifier(FakeEmailSender(), dying, FakePushSender()), at)
    marked = [
        b.id
        for b in [await db.get(Booking, bid, populate_existing=True) for bid in (first, second)]
        if b is not None and b.reminded_at is not None
    ]
    assert len(marked) == 1

    await run_reminders(db, Notifier(FakeEmailSender(), sms, FakePushSender()), at)
    assert len(sms.sent) == 1  # only the visit the interrupted run never reached
    for bid in (first, second):
        booking = await db.get(Booking, bid, populate_existing=True)
        assert booking is not None and booking.reminded_at is not None
