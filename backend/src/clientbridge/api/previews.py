from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.models.billing import Channel
from clientbridge.schemas.previews import OutgoingPreview
from clientbridge.services.previews import PreviewService

router = APIRouter(prefix="/previews", tags=["previews"])


@router.get("/invoices/{invoice_id}/send", response_model=OutgoingPreview)
async def invoice_send(
    invoice_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).invoice_send(invoice_id)


@router.get("/invoices/{invoice_id}/remind", response_model=OutgoingPreview)
async def invoice_remind(
    invoice_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).invoice_remind(invoice_id)


@router.get("/estimates/{estimate_id}/send", response_model=OutgoingPreview)
async def estimate_send(
    estimate_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).estimate_send(estimate_id)


@router.get("/orders/{order_id}/receipt", response_model=OutgoingPreview)
async def order_receipt(
    order_id: str,
    channel: Channel,
    to: Annotated[str, Query(min_length=3, max_length=200)],
    principal: CurrentPrincipal,
    db: DbSession,
) -> OutgoingPreview:
    return await PreviewService(db, principal).order_receipt(order_id, channel, to)


@router.get("/orders/{order_id}/ready", response_model=OutgoingPreview)
async def order_ready(order_id: str, principal: CurrentPrincipal, db: DbSession) -> OutgoingPreview:
    return await PreviewService(db, principal).order_ready(order_id)


@router.get("/bookings/{booking_id}/departed", response_model=OutgoingPreview)
async def booking_departed(
    booking_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).booking_departed(booking_id)


@router.get("/bookings/{booking_id}/rescheduled", response_model=OutgoingPreview)
async def booking_rescheduled(
    booking_id: str,
    starts_at: datetime,
    ends_at: datetime,
    principal: CurrentPrincipal,
    db: DbSession,
) -> OutgoingPreview:
    return await PreviewService(db, principal).booking_rescheduled(booking_id, starts_at, ends_at)


@router.get("/signatures/{signature_id}/resend", response_model=OutgoingPreview)
async def signature_resend(
    signature_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).signature_resend(signature_id)


@router.get("/forms/{form_id}/send", response_model=OutgoingPreview)
async def form_send(
    form_id: str, client_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).form_send(form_id, client_id)


@router.get("/contracts/{contract_id}/send", response_model=OutgoingPreview)
async def contract_send(
    contract_id: str, client_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).contract_send(contract_id, client_id)


@router.get("/reviews/request", response_model=OutgoingPreview)
async def review_request(
    client_id: str, principal: CurrentPrincipal, db: DbSession
) -> OutgoingPreview:
    return await PreviewService(db, principal).review_request(client_id)
