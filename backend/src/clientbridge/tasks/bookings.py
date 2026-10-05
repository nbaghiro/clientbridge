from datetime import UTC, datetime, timedelta

from sqlalchemy import Exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.integrations.notifications import (
    get_email_sender,
    get_push_sender,
    get_sms_sender,
)
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.services.bookings import release_slot
from clientbridge.services.notifications import Notifier

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


_TERMINAL = ("completed", "canceled", "no_show")
_WINDOW = timedelta(hours=24)


async def run_reminders(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Remind each active booking starting within the next 24h that hasn't been reminded yet, and
    return how many were sent. Idempotent across runs — `reminded_at` dedups."""
    bookings = (
        (
            await db.execute(
                select(Booking)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Booking.deleted_at.is_(None),
                    Booking.reminded_at.is_(None),
                    Booking.status.not_in(_TERMINAL),
                    Slot.starts_at > now,
                    Slot.starts_at <= now + _WINDOW,
                )
            )
        )
        .scalars()
        .all()
    )
    for booking in bookings:
        await notifier.on_booking_reminder(db, booking.id)
        booking.reminded_at = now
    await db.commit()
    return len(bookings)


async def send_booking_reminders(ctx: dict[str, object]) -> int:
    """arq cron entry — a global scan (jobs aren't request/tenant-scoped); each reminder resolves
    its own business + locale."""
    async with SessionLocal() as db:
        notifier = Notifier(get_email_sender(), get_sms_sender(), get_push_sender())
        return await run_reminders(db, notifier, datetime.now(UTC))
