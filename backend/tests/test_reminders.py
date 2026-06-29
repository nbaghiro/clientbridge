from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.ids import new_id
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.scheduling import Booking, Session
from clientbridge.services.notification_service import Notifier
from clientbridge.tasks.reminders import run_reminders
from tests.conftest import FakeEmailSender, FakePushSender, FakeSmsSender

BIZ = "bz_birchbark"
ST_OWNER = "st_owner"
# far-future so the global scan can't see any seeded booking
NOW = datetime(2030, 1, 1, 0, 0, tzinfo=UTC)


async def _booking_at(db: AsyncSession, starts_at: datetime, *, status: str = "confirmed") -> str:
    cid = (
        (await db.execute(select(Client.id).where(Client.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert cid
    await db.execute(update(Client).where(Client.id == cid).values(email="rem@example.ca"))
    iid = (
        (await db.execute(select(Item.id).where(Item.business_id == BIZ).limit(1)))
        .scalars()
        .first()
    )
    assert iid
    sess = Session(
        id=new_id("session"),
        business_id=BIZ,
        item_id=iid,
        staff_id=ST_OWNER,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=1),
        capacity=1,
        booked_count=1,
        status="scheduled",
    )
    db.add(sess)
    await db.flush()
    booking = Booking(
        id=new_id("booking"),
        business_id=BIZ,
        session_id=sess.id,
        staff_id=ST_OWNER,
        client_id=cid,
        status=status,
        source="manual",
        price_cents=5000,
    )
    db.add(booking)
    await db.flush()
    return booking.id


def _notifier(email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender) -> Notifier:
    return Notifier(email, sms, push)


async def test_reminds_upcoming_booking(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    bid = await _booking_at(db, NOW + timedelta(hours=12))
    sent = await run_reminders(db, _notifier(email, sms, push), NOW)
    assert sent == 1
    assert len(email.sent) == 1 and email.sent[0].to == "rem@example.ca"
    bk = (await db.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert bk.reminded_at is not None


async def test_skips_booking_outside_window(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    await _booking_at(db, NOW + timedelta(hours=48))  # beyond 24h
    assert await run_reminders(db, _notifier(email, sms, push), NOW) == 0
    assert email.sent == []


async def test_reminder_is_deduped(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    await _booking_at(db, NOW + timedelta(hours=12))
    notifier = _notifier(email, sms, push)
    assert await run_reminders(db, notifier, NOW) == 1
    assert await run_reminders(db, notifier, NOW) == 0  # reminded_at dedups


async def test_skips_canceled_booking(
    db: AsyncSession, email: FakeEmailSender, sms: FakeSmsSender, push: FakePushSender
) -> None:
    await _booking_at(db, NOW + timedelta(hours=12), status="canceled")
    assert await run_reminders(db, _notifier(email, sms, push), NOW) == 0
