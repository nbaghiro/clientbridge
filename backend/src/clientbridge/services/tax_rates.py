from collections.abc import Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.billing import TaxRate
from clientbridge.models.identity import Business


async def rates_for_business(db: AsyncSession, business_id: str) -> Sequence[TaxRate]:
    """Province rates for a business: the global defaults plus any business-specific override."""
    province = (
        await db.execute(select(Business.province).where(Business.id == business_id))
    ).scalar_one_or_none()
    if province is None:
        return []
    result = await db.execute(
        select(TaxRate)
        .where(
            TaxRate.province == province,
            or_(TaxRate.business_id == business_id, TaxRate.business_id.is_(None)),
        )
        .order_by(TaxRate.jurisdiction)
    )
    return result.scalars().all()
