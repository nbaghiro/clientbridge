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
from clientbridge.schemas.bookings import BookingCreate, BookingOut, BookingPatch, DepositOut
from clientbridge.services.booking_service import BookingService
from clientbridge.services.notification_service import Notifier

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("", response_model=BookingOut, status_code=201)
async def create_booking(
    body: BookingCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BookingOut:
    result = await BookingService(db, principal, gateway).create(body, idempotency_key)
    await Notifier(email, sms, push).on_booking_confirmed(db, result.id)
    return result


@router.patch("/{booking_id}", response_model=BookingOut)
async def patch_booking(
    booking_id: str,
    body: BookingPatch,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> BookingOut:
    result = await BookingService(db, principal, gateway).patch(booking_id, body)
    notifier = Notifier(email, sms, push)
    if body.status == "canceled":
        await notifier.on_booking_canceled(db, result.id)
    elif body.starts_at is not None:
        await notifier.on_booking_rescheduled(db, result.id)
    return result


@router.post("/{booking_id}/deposit", response_model=DepositOut)
async def collect_deposit(
    booking_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    payment_method_id: str | None = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> DepositOut:
    return await BookingService(db, principal, gateway).collect_deposit(
        booking_id, payment_method_id, idempotency_key
    )
