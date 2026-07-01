from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.identity import BusinessOut, BusinessSettingsUpdate
from clientbridge.services.business_service import BusinessService

router = APIRouter(prefix="/business", tags=["business"])


@router.patch("", response_model=BusinessOut)
async def update_business(
    body: BusinessSettingsUpdate, principal: CurrentPrincipal, db: DbSession
) -> BusinessOut:
    business = await BusinessService(db, principal).update_settings(body)
    return BusinessOut.model_validate(business)
