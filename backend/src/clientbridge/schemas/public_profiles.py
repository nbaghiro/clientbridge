from pydantic import BaseModel, Field

from clientbridge.schemas.public import PublicBookingPage, PublicSlot


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
    hours: list[PublicProfileHours] = Field(default_factory=list)


class PublicServiceOpening(BaseModel):
    item_id: str
    slots: list[PublicSlot]


class PublicNextOpenings(BaseModel):
    services: list[PublicServiceOpening]
    through: str
