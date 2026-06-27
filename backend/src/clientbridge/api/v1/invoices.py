from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep
from clientbridge.schemas.billing import InvoiceCreate, InvoiceOut, InvoiceUpdate
from clientbridge.services.billing_service import BillingService

router = APIRouter(prefix="/invoices", tags=["invoices"])


@router.post("", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    body: InvoiceCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> InvoiceOut:
    return await BillingService(db, principal).create_invoice(body, idempotency_key)


@router.patch("/{invoice_id}", response_model=InvoiceOut)
async def update_invoice(
    invoice_id: str, body: InvoiceUpdate, principal: CurrentPrincipal, db: DbSession
) -> InvoiceOut:
    return await BillingService(db, principal).update_invoice(invoice_id, body)


@router.post("/{invoice_id}/send", response_model=InvoiceOut)
async def send_invoice(
    invoice_id: str, principal: CurrentPrincipal, db: DbSession, email_sender: EmailDep
) -> InvoiceOut:
    return await BillingService(db, principal).send_invoice(invoice_id, email_sender)


@router.post("/{invoice_id}/void", response_model=InvoiceOut)
async def void_invoice(invoice_id: str, principal: CurrentPrincipal, db: DbSession) -> InvoiceOut:
    return await BillingService(db, principal).void_invoice(invoice_id)
