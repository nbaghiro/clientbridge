from datetime import datetime

from pydantic import BaseModel, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.clients import Channel
from clientbridge.models.reviews import Review, ReviewStatus
from clientbridge.schemas.public import PublicBrand


class ReviewRequestCreate(Mirror):
    mirrors = Review

    client_id: str
    booking_id: str | None = None


class ReviewOut(Mirror):
    mirrors = Review

    id: str
    business_id: str
    client_id: str
    booking_id: str | None
    rating: int | None
    body: str | None
    response: str | None
    responded_at: datetime | None
    sent_to_google: bool
    status: ReviewStatus
    channel: Channel | None
    requested_at: datetime | None
    submitted_at: datetime | None


class ReviewLinkOut(ReviewOut):
    token: str = Field(description="The public review link token, returned when requested")


class ReviewRespond(Mirror):
    mirrors = Review

    response: str = Field(min_length=1)


class ReviewShareOut(BaseModel):
    review: ReviewOut
    google_review_url: str


class PublicReviewContext(BaseModel):
    business_name: str
    brand: PublicBrand
    completed: bool
    rating: int | None = None
    first_name: str | None = None
    pet: str | None = None
    service: str | None = None
    staff: str | None = None
    google_review_url: str | None = Field(
        default=None, description="Offered after a published review; null while it is held"
    )
    published: bool = False


class PublicReviewSubmit(Mirror):
    mirrors = Review

    rating: int = Field(ge=1, le=5)
    body: str | None = None
