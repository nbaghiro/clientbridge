from typing import Annotated

from fastapi import APIRouter, Header, Query

from clientbridge.core.deps import (
    CurrentPrincipal,
    DbSession,
    EmailDep,
    GatewayDep,
    PushDep,
    SmsDep,
)
from clientbridge.schemas.orders import ConnectionTokenOut
from clientbridge.schemas.payments import (
    ConnectSessionIn,
    ConnectSessionOut,
    ConnectStatus,
    DetachResult,
    PaymentMethodOut,
    PaymentSetupLinkOut,
    PayoutContentsOut,
    PayoutsOut,
    RefundIn,
    RefundOut,
    RefundPreview,
    RemittanceIn,
    RemittanceOut,
    SetupIntentOut,
    TaxFilings,
)
from clientbridge.services.deliveries import send_queued
from clientbridge.services.orders import OrderService
from clientbridge.services.payments import PaymentService
from clientbridge.services.remittances import RemittanceService

connect_router = APIRouter(prefix="/connect", tags=["connect"])


@connect_router.post("/session", response_model=ConnectSessionOut)
async def account_session(
    body: ConnectSessionIn,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> ConnectSessionOut:
    return await PaymentService(db, principal, gateway).account_session(body.component)


@connect_router.get("/status", response_model=ConnectStatus)
async def connect_status(
    principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> ConnectStatus:
    return await PaymentService(db, principal, gateway).status()


@connect_router.get("/payouts", response_model=PayoutsOut)
async def payouts(
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    after: Annotated[str | None, Query(pattern=r"^po_[A-Za-z0-9_]+$", max_length=255)] = None,
) -> PayoutsOut:
    return await PaymentService(db, principal, gateway).payouts(after)


@connect_router.get("/payouts/{payout_id}/transactions", response_model=PayoutContentsOut)
async def payout_transactions(
    payout_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    after: Annotated[str | None, Query(pattern=r"^txn_[a-zA-Z0-9]+$", max_length=255)] = None,
) -> PayoutContentsOut:
    return await PaymentService(db, principal, gateway).payout_contents(payout_id, after)


payments_router = APIRouter(prefix="/payments", tags=["payments"])


@payments_router.post("/setup-intent/{client_id}", response_model=SetupIntentOut)
async def setup_card(
    client_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> SetupIntentOut:
    return await PaymentService(db, principal, gateway).start_card_setup(client_id, idempotency_key)


@payments_router.post("/pad-links/{client_id}", response_model=PaymentSetupLinkOut)
async def create_pad_link(
    client_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> PaymentSetupLinkOut:
    return await PaymentService(db, principal, gateway).create_pad_link(client_id)


@payments_router.delete("/pad-links/{link_id}", status_code=204)
async def revoke_pad_link(
    link_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> None:
    await PaymentService(db, principal, gateway).revoke_pad_link(link_id)


@payments_router.delete("/methods/{payment_method_id}", response_model=DetachResult)
async def detach_card(
    payment_method_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> DetachResult:
    return await PaymentService(db, principal, gateway).detach_card(payment_method_id)


@payments_router.post("/methods/{payment_method_id}/default", response_model=PaymentMethodOut)
async def set_default_card(
    payment_method_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> PaymentMethodOut:
    return await PaymentService(db, principal, gateway).set_default_card(payment_method_id)


@payments_router.post("/{payment_id}/refund", response_model=RefundOut)
async def refund_payment(
    payment_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    body: RefundIn,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8)],
) -> RefundOut:
    out = await PaymentService(db, principal, gateway).refund_payment(
        payment_id, body.amount_cents, idempotency_key, body.reason, body.notify
    )
    await send_queued(db, email, sms, push)
    return out


@payments_router.get("/{payment_id}/refund-preview", response_model=RefundPreview)
async def refund_preview(
    payment_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    amount_cents: int | None = None,
) -> RefundPreview:
    return await PaymentService(db, principal, gateway).refund_preview(payment_id, amount_cents)


@payments_router.get("/remittances", response_model=TaxFilings)
async def tax_filings(principal: CurrentPrincipal, db: DbSession) -> TaxFilings:
    return await RemittanceService(db, principal).filings()


@payments_router.post("/remittances", response_model=RemittanceOut, status_code=201)
async def record_remittance(
    data: RemittanceIn,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RemittanceOut:
    return await RemittanceService(db, principal).record(data, idempotency_key)


terminal_router = APIRouter(prefix="/terminal", tags=["terminal"])


@terminal_router.post("/connection-token", response_model=ConnectionTokenOut)
async def connection_token(
    principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> ConnectionTokenOut:
    return await OrderService(db, principal, gateway).connection_token()
