from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.payments import ConnectStatus, OnboardingLink
from clientbridge.services.payment_service import PaymentService

router = APIRouter(prefix="/connect", tags=["connect"])


@router.post("/onboard", response_model=OnboardingLink)
async def onboard(
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> OnboardingLink:
    return await PaymentService(db, principal, gateway).start_onboarding(idempotency_key)


@router.get("/status", response_model=ConnectStatus)
async def connect_status(
    principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> ConnectStatus:
    return await PaymentService(db, principal, gateway).status()
