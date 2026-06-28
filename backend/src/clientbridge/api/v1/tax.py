from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.tax import TaxRateOut
from clientbridge.services.tax_rates import rates_for_business

router = APIRouter(prefix="/tax-rates", tags=["tax"])


@router.get("", response_model=list[TaxRateOut])
async def list_tax_rates(principal: CurrentPrincipal, db: DbSession) -> list[TaxRateOut]:
    rows = await rates_for_business(db, principal.business_id)
    return [TaxRateOut.model_validate(r) for r in rows]
