from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.integrations.email import get_email_sender
from clientbridge.integrations.push import get_push_sender
from clientbridge.integrations.sms import get_sms_sender
from clientbridge.models.scheduling import Booking, Session
from clientbridge.services.notification_service import Notifier

_TERMINAL = ("completed", "canceled", "no_show")
_WINDOW = timedelta(hours=24)


async def run_reminders(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Remind each active booking starting within the next 24h that hasn't been reminded yet, and
    return how many were sent. Idempotent across runs — `reminded_at` dedups."""
    bookings = (
        (
            await db.execute(
                select(Booking)
                .join(Session, Session.id == Booking.session_id)
                .where(
                    Booking.deleted_at.is_(None),
                    Booking.reminded_at.is_(None),
                    Booking.status.not_in(_TERMINAL),
                    Session.starts_at > now,
                    Session.starts_at <= now + _WINDOW,
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
