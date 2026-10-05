from fastapi import APIRouter

from clientbridge.core.deps import CurrentPrincipal, CurrentUser, DbSession
from clientbridge.schemas.business import BusinessOut, BusinessSettingsUpdate, OnboardBody
from clientbridge.services.business import BusinessService, OnboardingService

business_router = APIRouter(prefix="/business", tags=["business"])


@business_router.patch("", response_model=BusinessOut)
async def update_business(
    body: BusinessSettingsUpdate, principal: CurrentPrincipal, db: DbSession
) -> BusinessOut:
    business = await BusinessService(db, principal).update_settings(body)
    return BusinessOut.model_validate(business)


onboarding_router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@onboarding_router.post("", response_model=BusinessOut, status_code=201)
async def onboard(body: OnboardBody, user: CurrentUser, db: DbSession) -> BusinessOut:
    biz = await OnboardingService(db).onboard(user.id, body)
    return BusinessOut.model_validate(biz)
