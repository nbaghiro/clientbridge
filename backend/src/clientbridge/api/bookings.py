from datetime import date, datetime
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
from clientbridge.schemas.bookings import (
    AddonAdd,
    AddonOffersOut,
    AddonOffersPatch,
    BookingCheck,
    BookingCreate,
    BookingMove,
    BookingOut,
    BookingPatch,
    ClassMessage,
    ClassMessageOut,
    CrewAdd,
    CrewOut,
    DepositOut,
    OnlineBookingOut,
    OnlineBookingPatch,
    RecurrenceCancel,
    RecurrenceCancelOut,
    RecurrenceChange,
    RecurrenceChangeOut,
    RecurrenceCreate,
    RecurrenceOut,
    ReminderPreview,
    RosterAction,
    RosterAdd,
    RosterEntry,
    TimeOffCreate,
    TimeOffOut,
    VisitNeeds,
    VisitPage,
)
from clientbridge.schemas.orders import VisitReceipt
from clientbridge.services.billing import BillingService
from clientbridge.services.bookings import (
    BookingService,
    ClassService,
    OnlineBookingService,
    RecurrenceService,
    TimeOffService,
    seat_scope,
    series_scope,
)
from clientbridge.services.deliveries import dispatch_scope

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
        await dispatch_scope(db, f"booking:{result.id}", email, sms, push)
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
    await dispatch_scope(db, f"booking:{result.id}", email, sms, push)
    if result.status in ("canceled", "no_show"):
        await dispatch_scope(db, seat_scope(result.slot_id), email, sms, push)
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


@router.get("/needs", response_model=list[VisitNeeds])
async def visit_needs_on(
    day: date, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> list[VisitNeeds]:
    return await BookingService(db, principal, gateway).needs_on(day)


@router.get("/{booking_id}/needs", response_model=VisitNeeds)
async def booking_needs(
    booking_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> VisitNeeds:
    return await BookingService(db, principal, gateway).needs(booking_id)


@router.get("/visits", response_model=VisitPage)
async def client_visits(
    client_id: str,
    before: datetime,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    before_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> VisitPage:
    return await BookingService(db, principal, gateway).visits(client_id, before, before_id, limit)


@router.get("/{booking_id}/receipt", response_model=VisitReceipt)
async def booking_receipt(
    booking_id: str, principal: CurrentPrincipal, db: DbSession
) -> VisitReceipt:
    return await BillingService(db, principal).visit_receipt(booking_id)


@router.get("/{booking_id}/reminder", response_model=ReminderPreview)
async def booking_reminder(
    booking_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> ReminderPreview:
    return await BookingService(db, principal, gateway).reminder(booking_id)


@router.post("/{booking_id}/check-in", response_model=BookingOut)
async def check_in_booking(
    booking_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> BookingOut:
    return await BookingService(db, principal, gateway).check_in(booking_id)


@router.delete("/{booking_id}/check-in", response_model=BookingOut)
async def undo_booking_check_in(
    booking_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> BookingOut:
    return await BookingService(db, principal, gateway).undo_check_in(booking_id)


@router.post("/{booking_id}/depart", response_model=BookingOut)
async def depart_for_booking(
    booking_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> BookingOut:
    return await BookingService(db, principal, gateway).depart(booking_id)


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


@router.post("/{booking_id}/addons", response_model=BookingOut, status_code=201)
async def add_booking_addon(
    booking_id: str,
    body: AddonAdd,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BookingOut:
    return await BookingService(db, principal, gateway).add_addon(booking_id, body, idempotency_key)


@router.delete("/{booking_id}/addons/{addon_id}", response_model=BookingOut)
async def remove_booking_addon(
    booking_id: str,
    addon_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> BookingOut:
    return await BookingService(db, principal, gateway).remove_addon(
        booking_id, addon_id, idempotency_key
    )


@router.get("/{booking_id}/crew", response_model=CrewOut)
async def booking_crew(
    booking_id: str, principal: CurrentPrincipal, db: DbSession, gateway: GatewayDep
) -> CrewOut:
    return await BookingService(db, principal, gateway).crew(booking_id)


@router.post("/{booking_id}/crew", response_model=CrewOut, status_code=201)
async def add_booking_crew(
    booking_id: str,
    body: CrewAdd,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> CrewOut:
    return await BookingService(db, principal, gateway).add_crew(booking_id, body, idempotency_key)


@router.delete("/{booking_id}/crew/{staff_id}", response_model=CrewOut)
async def remove_booking_crew(
    booking_id: str,
    staff_id: str,
    principal: CurrentPrincipal,
    db: DbSession,
    gateway: GatewayDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> CrewOut:
    return await BookingService(db, principal, gateway).remove_crew(
        booking_id, staff_id, idempotency_key
    )


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
    await dispatch_scope(db, series_scope(result.id), email, sms, push)
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
    await dispatch_scope(db, series_scope(result.id), email, sms, push)
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
    await dispatch_scope(db, series_scope(result.id), email, sms, push)
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
    email: EmailDep,
    sms: SmsDep,
    push: PushDep,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RosterEntry:
    result = await ClassService(db, principal, gateway).add(slot_id, body, idempotency_key)
    if body.notify:
        await dispatch_scope(db, f"booking:{result.booking_id}", email, sms, push)
    return result


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
    await dispatch_scope(db, seat_scope(slot_id), email, sms, push)
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


online_router = APIRouter(prefix="/online-booking", tags=["online-booking"])


@online_router.get("", response_model=OnlineBookingOut)
async def get_online_booking(principal: CurrentPrincipal, db: DbSession) -> OnlineBookingOut:
    return await OnlineBookingService(db, principal).get()


@online_router.patch("", response_model=OnlineBookingOut)
async def update_online_booking(
    body: OnlineBookingPatch, principal: CurrentPrincipal, db: DbSession
) -> OnlineBookingOut:
    return await OnlineBookingService(db, principal).update(body)


@online_router.patch("/addons", response_model=AddonOffersOut)
async def update_addon_offers(
    body: AddonOffersPatch, principal: CurrentPrincipal, db: DbSession
) -> AddonOffersOut:
    return await OnlineBookingService(db, principal).set_addons(body)
