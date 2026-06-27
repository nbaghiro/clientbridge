from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.repositories.tax import TaxRateRepository
from clientbridge.schemas.tax import TaxRateOut

router = APIRouter(prefix="/tax-rates", tags=["tax"])


@router.get("", response_model=list[TaxRateOut])
async def list_tax_rates(principal: CurrentPrincipal, db: DbSession) -> list[TaxRateOut]:
    rows = await TaxRateRepository(db).for_business(principal.business_id)
    return [TaxRateOut.model_validate(r) for r in rows]
