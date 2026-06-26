from fastapi import APIRouter
from sqlalchemy import or_, select

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.models.billing import TaxRate
from clientbridge.models.identity import Business
from clientbridge.schemas.tax import TaxRateOut

router = APIRouter(prefix="/tax-rates", tags=["tax"])


@router.get("", response_model=list[TaxRateOut])
async def list_tax_rates(principal: CurrentPrincipal, db: DbSession) -> list[TaxRateOut]:
    """The rates applicable to the business's province — global defaults + any business override."""
    province = (
        await db.execute(select(Business.province).where(Business.id == principal.business_id))
    ).scalar_one_or_none()
    if province is None:
        return []
    rows = (
        (
            await db.execute(
                select(TaxRate)
                .where(
                    TaxRate.province == province,
                    or_(
                        TaxRate.business_id == principal.business_id,
                        TaxRate.business_id.is_(None),
                    ),
                )
                .order_by(TaxRate.jurisdiction)
            )
        )
        .scalars()
        .all()
    )
    return [TaxRateOut.model_validate(r) for r in rows]
