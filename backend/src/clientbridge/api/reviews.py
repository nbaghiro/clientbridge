from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.reviews import (
    GoogleReviewAvailability,
    ReviewRequestCreate,
    ReviewRequestOut,
)
from clientbridge.services.notifications import Notifier
from clientbridge.services.reviews import ReviewService

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("/request", response_model=ReviewRequestOut, status_code=201)
async def request_review(
    body: ReviewRequestCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ReviewRequestOut:
    return await ReviewService(db, principal).request_review(
        body, idempotency_key, Notifier(email, sms, push)
    )


@router.get("/google", response_model=GoogleReviewAvailability)
async def google_status(principal: CurrentPrincipal, db: DbSession) -> GoogleReviewAvailability:
    return ReviewService(db, principal).google_status()
