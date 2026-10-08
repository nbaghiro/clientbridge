from typing import Annotated

from fastapi import APIRouter, Depends

from clientbridge.core.deps import DbSession, EmailDep, SmsDep
from clientbridge.core.ratelimit import public_booking_rate_limit
from clientbridge.schemas.returning import (
    ReturningChallengeOut,
    ReturningRequest,
    ReturningVerified,
    ReturningVerify,
)
from clientbridge.services.returning import ReturningService

router = APIRouter(prefix="/book/{slug}/returning", tags=["public-returning"])
RateLimited = Annotated[None, Depends(public_booking_rate_limit)]


@router.post("/request", response_model=ReturningChallengeOut)
async def request_returning_code(
    slug: str, data: ReturningRequest, db: DbSession, email: EmailDep, sms: SmsDep, _: RateLimited
) -> ReturningChallengeOut:
    return await ReturningService(db).request(slug, data, email, sms)


@router.post("/verify", response_model=ReturningVerified)
async def verify_returning_code(
    slug: str, data: ReturningVerify, db: DbSession, _: RateLimited
) -> ReturningVerified:
    return await ReturningService(db).verify(slug, data)
