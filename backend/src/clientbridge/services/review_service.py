import secrets
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.crm import Client
from clientbridge.models.reviews import Review, ReviewRequest
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.reviews import (
    ReviewOut,
    ReviewRequestCreate,
    ReviewRequestOut,
    ReviewSummary,
)
from clientbridge.services.notification_service import Notifier

_OPEN = ("sent", "opened")


def build_review_request(
    business_id: str, client_id: str, booking_id: str | None, now: datetime
) -> ReviewRequest:
    """A fresh, sent review request with a unique opaque token — shared by the request command and
    the dispatch job so both mint identical, principal-less rows."""
    return ReviewRequest(
        id=new_id("review_request"),
        business_id=business_id,
        client_id=client_id,
        booking_id=booking_id,
        channel="email",
        token=secrets.token_urlsafe(16),
        status="sent",
        sent_at=now,
    )


class ReviewService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def request_review(
        self, data: ReviewRequestCreate, idempotency_key: str | None, notify: Notifier
    ) -> ReviewRequestOut:
        self._assert_admin()
        await self._client(data.client_id)
        if data.booking_id is not None:
            await self._booking(data.booking_id)
            await self._assert_no_open_request(data.booking_id)

        async def run(cmd: Command) -> ReviewRequestOut:
            request = build_review_request(
                self.biz, data.client_id, data.booking_id, datetime.now(UTC)
            )
            self.db.add(request)
            try:
                await self.db.flush()  # the partial unique index backstops a concurrent request
            except IntegrityError as exc:
                raise Conflict("a review request for that booking is already open") from exc
            cmd.record("review.request", entity_type="review_request", entity_id=request.id)
            # Inside the command so a same-key retry replays the response without re-notifying.
            await notify.on_review_requested(self.db, request.id)
            return _request_out(request)

        return await run_command(
            self.db,
            self.principal,
            action="review.request",
            run=run,
            response_model=ReviewRequestOut,
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
                scoped(ReviewRequest, self.biz)
                .where(ReviewRequest.booking_id == booking_id, ReviewRequest.status.in_(_OPEN))
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise Conflict("a review request for that booking is already open")

    async def _review(self, review_id: str) -> Review:
        row = (
            await self.db.execute(scoped(Review, self.biz).where(Review.id == review_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("review not found")
        return row


def _request_out(request: ReviewRequest) -> ReviewRequestOut:
    return ReviewRequestOut(
        id=request.id,
        business_id=request.business_id,
        client_id=request.client_id,
        booking_id=request.booking_id,
        channel=request.channel,
        status=request.status,
        token=request.token,
        sent_at=request.sent_at,
        review_id=request.review_id,
    )


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
    )
