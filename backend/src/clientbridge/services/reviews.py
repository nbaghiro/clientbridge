import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.clients import Client
from clientbridge.models.reviews import REVIEW_OPEN, REVIEW_SUBMITTED, Review
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.reviews import (
    ReviewLinkOut,
    ReviewOut,
    ReviewRequestCreate,
    ReviewSummary,
)
from clientbridge.services.notifications import Notifier


def build_review_request(
    business_id: str, client_id: str, booking_id: str | None, now: datetime
) -> Review:
    """A requested review with a unique token."""
    return Review(
        id=new_id("review"),
        business_id=business_id,
        client_id=client_id,
        booking_id=booking_id,
        channel="email",
        token=secrets.token_urlsafe(16),
        status="requested",
        requested_at=now,
    )


class ReviewService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def request_review(
        self, data: ReviewRequestCreate, idempotency_key: str | None, notify: Notifier
    ) -> ReviewLinkOut:
        self._assert_admin()
        await self._client(data.client_id)
        if data.booking_id is not None:
            await self._booking(data.booking_id)
            await self._assert_no_open_request(data.booking_id)

        async def run(cmd: Command) -> ReviewLinkOut:
            request = build_review_request(
                self.biz, data.client_id, data.booking_id, datetime.now(UTC)
            )
            self.db.add(request)
            try:
                await self.db.flush()  # the partial unique index backstops a concurrent request
            except IntegrityError as exc:
                raise Conflict("a review request for that booking is already open") from exc
            cmd.record("review.request", entity_type="review", entity_id=request.id)
            # Inside the command so a same-key retry replays the response without re-notifying.
            await notify.on_review_requested(self.db, request.id)
            return _request_out(request)

        return await run_command(
            self.db,
            self.principal,
            action="review.request",
            run=run,
            response_model=ReviewLinkOut,
            idempotency_key=idempotency_key,
        )

    async def summary(self) -> ReviewSummary:
        sub = scoped(Review, self.biz).where(Review.status == "published").subquery()
        row = (
            await self.db.execute(select(func.avg(sub.c.rating), func.count()).select_from(sub))
        ).one()
        avg, count = row[0], int(row[1])
        return ReviewSummary(average=round(float(avg), 2) if avg is not None else None, count=count)

    async def respond_to_review(self, review_id: str, response: str) -> ReviewOut:
        self._assert_admin()
        review = await self._review(review_id)

        async def run(cmd: Command) -> ReviewOut:
            review.response = response
            review.responded_at = datetime.now(UTC)
            await self.db.flush()
            cmd.record("review.respond", entity_type="review", entity_id=review.id)
            return _review_out(review)

        return await run_command(
            self.db, self.principal, action="review.respond", run=run, response_model=ReviewOut
        )

    async def hide_review(self, review_id: str) -> ReviewOut:
        return await self._set_status(review_id, "hidden", "review.hide")

    async def publish_review(self, review_id: str) -> ReviewOut:
        return await self._set_status(review_id, "published", "review.publish")

    async def mark_sent_to_google(self, review_id: str) -> ReviewOut:
        self._assert_admin()
        review = await self._review(review_id)

        async def run(cmd: Command) -> ReviewOut:
            review.sent_to_google = True
            await self.db.flush()
            cmd.record("review.google", entity_type="review", entity_id=review.id)
            return _review_out(review)

        return await run_command(
            self.db, self.principal, action="review.google", run=run, response_model=ReviewOut
        )

    async def _set_status(self, review_id: str, status: str, action: str) -> ReviewOut:
        self._assert_admin()
        review = await self._review(review_id)

        async def run(cmd: Command) -> ReviewOut:
            review.status = status
            await self.db.flush()
            cmd.record(action, entity_type="review", entity_id=review.id)
            return _review_out(review)

        return await run_command(
            self.db, self.principal, action=action, run=run, response_model=ReviewOut
        )

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage reviews"
        )

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _booking(self, booking_id: str) -> Booking:
        row = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True).where(Booking.id == booking_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("booking not found")
        return row

    async def _assert_no_open_request(self, booking_id: str) -> None:
        existing = (
            await self.db.execute(
                scoped(Review, self.biz)
                .where(Review.booking_id == booking_id, Review.status.in_(REVIEW_OPEN))
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise Conflict("a review request for that booking is already open")

    async def _review(self, review_id: str) -> Review:
        row = (
            await self.db.execute(
                scoped(Review, self.biz).where(
                    Review.id == review_id, Review.status.in_(REVIEW_SUBMITTED)
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("review not found")
        return row


def _request_out(request: Review) -> ReviewLinkOut:
    assert request.token is not None
    return ReviewLinkOut(**_review_out(request).model_dump(), token=request.token)


def _review_out(review: Review) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        business_id=review.business_id,
        client_id=review.client_id,
        booking_id=review.booking_id,
        rating=review.rating,
        body=review.body,
        response=review.response,
        responded_at=review.responded_at,
        sent_to_google=review.sent_to_google,
        status=review.status,
        channel=review.channel,
        requested_at=review.requested_at,
        submitted_at=review.submitted_at,
    )


_REQUEST_WINDOW = timedelta(days=7)


async def run_review_requests(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Send one review request per booking completed in the last 7 days."""
    requested = select(Review.booking_id).where(Review.booking_id.is_not(None))
    bookings = (
        (
            await db.execute(
                select(Booking).where(
                    Booking.deleted_at.is_(None),
                    Booking.status == "completed",
                    Booking.completed_at.is_not(None),
                    Booking.completed_at >= now - _REQUEST_WINDOW,
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
