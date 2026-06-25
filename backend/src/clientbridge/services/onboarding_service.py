"""Onboarding: create a business + its owner + default province tax rates, in one transaction."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict
from clientbridge.core.ids import new_id
from clientbridge.models.billing import TaxRate
from clientbridge.models.identity import Business, Staff
from clientbridge.schemas.identity import OnboardBody

# province → [(jurisdiction, rate_bps, name)]. QST 9.975% ≈ 998 bps (P3 tax engine handles sub-bps);
# AB + territories are GST-only; HST provinces have a single harmonized rate.
PROVINCE_TAX_RATES: dict[str, list[tuple[str, int, str]]] = {
    "BC": [("GST", 500, "GST 5%"), ("PST", 700, "PST (BC) 7%")],
    "AB": [("GST", 500, "GST 5%")],
    "SK": [("GST", 500, "GST 5%"), ("PST", 600, "PST (SK) 6%")],
    "MB": [("GST", 500, "GST 5%"), ("PST", 700, "PST (MB) 7%")],
    "ON": [("HST", 1300, "HST (ON) 13%")],
    "QC": [("GST", 500, "GST 5%"), ("QST", 998, "QST 9.975%")],
    "NB": [("HST", 1500, "HST 15%")],
    "NS": [("HST", 1500, "HST 15%")],
    "NL": [("HST", 1500, "HST 15%")],
    "PE": [("HST", 1500, "HST 15%")],
    "YT": [("GST", 500, "GST 5%")],
    "NT": [("GST", 500, "GST 5%")],
    "NU": [("GST", 500, "GST 5%")],
}


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
        await self.db.flush()  # insert the business first so the Staff/TaxRate FKs resolve
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
        for jurisdiction, rate_bps, name in PROVINCE_TAX_RATES.get(data.province, []):
            self.db.add(
                TaxRate(
                    id=new_id("tax_rate"),
                    business_id=biz.id,
                    jurisdiction=jurisdiction,
                    province=data.province,
                    rate_bps=rate_bps,
                    name=name,
                )
            )
        await self.db.commit()
        return biz
