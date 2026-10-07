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
from clientbridge.schemas.billing import (
    EstimateCreate,
    EstimateDecline,
    EstimateOut,
    EstimateUpdate,
    InvoiceCreate,
    InvoiceOut,
    InvoiceUpdate,
)
from clientbridge.schemas.payments import InvoicePaymentIn, InvoicePaymentOut
from clientbridge.services.billing import BillingService
from clientbridge.services.notifications import Notifier
from clientbridge.services.payments import PaymentService

estimates_router = APIRouter(prefix="/estimates", tags=["estimates"])


@estimates_router.post("", response_model=EstimateOut, status_code=201)
async def create_estimate(
    body: EstimateCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> EstimateOut:
    result = await BillingService(db, principal).create_estimate(body, idempotency_key)
    if body.send:
        await Notifier(email, sms, push).on_estimate_sent(db, result.id)
    return result


@estimates_router.patch("/{estimate_id}", response_model=EstimateOut)
async def update_estimate(
    estimate_id: str, body: EstimateUpdate, principal: CurrentPrincipal, db: DbSession
) -> EstimateOut:
    return await BillingService(db, principal).update_estimate(estimate_id, body)


@estimates_router.post("/{estimate_id}/send", response_model=EstimateOut)
async def send_estimate(
    estimate_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> EstimateOut:
    result = await BillingService(db, principal).send_estimate(estimate_id)
    await Notifier(email, sms, push).on_estimate_sent(db, result.id)
    return result


@estimates_router.post("/{estimate_id}/accept", response_model=EstimateOut)
async def accept_estimate(
    estimate_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> EstimateOut:
    result = await BillingService(db, principal).accept_estimate(estimate_id)
    await Notifier(email, sms, push).on_estimate_accepted(db, result.id)
    return result


@estimates_router.post("/{estimate_id}/decline", response_model=EstimateOut)
async def decline_estimate(
    estimate_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    body: EstimateDecline | None = None,
) -> EstimateOut:
    reason = body.reason if body is not None else None
    result = await BillingService(db, principal).decline_estimate(estimate_id, reason)
    await Notifier(email, sms, push).on_estimate_declined(db, result.id)
    return result


@estimates_router.post("/{estimate_id}/convert", response_model=InvoiceOut, status_code=201)
async def convert_estimate(
    estimate_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InvoiceOut:
    return await BillingService(db, principal).convert_estimate(estimate_id, idempotency_key)


invoices_router = APIRouter(prefix="/invoices", tags=["invoices"])


@invoices_router.post("", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    body: InvoiceCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InvoiceOut:
    result = await BillingService(db, principal).create_invoice(body, idempotency_key)
    if body.send:
        await Notifier(email, sms, push).on_invoice_sent(db, result.id)
    return result


@invoices_router.post("/from-booking/{booking_id}", response_model=InvoiceOut, status_code=201)
async def create_invoice_for_booking(
    booking_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InvoiceOut:
    return await BillingService(db, principal).create_invoice_for_booking(
        booking_id, idempotency_key
    )


@invoices_router.patch("/{invoice_id}", response_model=InvoiceOut)
async def update_invoice(
    invoice_id: str, body: InvoiceUpdate, principal: CurrentPrincipal, db: DbSession
) -> InvoiceOut:
    return await BillingService(db, principal).update_invoice(invoice_id, body)


@invoices_router.post("/{invoice_id}/send", response_model=InvoiceOut)
async def send_invoice(
    invoice_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> InvoiceOut:
    result = await BillingService(db, principal).send_invoice(invoice_id)
    await Notifier(email, sms, push).on_invoice_sent(db, result.id)
    return result


@invoices_router.post("/{invoice_id}/void", response_model=InvoiceOut)
async def void_invoice(invoice_id: str, principal: CurrentPrincipal, db: DbSession) -> InvoiceOut:
    return await BillingService(db, principal).void_invoice(invoice_id)


@invoices_router.post("/{invoice_id}/payments", response_model=InvoicePaymentOut, status_code=201)
async def record_invoice_payment(
    invoice_id: str,
    body: InvoicePaymentIn,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InvoicePaymentOut:
    result = await PaymentService(db, principal, gateway).record_invoice_payment(
        invoice_id, body, idempotency_key
    )
    if body.send_receipt and result.status == "succeeded":
        await Notifier(email, sms, push).on_payment_succeeded(db, result.payment_id)
    return result
