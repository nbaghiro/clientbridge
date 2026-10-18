from datetime import datetime

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
