from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession, EmailDep, PushDep, SmsDep
from clientbridge.schemas.bookings import BookingCreate, BookingOut, BookingPatch
from clientbridge.services.booking_service import BookingService
from clientbridge.services.notification_service import Notifier

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("", response_model=BookingOut, status_code=201)
async def create_booking(
    body: BookingCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BookingOut:
    result = await BookingService(db, principal).create(body, idempotency_key)
    await Notifier(email, sms, push).on_booking_confirmed(db, result.id)
    return result


@router.patch("/{booking_id}", response_model=BookingOut)
async def patch_booking(
    booking_id: str,
    body: BookingPatch,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> BookingOut:
    result = await BookingService(db, principal).patch(booking_id, body)
    if body.status == "canceled":
        await Notifier(email, sms, push).on_booking_canceled(db, result.id)
    return result
