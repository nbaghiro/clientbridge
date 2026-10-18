from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from clientbridge.core.mirrors import Mirror
from clientbridge.models.reviews import ReviewRequest


class ReviewRequestCreate(Mirror):
    mirrors = ReviewRequest

    client_id: str
    booking_id: str | None = None


class ReviewRequestOut(Mirror):
    mirrors = ReviewRequest

    id: str
    business_id: str
    client_id: str
    booking_id: str | None
    requested_at: datetime


class GoogleReviewAvailability(BaseModel):
    state: Literal["unavailable"] = "unavailable"
    connection_id: None = None
    generation: int = 0
    location: None = None
    can_request: bool = False
