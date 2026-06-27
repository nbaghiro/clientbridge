from typing import Annotated

from fastapi import APIRouter, Header

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.bookings import BookingCreate, BookingOut, BookingPatch
from clientbridge.services.booking_service import BookingService

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("", response_model=BookingOut, status_code=201)
async def create_booking(
    body: BookingCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BookingOut:
    return await BookingService(db, principal).create(body, idempotency_key)


@router.patch("/{booking_id}", response_model=BookingOut)
async def patch_booking(
    booking_id: str, body: BookingPatch, principal: CurrentPrincipal, db: DbSession
) -> BookingOut:
    return await BookingService(db, principal).patch(booking_id, body)
