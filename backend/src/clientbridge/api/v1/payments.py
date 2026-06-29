from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import (
    CurrentPrincipal,
    DbSession,
    EmailDep,
    GatewayDep,
    PushDep,
    SmsDep,
)
from clientbridge.schemas.payments import (
    ConnectStatus,
    DetachResult,
    InteracRequest,
    OnboardingLink,
    PayIntentOut,
    PaymentMethodOut,
    RefundOut,
    RemittanceSummary,
    SetupIntentOut,
)
from clientbridge.services.notification_service import Notifier
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
    payment_method_id: str | None = None,
    deposit: bool = False,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PayIntentOut:
    return await PaymentService(db, principal, gateway).pay_invoice(
        invoice_id, amount_cents, idempotency_key, payment_method_id, deposit
    )


@pay_router.post("/setup-intent/{client_id}", response_model=SetupIntentOut)
async def setup_card(
    client_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> SetupIntentOut:
    return await PaymentService(db, principal, gateway).start_card_setup(client_id, idempotency_key)


@pay_router.delete("/methods/{payment_method_id}", response_model=DetachResult)
async def detach_card(
    payment_method_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> DetachResult:
    return await PaymentService(db, principal, gateway).detach_card(payment_method_id)


@pay_router.post("/methods/{payment_method_id}/default", response_model=PaymentMethodOut)
async def set_default_card(
    payment_method_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> PaymentMethodOut:
    return await PaymentService(db, principal, gateway).set_default_card(payment_method_id)


@pay_router.post("/{payment_id}/refund", response_model=RefundOut)
async def refund_payment(
    payment_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> RefundOut:
    out = await PaymentService(db, principal, gateway).refund_payment(payment_id)
    await Notifier(email, sms, push).on_refund(db, out.refund_id)
    return out


@pay_router.get("/remittance", response_model=RemittanceSummary)
async def remittance(
    principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> RemittanceSummary:
    return await PaymentService(db, principal, gateway).remittance_summary()


@pay_router.post("/invoice/{invoice_id}/interac", response_model=InteracRequest)
async def request_interac(
    invoice_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    amount_cents: int | None = None,
    deposit: bool = False,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InteracRequest:
    req = await PaymentService(db, principal, gateway).request_interac(
        invoice_id, amount_cents, idempotency_key, deposit
    )
    await Notifier(email, sms, push).on_interac_requested(db, req.payment_id)
    return req
