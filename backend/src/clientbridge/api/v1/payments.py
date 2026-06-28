from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, GatewayDep
from clientbridge.schemas.payments import (
    ConnectStatus,
    InteracRequest,
    OnboardingLink,
    PayIntentOut,
    RefundOut,
)
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


pay_router = APIRouter(prefix="/payments", tags=["payments"])


@pay_router.post("/invoice/{invoice_id}", response_model=PayIntentOut)
async def pay_invoice(
    invoice_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    amount_cents: int | None = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PayIntentOut:
    return await PaymentService(db, principal, gateway).pay_invoice(
        invoice_id, amount_cents, idempotency_key
    )


@pay_router.post("/{payment_id}/refund", response_model=RefundOut)
async def refund_payment(
    payment_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> RefundOut:
    return await PaymentService(db, principal, gateway).refund_payment(payment_id)


@pay_router.post("/invoice/{invoice_id}/interac", response_model=InteracRequest)
async def request_interac(
    invoice_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    amount_cents: int | None = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InteracRequest:
    return await PaymentService(db, principal, gateway).request_interac(
        invoice_id, amount_cents, idempotency_key
    )
