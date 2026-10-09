from datetime import datetime

from pydantic import BaseModel, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.reviews import Review
from clientbridge.schemas.public import PublicBookingPage, PublicSlot


class PublicProfileReview(Mirror):
    mirrors = Review

    id: str
    rating: int
    body: str | None
    response: str | None
    submitted_at: datetime | None


class PublicProfileHours(BaseModel):
    weekday: int
    start: str
    end: str


class PublicProfile(PublicBookingPage):
    cover_url: str | None = None
    about: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    neighbourhood: str | None = None
    gallery_urls: list[str] = Field(default_factory=list)
    reviews: list[PublicProfileReview] = Field(default_factory=list)
    hours: list[PublicProfileHours] = Field(default_factory=list)
    timezone: str


class PublicServiceOpening(BaseModel):
    item_id: str
    slots: list[PublicSlot]


class PublicNextOpenings(BaseModel):
    services: list[PublicServiceOpening]
    through: str
