from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.models.identity import Business
from clientbridge.models.reviews import Review, ReviewRequest
from clientbridge.schemas.reviews import PublicReviewContext, PublicReviewSubmit


class PublicReviewService:
    """The unauthenticated review surface (#4). The opaque request token is the only credential — it
    resolves one review request, so no principal / tenant scope is involved (mirrors PublicPay)."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[ReviewRequest, Business]:
        request = (
            await self.db.execute(select(ReviewRequest).where(ReviewRequest.token == token))
        ).scalar_one_or_none()
        if request is None:
            raise NotFound("review link not found")
        business = await self.db.get(Business, request.business_id)
        if business is None:
            raise NotFound("review link not found")
        return request, business

    async def context(self, token: str) -> PublicReviewContext:
        request, business = await self._resolve(token)
        rating = await self._submitted_rating(request)
        return PublicReviewContext(
            business_name=business.name, completed=request.status == "completed", rating=rating
        )

    async def submit(self, token: str, data: PublicReviewSubmit) -> PublicReviewContext:
        request, business = await self._resolve(token)
        # Lock the request row so two concurrent public submits can't both insert a review:
        # the second blocks here, then sees the completed status and 409s.
        request = (
            await self.db.execute(
                select(ReviewRequest).where(ReviewRequest.id == request.id).with_for_update()
            )
        ).scalar_one()
        if request.status == "completed":
            raise Conflict("this review was already submitted")
        review = Review(
            id=new_id("review"),
            business_id=request.business_id,
            client_id=request.client_id,
            booking_id=request.booking_id,
            rating=data.rating,
            body=data.body,
            status="published",
        )
        self.db.add(review)
        await self.db.flush()
        request.status = "completed"
        request.review_id = review.id
        if request.sent_at is None:
            request.sent_at = datetime.now(UTC)
        await self.db.commit()
        return PublicReviewContext(
            business_name=business.name, completed=True, rating=review.rating
        )

    async def _submitted_rating(self, request: ReviewRequest) -> int | None:
        if request.review_id is None:
            return None
        review = await self.db.get(Review, request.review_id)
        return review.rating if review is not None else None
