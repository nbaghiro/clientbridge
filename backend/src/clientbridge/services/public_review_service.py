from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict
from clientbridge.models.identity import Business
from clientbridge.models.reviews import REVIEW_OPEN, Review
from clientbridge.schemas.reviews import PublicReviewContext, PublicReviewSubmit
from clientbridge.services.public_common import business_or_404, public_brand, resolve_by_token


class PublicReviewService:
    """The unauthenticated review surface (#4). The opaque request token is the only credential — it
    resolves one review, so no principal / tenant scope is involved (mirrors PublicPay)."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[Review, Business]:
        review = await resolve_by_token(
            self.db, Review, Review.token == token, "review link not found"
        )
        return review, await business_or_404(self.db, review.business_id, "review link not found")

    async def context(self, token: str) -> PublicReviewContext:
        review, business = await self._resolve(token)
        if review.status == "requested":
            review.status = "opened"
            await self.db.commit()
        return self._context(review, business)

    async def submit(self, token: str, data: PublicReviewSubmit) -> PublicReviewContext:
        review, business = await self._resolve(token)
        # Lock the row so two concurrent public submits can't both record a rating: the second
        # blocks here, then sees the submitted status and 409s.
        review = (
            await self.db.execute(select(Review).where(Review.id == review.id).with_for_update())
        ).scalar_one()
        if review.status not in REVIEW_OPEN:
            raise Conflict("this review was already submitted")
        now = datetime.now(UTC)
        review.rating = data.rating
        review.body = data.body
        review.submitted_at = now
        review.status = "published"
        if review.requested_at is None:
            review.requested_at = now
        await self.db.commit()
        return self._context(review, business)

    @staticmethod
    def _context(review: Review, business: Business) -> PublicReviewContext:
        return PublicReviewContext(
            business_name=business.name,
            brand=public_brand(business),
            completed=review.status not in REVIEW_OPEN,
            rating=review.rating,
        )
