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
from clientbridge.schemas.bookings import (
    BookingCheck,
    BookingCreate,
    BookingMove,
    BookingOut,
    BookingPatch,
    BookingProbe,
    ClassMessage,
    ClassMessageOut,
    DepositOut,
    RecurrenceCancel,
    RecurrenceCancelOut,
    RecurrenceChange,
    RecurrenceChangeOut,
    RecurrenceCreate,
    RecurrenceOut,
    RosterAction,
    RosterAdd,
    RosterEntry,
    TimeOffCreate,
    TimeOffOut,
)
from clientbridge.services.bookings import (
    BookingService,
    ClassService,
    RecurrenceService,
    TimeOffService,
)
from clientbridge.services.notifications import Notifier

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
    if body.notify:
        await Notifier(email, sms, push).on_booking_confirmed(db, result.id)
    return result


@router.post("/check", response_model=BookingCheck)
async def probe_booking(
    body: BookingProbe, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> BookingCheck:
    return await BookingService(db, principal, gateway).probe(body)


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


@router.post("/{booking_id}/check", response_model=BookingCheck)
async def check_booking_move(
    booking_id: str,
    body: BookingMove,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> BookingCheck:
    return await BookingService(db, principal, gateway).check(booking_id, body)


@router.post("/{booking_id}/check-in", response_model=BookingOut)
async def check_in_booking(
    booking_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> BookingOut:
    return await BookingService(db, principal, gateway).check_in(booking_id)


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


@router.delete("/{booking_id}/addons/{addon_id}", response_model=BookingOut)
async def remove_booking_addon(
    booking_id: str,
    addon_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> BookingOut:
    return await BookingService(db, principal, gateway).remove_addon(booking_id, addon_id)


recurrences_router = APIRouter(prefix="/recurrences", tags=["recurrences"])


@recurrences_router.post("", response_model=RecurrenceOut, status_code=201)
async def create_recurrence(
    body: RecurrenceCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RecurrenceOut:
    result = await RecurrenceService(db, principal).create(body, idempotency_key)
    booked = [o.booking_id for o in result.occurrences if o.booking_id is not None]
    notifier = Notifier(email, sms, push)
    if body.confirmation == "series":
        await notifier.on_series_booked(db, booked, "booked")
    elif body.confirmation == "each":
        for booking_id in booked:
            await notifier.on_booking_confirmed(db, booking_id)
    return result


@recurrences_router.patch("/{recurrence_id}", response_model=RecurrenceChangeOut)
async def change_recurrence(
    recurrence_id: str,
    body: RecurrenceChange,
    principal: CurrentPrincipal,
    db: DbSession,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> RecurrenceChangeOut:
    result = await RecurrenceService(db, principal).change(recurrence_id, body)
    if body.notify:
        await Notifier(email, sms, push).on_series_booked(db, result.moved, "moved")
    return result


@recurrences_router.post("/{recurrence_id}/cancel", response_model=RecurrenceCancelOut)
async def cancel_recurrence(
    recurrence_id: str,
    body: RecurrenceCancel,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> RecurrenceCancelOut:
    result = await RecurrenceService(db, principal).cancel(recurrence_id, body, gateway)
    if body.notify:
        await Notifier(email, sms, push).on_series_booked(db, result.canceled, "canceled")
    return result


time_off_router = APIRouter(prefix="/time-off", tags=["time-off"])


@time_off_router.post("", response_model=TimeOffOut, status_code=201)
async def create_time_off(
    body: TimeOffCreate,
    principal: CurrentPrincipal,
    db: DbSession,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> TimeOffOut:
    return await TimeOffService(db, principal).create(body, idempotency_key)


@time_off_router.delete("/{hours_id}", response_model=TimeOffOut)
async def delete_time_off(hours_id: str, principal: CurrentPrincipal, db: DbSession) -> TimeOffOut:
    return await TimeOffService(db, principal).delete(hours_id)


classes_router = APIRouter(prefix="/classes", tags=["classes"])


@classes_router.post("/{slot_id}/roster", response_model=RosterEntry, status_code=201)
async def add_to_class(
    slot_id: str,
    body: RosterAdd,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
) -> RosterEntry:
    return await ClassService(db, principal, gateway).add(slot_id, body)


@classes_router.patch("/{slot_id}/roster/{booking_id}", response_model=RosterEntry)
async def update_class_roster(
    slot_id: str,
    booking_id: str,
    body: RosterAction,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
) -> RosterEntry:
    result = await ClassService(db, principal, gateway).act(slot_id, booking_id, body)
    if body.action == "promote":
        await Notifier(email, sms, push).on_booking_confirmed(db, result.booking_id)
    return result


@classes_router.post("/{slot_id}/message", response_model=ClassMessageOut)
async def message_class(
    slot_id: str,
    body: ClassMessage,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    email: EmailDep,
    sms: SmsDep,
) -> ClassMessageOut:
    return await ClassService(db, principal, gateway).message(slot_id, body, sms, email)
