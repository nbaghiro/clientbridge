from fastapi import APIRouter

from clientbridge.core.deps import CurrentUser, DbSession
from clientbridge.schemas.identity import BusinessOut, OnboardBody
from clientbridge.services.onboarding_service import OnboardingService

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.post("", response_model=BusinessOut, status_code=201)
async def onboard(body: OnboardBody, user: CurrentUser, db: DbSession) -> BusinessOut:
    biz = await OnboardingService(db).onboard(user.id, body)
    return BusinessOut.model_validate(biz)
