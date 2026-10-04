from datetime import UTC, datetime, timedelta

from sqlalchemy import Exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.booking_service import release_slot

_UNPAID_TTL = timedelta(minutes=30)


async def run_reap_unpaid_bookings(db: AsyncSession, now: datetime) -> int:
    """Cancel public online bookings that have held a slot past the deposit window without paying,
    freeing the slot so it's bookable again. A confirmed online booking commits before its
    deposit is paid (an open deposit charge, none settled → the hold was never earned). Idempotent
    — a canceled booking no longer matches; a row with a settled deposit is left alone."""

    def deposits(status: str) -> Exists:
        return (
            select(Payment.id)
            .where(
                Payment.booking_id == Booking.id,
                Payment.kind == "deposit",
                Payment.status == status,
            )
            .exists()
        )

    bookings = (
        await db.execute(
            select(Booking, Slot)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(
                Booking.deleted_at.is_(None),
                Booking.source == "online",
                Booking.deposit_amount_cents > 0,
                Booking.status.not_in(("completed", "canceled", "no_show")),
                Booking.created_at < now - _UNPAID_TTL,
                deposits("pending"),
                ~deposits("succeeded"),
            )
        )
    ).all()
    for booking, slot in bookings:
        booking.status = "canceled"
        booking.canceled_at = now
        await release_slot(db, slot)
    await db.commit()
    return len(bookings)


async def reap_unpaid_bookings(ctx: dict[str, object]) -> int:
    """arq cron entry — a global scan freeing slots held by unpaid online bookings."""
    async with SessionLocal() as db:
        return await run_reap_unpaid_bookings(db, datetime.now(UTC))
