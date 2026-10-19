from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.reviews import (
    GoogleReviewAvailability,
    ReviewRequestCreate,
    ReviewRequestOut,
)
from clientbridge.services.business import businesses_at_hour
from clientbridge.services.notifications import Notifier
from clientbridge.services.plans import plan_access

# a client with several visits gets at most one request in this span, asked for or sent by the job
REQUEST_COOLDOWN = timedelta(days=30)


async def recently_asked(db: AsyncSession, business_id: str, now: datetime) -> set[str]:
    return set(
        await db.scalars(
            scoped(ReviewRequest, business_id)
            .with_only_columns(ReviewRequest.client_id)
            .where(
                ReviewRequest.requested_at > now - REQUEST_COOLDOWN,
                ReviewRequest.requested_at <= now,
            )
        )
    )


def build_review_request(
    business_id: str, client_id: str, booking_id: str | None, now: datetime
) -> ReviewRequest:
    return ReviewRequest(
        id=new_id("review_request"),
        business_id=business_id,
        client_id=client_id,
        booking_id=booking_id,
        requested_at=now,
    )


class ReviewService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    def google_status(self) -> GoogleReviewAvailability:
        assert_role(
            self.principal, "owner", "admin", message="only managers can manage Google reviews"
        )
        return GoogleReviewAvailability()

    async def request_review(
        self, data: ReviewRequestCreate, idempotency_key: str | None, notify: Notifier
    ) -> ReviewRequestOut:
        assert_role(self.principal, "owner", "admin", message="only managers can request reviews")

        async def run(cmd: Command) -> ReviewRequestOut:
            business = await self.db.get(Business, self.biz)
            if business is None or not business.google_review_url:
                raise Conflict("add your Google review link before requesting reviews")
            client = await self.db.scalar(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == data.client_id)
            )
            if client is None:
                raise NotFound("client not found")
            if data.booking_id is not None:
                booking = await self.db.scalar(
                    scoped(Booking, self.biz, soft_delete=True)
                    .where(Booking.id == data.booking_id)
                    .with_for_update()
                )
                if booking is None or booking.client_id != data.client_id:
                    raise NotFound("booking not found")
                if booking.status != "completed":
                    raise Conflict("only a completed booking can be requested")
                existing = await self.db.scalar(
                    scoped(ReviewRequest, self.biz)
                    .where(ReviewRequest.booking_id == booking.id)
                    .limit(1)
                )
                if existing is not None:
                    raise Conflict("a review was already requested for that booking")
            now = clock.now()
            if data.client_id in await recently_asked(self.db, self.biz, now):
                raise Conflict(
                    "a review was requested from this client in the last 30 days",
                    code="review_recently_requested",
                )
            request = build_review_request(self.biz, data.client_id, data.booking_id, now)
            self.db.add(request)
            await self.db.flush()
            cmd.record("review.request", entity_type="review_request", entity_id=request.id)
            await notify.on_review_requested(self.db, request.id)
            return ReviewRequestOut.model_validate(request, from_attributes=True)

        return await run_command(
            self.db,
            self.principal,
            action="review.request",
            run=run,
            response_model=ReviewRequestOut,
            idempotency_key=idempotency_key,
            request=data,
        )


async def run_review_requests(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    requests = []
    for business in await businesses_at_hour(db, now, 8):
        if plan_access(business, now) == "lapsed" or not business.google_review_url:
            continue
        requested = (
            scoped(ReviewRequest, business.id)
            .with_only_columns(ReviewRequest.booking_id)
            .where(ReviewRequest.booking_id.is_not(None))
        )
        active = scoped(Client, business.id, soft_delete=True).with_only_columns(Client.id)
        bookings = await db.scalars(
            scoped(Booking, business.id, soft_delete=True)
            .where(
                Booking.status == "completed",
                Booking.completed_at >= now - timedelta(days=7),
                Booking.completed_at <= now,
                Booking.id.not_in(requested),
                Booking.client_id.in_(active),
            )
            .order_by(Booking.completed_at.desc(), Booking.id)
            .with_for_update(skip_locked=True)
        )
        asked = await recently_asked(db, business.id, now)
        for booking in bookings:
            if booking.client_id in asked:
                continue
            asked.add(booking.client_id)
            request = build_review_request(business.id, booking.client_id, booking.id, now)
            db.add(request)
            requests.append(request)
    await db.flush()
    for request in requests:
        await notifier.on_review_requested(db, request.id)
    await db.commit()
    return len(requests)
