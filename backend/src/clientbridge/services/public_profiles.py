from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import NotFound
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.business import Business
from clientbridge.models.scheduling import Hours
from clientbridge.schemas.business import BrandInput
from clientbridge.schemas.public_profiles import (
    PublicProfile,
    PublicProfileHours,
)
from clientbridge.services.public import PublicBookingService


class PublicProfilesService:
    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.booking = PublicBookingService(db, gateway)

    async def page(self, slug: str) -> PublicProfile:
        business = (
            await self.db.execute(select(Business).where(Business.slug == slug))
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("business not found")
        page = await self.booking.page(slug)
        brand = BrandInput.model_validate(business.brand or {})
        hours = (
            (
                await self.db.execute(
                    scoped(Hours, business.id).where(
                        Hours.staff_id.in_([person.id for person in page.staff]),
                        Hours.basis == "recurring",
                        Hours.available.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        windows = {
            (
                row.weekday,
                row.start_time.isoformat(timespec="minutes"),
                row.end_time.isoformat(timespec="minutes"),
            )
            for row in hours
            if row.weekday is not None and row.start_time is not None and row.end_time is not None
        }
        merged: list[PublicProfileHours] = []
        for day, start, end in sorted(windows):
            if merged and merged[-1].weekday == day and start <= merged[-1].end:
                merged[-1].end = max(merged[-1].end, end)
            else:
                merged.append(PublicProfileHours(weekday=day, start=start, end=end))
        return PublicProfile(
            **page.model_dump(exclude={"staff"}),
            staff=[person for person in page.staff if person.id in brand.public_staff_ids],
            cover_url=brand.cover_url,
            about=brand.about,
            address=brand.address,
            phone=brand.phone,
            email=brand.email,
            website=brand.website,
            neighbourhood=brand.neighbourhood,
            gallery_urls=brand.gallery_urls,
            hours=merged,
        )
