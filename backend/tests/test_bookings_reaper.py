import asyncio
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.db import SessionLocal
from clientbridge.core.ids import new_id
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.bookings import run_reap_unpaid_bookings
from clientbridge.services.notifications import Notifier
from clientbridge.services.payments import cancel_open_deposits
from tests.conftest import BIZ, FakeEmailSender, FakePaymentGateway, FakePushSender, FakeSmsSender
from tests.helpers import deposit_payment, enable_payments, payment, provider_ref

ST_OWNER = "st_owner"
# past every seeded visit, so a committed reaper run sees only this test's rows
FAR = datetime(2031, 1, 6, 17, tzinfo=UTC)


def _notifier() -> Notifier:
    return Notifier(FakeEmailSender(), FakeSmsSender(), FakePushSender())


async def _unpaid(api: httpx.AsyncClient, db: AsyncSession) -> tuple[str, str]:
    await enable_payments(db)
    res = await api.post(
        "/book/birchbark",
        json={
            "item_id": "it_groom_lg",
            "staff_id": ST_OWNER,
            "starts_at": "2027-03-02T16:00:00Z",
            "client": {"name": "Slow Payer", "phone": "+16045550278"},
        },
    )
    assert res.status_code == 200, res.text
    booking_id = str(res.json()["booking_id"])
    await db.execute(
        update(Booking)
        .where(Booking.id == booking_id)
        .values(created_at=clock.now() - timedelta(hours=1))
    )
    return booking_id, await provider_ref(db, await deposit_payment(db, booking_id))


async def test_the_reaper_leaves_a_visit_whose_booking_row_says_the_deposit_is_paid(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    booking_id, ref = await _unpaid(api, db)
    # a settled deposit the payment row doesn't show yet: only the booking row says it is paid
    await db.execute(
        update(Booking).where(Booking.id == booking_id).values(deposit_status="collected")
    )

    assert await run_reap_unpaid_bookings(db, gateway, _notifier(), clock.now()) == 0

    row = await db.get(Booking, booking_id, populate_existing=True)
    assert row is not None and row.status == "pending"
    assert ref not in gateway.canceled_intents


async def test_the_reaper_held_to_one_booking_releases_only_that_one(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    booking_id, ref = await _unpaid(api, db)

    other = await run_reap_unpaid_bookings(
        db, gateway, _notifier(), clock.now(), booking_id="booking_elsewhere"
    )
    assert other == 0 and ref not in gateway.canceled_intents
    own = await run_reap_unpaid_bookings(
        db, gateway, _notifier(), clock.now(), booking_id=booking_id
    )
    assert own == 1 and ref in gateway.canceled_intents


async def test_a_job_never_cancels_the_deposit_of_a_visit_that_has_paid(
    api: httpx.AsyncClient, db: AsyncSession, gateway: FakePaymentGateway
) -> None:
    booking_id, _ = await _unpaid(api, db)
    (await payment(db, await deposit_payment(db, booking_id))).status = "succeeded"
    await db.flush()
    booking = await db.get(Booking, booking_id)
    assert booking is not None

    assert await cancel_open_deposits(db, gateway, booking, skip_locked=True) is False
    assert gateway.canceled_intents == []


async def test_the_reaper_skips_a_deposit_a_webhook_is_settling_instead_of_waiting(
    db: AsyncSession,
) -> None:
    made: dict[str, str] = {}
    async with SessionLocal() as setup:
        slot = Slot(
            id=new_id("slot"),
            business_id=BIZ,
            item_id="it_groom_lg",
            staff_id=ST_OWNER,
            starts_at=FAR + timedelta(days=1),
            ends_at=FAR + timedelta(days=1, hours=2),
            capacity=1,
            status="scheduled",
        )
        setup.add(slot)
        await setup.flush()
        booking = Booking(
            id=new_id("booking"),
            business_id=BIZ,
            slot_id=slot.id,
            starts_at=slot.starts_at,
            staff_id=ST_OWNER,
            client_id="cl_amelie",
            status="pending",
            source="online",
            price_cents=11000,
            deposit_amount_cents=2750,
            deposit_status="pending",
            created_at=FAR - timedelta(hours=1),
        )
        setup.add(booking)
        await setup.flush()
        deposit = Payment(
            id=new_id("payment"),
            business_id=BIZ,
            booking_id=booking.id,
            kind="deposit",
            amount_cents=2750,
            method="card",
            provider="stripe",
            provider_ref="pi_settling",
            status="pending",
        )
        setup.add(deposit)
        await setup.commit()
        made = {"slot": slot.id, "booking": booking.id, "payment": deposit.id}

    try:
        async with SessionLocal() as webhook, SessionLocal() as job:
            # a webhook settling the deposit holds its payment row before it touches the visit
            await webhook.execute(
                select(Payment).where(Payment.id == made["payment"]).with_for_update()
            )
            gateway = FakePaymentGateway()
            reaped = await asyncio.wait_for(
                run_reap_unpaid_bookings(job, gateway, _notifier(), FAR), timeout=10
            )
            await job.commit()
            await webhook.rollback()
        assert reaped == 0
        assert gateway.canceled_intents == []
        async with SessionLocal() as check:
            status = await check.scalar(select(Booking.status).where(Booking.id == made["booking"]))
        assert status == "pending"
    finally:
        async with SessionLocal() as cleanup:
            await cleanup.execute(delete(Payment).where(Payment.id == made["payment"]))
            await cleanup.execute(delete(Booking).where(Booking.id == made["booking"]))
            await cleanup.execute(delete(Slot).where(Slot.id == made["slot"]))
            await cleanup.commit()
