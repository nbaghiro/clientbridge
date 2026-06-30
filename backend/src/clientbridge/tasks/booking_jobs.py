from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Session
from clientbridge.services.booking_service import release_session_slot

_UNPAID_TTL = timedelta(minutes=30)


async def run_reap_unpaid_bookings(db: AsyncSession, now: datetime) -> int:
    """Cancel public online bookings that have held a slot past the deposit window without paying,
    freeing the session so it's bookable again. A confirmed online booking commits before its
    deposit is paid (no settled deposit → the hold was never earned). Idempotent — a canceled
    booking no longer matches; a row with a settled deposit is left alone."""
    settled = (
        select(Payment.booking_id)
        .where(
            Payment.kind == "deposit",
            Payment.status == "succeeded",
            Payment.booking_id.is_not(None),  # guard the NOT IN against a NULL row
        )
        .subquery()
    )
    bookings = (
        await db.execute(
            select(Booking, Session)
            .join(Session, Session.id == Booking.session_id)
            .where(
                Booking.deleted_at.is_(None),
                Booking.source == "online",
                Booking.deposit_required.is_(True),
                Booking.deposit_status == "pending",
                Booking.status.not_in(("completed", "canceled", "no_show")),
                Booking.created_at < now - _UNPAID_TTL,
                Booking.id.not_in(select(settled.c.booking_id)),
            )
        )
    ).all()
    for booking, session in bookings:
        booking.status = "canceled"
        booking.canceled_at = now
        await release_session_slot(db, session)
    await db.commit()
    return len(bookings)


async def reap_unpaid_bookings(ctx: dict[str, object]) -> int:
    """arq cron entry — a global scan freeing slots held by unpaid online bookings."""
    async with SessionLocal() as db:
        return await run_reap_unpaid_bookings(db, datetime.now(UTC))
