from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.reviews import (
    ReviewOut,
    ReviewRequestCreate,
    ReviewRequestOut,
    ReviewRespond,
    ReviewSummary,
)
from clientbridge.services.notification_service import Notifier
from clientbridge.services.review_service import ReviewService

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


@router.get("/summary", response_model=ReviewSummary)
async def review_summary(principal: CurrentPrincipal, db: DbSession) -> ReviewSummary:
    return await ReviewService(db, principal).summary()


@router.post("/{review_id}/respond", response_model=ReviewOut)
async def respond_to_review(
    review_id: str, body: ReviewRespond, principal: CurrentPrincipal, db: DbSession
) -> ReviewOut:
    return await ReviewService(db, principal).respond_to_review(review_id, body.response)


@router.post("/{review_id}/hide", response_model=ReviewOut)
async def hide_review(review_id: str, principal: CurrentPrincipal, db: DbSession) -> ReviewOut:
    return await ReviewService(db, principal).hide_review(review_id)


@router.post("/{review_id}/publish", response_model=ReviewOut)
async def publish_review(review_id: str, principal: CurrentPrincipal, db: DbSession) -> ReviewOut:
    return await ReviewService(db, principal).publish_review(review_id)


@router.post("/{review_id}/google", response_model=ReviewOut)
async def mark_sent_to_google(
    review_id: str, principal: CurrentPrincipal, db: DbSession
) -> ReviewOut:
    return await ReviewService(db, principal).mark_sent_to_google(review_id)
