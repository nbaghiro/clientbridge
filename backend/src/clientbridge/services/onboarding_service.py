"""Onboarding: create a business + its owner, in one transaction. Tax rates are derived from the
business's province at compute time (see `services/tax_rates`), so nothing is seeded here."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.identity import Business, Staff
from clientbridge.schemas.identity import OnboardBody


class OnboardingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def onboard(self, user_id: str, data: OnboardBody) -> Business:
        existing = (
            await self.db.execute(select(Business).where(Business.slug == data.slug))
        ).scalar_one_or_none()
        if existing is not None:
            raise Conflict("business slug already taken")

        biz = Business(
            id=new_id("business"),
            name=data.name,
            slug=data.slug,
            province=data.province,
            timezone=data.timezone or "America/Toronto",
            locale=data.locale,
        )
        self.db.add(biz)
        await self.db.flush()  # insert the business first so the Staff FK resolves
        self.db.add(
            Staff(
                id=new_id("staff"),
                business_id=biz.id,
                user_id=user_id,
                role="owner",
                status="active",
                is_payee=True,
            )
        )
        await self.db.commit()
        return biz
