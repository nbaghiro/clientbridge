from datetime import datetime

from pydantic import BaseModel, Field


class ReviewRequestCreate(BaseModel):
    client_id: str
    booking_id: str | None = None


class ReviewRequestOut(BaseModel):
    id: str
    business_id: str
    client_id: str
    booking_id: str | None
    channel: str
    status: str
    token: str
    sent_at: datetime | None
    review_id: str | None


class ReviewOut(BaseModel):
    id: str
    business_id: str
    client_id: str
    booking_id: str | None
    rating: int
    body: str | None
    response: str | None
    responded_at: datetime | None
    sent_to_google: bool
    status: str


class ReviewRespond(BaseModel):
    response: str = Field(min_length=1)


class ReviewSummary(BaseModel):
    average: float | None  # mean rating over published reviews; None when there are none
    count: int  # number of published reviews


class PublicReviewContext(BaseModel):
    business_name: str
    completed: bool
    rating: int | None = None


class PublicReviewSubmit(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str | None = None
