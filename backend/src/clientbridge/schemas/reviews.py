from datetime import datetime

from pydantic import BaseModel, Field

from clientbridge.schemas.public import PublicBrand


class ReviewRequestCreate(BaseModel):
    client_id: str
    booking_id: str | None = None


class ReviewOut(BaseModel):
    id: str
    business_id: str
    client_id: str
    booking_id: str | None
    rating: int | None
    body: str | None
    response: str | None
    responded_at: datetime | None
    sent_to_google: bool
    status: str
    channel: str | None
    requested_at: datetime | None
    submitted_at: datetime | None


class ReviewLinkOut(ReviewOut):
    token: str = Field(description="The public review link token, returned when requested")


class ReviewRespond(BaseModel):
    response: str = Field(min_length=1)


class ReviewSummary(BaseModel):
    average: float | None = Field(description="Mean rating of published reviews; null if none")
    count: int = Field(description="Number of published reviews")


class PublicReviewContext(BaseModel):
    business_name: str
    brand: PublicBrand
    completed: bool
    rating: int | None = None


class PublicReviewSubmit(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str | None = None
