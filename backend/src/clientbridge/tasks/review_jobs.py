from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.db import SessionLocal
from clientbridge.integrations.email import get_email_sender
from clientbridge.integrations.push import get_push_sender
from clientbridge.integrations.sms import get_sms_sender
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking
from clientbridge.services.notification_service import Notifier
from clientbridge.services.review_service import build_review_request

_WINDOW = timedelta(days=7)


async def run_review_requests(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Send one review request per booking completed in the last 7 days that has no request yet, and
    return how many were sent. Idempotent — any existing request (any status) dedups the booking."""
    requested = select(ReviewRequest.booking_id).where(ReviewRequest.booking_id.is_not(None))
    bookings = (
        (
            await db.execute(
                select(Booking).where(
                    Booking.deleted_at.is_(None),
                    Booking.status == "completed",
                    Booking.completed_at.is_not(None),
                    Booking.completed_at >= now - _WINDOW,
                    Booking.completed_at <= now,
                    Booking.id.not_in(requested),
                )
            )
        )
        .scalars()
        .all()
    )
    requests = []
    for booking in bookings:
        request = build_review_request(booking.business_id, booking.client_id, booking.id, now)
        db.add(request)
        requests.append(request)
    await db.flush()
    for request in requests:
        await notifier.on_review_requested(db, request.id)
    await db.commit()
    return len(requests)


async def send_review_requests(ctx: dict[str, object]) -> int:
    """arq cron entry — a global scan; each request resolves its own business + locale."""
    async with SessionLocal() as db:
        notifier = Notifier(get_email_sender(), get_sms_sender(), get_push_sender())
        return await run_review_requests(db, notifier, datetime.now(UTC))
