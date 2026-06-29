from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.billing import EstimateCreate, EstimateOut, EstimateUpdate, InvoiceOut
from clientbridge.services.billing_service import BillingService
from clientbridge.services.notification_service import Notifier

router = APIRouter(prefix="/estimates", tags=["estimates"])


@router.post("", response_model=EstimateOut, status_code=201)
async def create_estimate(
    body: EstimateCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> EstimateOut:
    return await BillingService(db, principal).create_estimate(body, idempotency_key)


@router.patch("/{estimate_id}", response_model=EstimateOut)
async def update_estimate(
    estimate_id: str, body: EstimateUpdate, principal: CurrentPrincipal, db: DbSession
) -> EstimateOut:
    return await BillingService(db, principal).update_estimate(estimate_id, body)


@router.post("/{estimate_id}/send", response_model=EstimateOut)
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


@router.post("/{estimate_id}/accept", response_model=EstimateOut)
async def accept_estimate(
    estimate_id: str, principal: CurrentPrincipal, db: DbSession
) -> EstimateOut:
    return await BillingService(db, principal).accept_estimate(estimate_id)


@router.post("/{estimate_id}/decline", response_model=EstimateOut)
async def decline_estimate(
    estimate_id: str, principal: CurrentPrincipal, db: DbSession
) -> EstimateOut:
    return await BillingService(db, principal).decline_estimate(estimate_id)


@router.post("/{estimate_id}/convert", response_model=InvoiceOut, status_code=201)
async def convert_estimate(
    estimate_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InvoiceOut:
    return await BillingService(db, principal).convert_estimate(estimate_id, idempotency_key)
