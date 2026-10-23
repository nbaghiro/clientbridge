import calendar
import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Exists, func, literal, or_, select, text, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_can_act_as, assert_role, is_manager
from clientbridge.core.errors import (
    AppError,
    CardDeclined,
    Conflict,
    Forbidden,
    NotFound,
    PaymentActionRequired,
    Unprocessable,
)
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for, message
from clientbridge.core.scoping import scoped, scoped_update
from clientbridge.core.zones import zone
from clientbridge.integrations.resend import EmailSender
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.integrations.twilio import SmsSender
from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Channel, Client, Note, Subject
from clientbridge.models.documents import Contract, Form, FormResponse, Signature
from clientbridge.models.messaging import Message
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import (
    Addon,
    Booking,
    Hours,
    MonthlyBy,
    Recurrence,
    RecurrenceFrequency,
    Slot,
    Weekday,
)
from clientbridge.schemas.bookings import (
    AddonAdd,
    AddonOffer,
    AddonOffersOut,
    AddonOffersPatch,
    BookingCheck,
    BookingCreate,
    BookingMove,
    BookingOut,
    BookingPatch,
    BookingPolicy,
    ClassMessage,
    ClassMessageOut,
    CrewAdd,
    CrewMember,
    CrewOut,
    DepositOut,
    OnlineBookingOut,
    OnlineBookingPatch,
    OnlineService,
    OnlineStaff,
    Problem,
    RecurrenceCancel,
    RecurrenceCancelOut,
    RecurrenceChange,
    RecurrenceChangeOut,
    RecurrenceCreate,
    RecurrenceOccurrence,
    RecurrenceOut,
    ReminderPreview,
    RosterAction,
    RosterAdd,
    RosterEntry,
    TimeOffCreate,
    TimeOffOut,
    VisitNeed,
    VisitNeeds,
    VisitOut,
    VisitPage,
)
from clientbridge.services import ledger
from clientbridge.services.business import business_tz, load_staff, staff_name, staff_names
from clientbridge.services.catalog import assert_offers, deposit_cents, load_item
from clientbridge.services.clients import load_client
from clientbridge.services.lines import crew_ids, crew_note, fetch_lines
from clientbridge.services.messaging import dispatch_message, open_thread
from clientbridge.services.notifications import (
    Notifier,
    Outcome,
    business_brand,
    message_notice,
    queued_notifier,
    reminder_message,
)
from clientbridge.services.payments import (
    cancel_open_deposits,
    complete_when_done,
    default_method_ref,
    open_booking_deposit,
    refund_deposit,
    resolve_saved_method_ref,
)
from clientbridge.services.plans import serving
from clientbridge.services.subjects import visit_address

OVERLAP = "that staff member is already booked at that time"
CREW_BUSY = "someone on this visit's crew is busy then"
_OUTSIDE_HOURS = "outside the provider's available hours"
_CLASS_FULL = "that class is full"
_CLOSED = "the business is closed then"
_AWAY = "that staff member is away then"
_PAST = "that time has already passed"
_CLASS_MOVE = "a class session moves as a whole; change its time from the class"
_WAITLIST_SEAT = "give a waitlisted client a seat from the class roster"
_MIN_VISIT = timedelta(minutes=5)
ALREADY_IN_CLASS = "you already have a booking for this class"
_TERMINAL = frozenset({"completed", "canceled", "no_show"})
_AFTER_START = frozenset({"completed", "no_show"})
_NOT_STARTED = "a visit can be completed or marked a no-show only once it has started"
_ESTIMATE_BOOKED = "the estimate already has a booked visit; cancel it to book the estimate again"
_ESTIMATE_INVOICED = "the estimate was already invoiced, so its products are billed there"
_CLOSED_OR_WAITING = ("completed", "canceled", "no_show", "waitlisted")
_INVOICED = "this visit is already invoiced"
_CLASS_CREW = "a class session has no crew; add helpers to a one-to-one visit"
BookingNotice = Literal["confirmed", "canceled", "rescheduled"]


async def booking_out(db: AsyncSession, booking: Booking, slot: Slot) -> BookingOut:
    return BookingOut(
        id=booking.id,
        business_id=booking.business_id,
        slot_id=slot.id,
        client_id=booking.client_id,
        staff_id=booking.staff_id,
        item_id=slot.item_id,
        estimate_id=booking.estimate_id,
        status=booking.status,
        source=booking.source,
        price_cents=booking.price_cents,
        deposit_amount_cents=booking.deposit_amount_cents,
        deposit_status=booking.deposit_status,
        departed_at=booking.departed_at,
        checked_in_at=booking.checked_in_at,
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
    )


def booked_count_expr() -> ColumnElement[int]:
    """Seats taken on a slot: its live (not canceled, not deleted) bookings."""
    return (
        select(func.count(Booking.id))
        .where(
            Booking.slot_id == Slot.id,
            Booking.status.not_in(("canceled", "waitlisted")),
            Booking.deleted_at.is_(None),
        )
        .scalar_subquery()
    )


async def booked_count(db: AsyncSession, slot_id: str) -> int:
    count = await db.execute(select(booked_count_expr()).where(Slot.id == slot_id))
    return int(count.scalar_one())


def seats_closed_expr() -> ColumnElement[bool]:
    """A slot takes no new booking: every seat is taken, or someone is waiting for the next one."""
    waiting = (
        select(Booking.id)
        .where(
            Booking.slot_id == Slot.id,
            Booking.status == "waitlisted",
            Booking.deleted_at.is_(None),
        )
        .exists()
    )
    return or_(booked_count_expr() >= Slot.capacity, waiting)


async def seats_closed(db: AsyncSession, slot_id: str) -> bool:
    return bool(await db.scalar(select(seats_closed_expr()).where(Slot.id == slot_id)))


def seat_scope(slot_id: str, booking_id: str | None = None) -> str:
    """The delivery scope of the seat notices a class session sends, or of one of them."""
    return f"seat:{slot_id}" if booking_id is None else f"seat:{slot_id}:{booking_id}"


async def waitlist_position(db: AsyncSession, booking: Booking) -> int | None:
    """Where a waiting booking stands in line for the next seat; 1 is seated first."""
    if booking.status != "waitlisted":
        return None
    ahead = await db.scalar(
        scoped(Booking, booking.business_id, soft_delete=True)
        .with_only_columns(func.count(Booking.id))
        .where(
            Booking.slot_id == booking.slot_id,
            Booking.status == "waitlisted",
            tuple_(Booking.created_at, Booking.id)
            < tuple_(literal(booking.created_at), literal(booking.id)),
        )
    )
    return int(ahead or 0) + 1


def seat_booking(booking: Booking) -> None:
    """Give a class booking its seat: confirmed, with its manage link and any deposit due."""
    booking.status = "confirmed"
    booking.confirmed_at = clock.now()
    booking.manage_token = booking.manage_token or secrets.token_urlsafe(18)
    booking.deposit_status = "pending" if booking.deposit_amount_cents > 0 else "none"


async def fill_freed_seats(
    db: AsyncSession, slot: Slot, *, performed_by: str | None = None
) -> list[str]:
    """Seat the people waiting, earliest first, while a class that hasn't started has room."""
    if slot.capacity <= 1 or slot.status == "canceled" or slot.starts_at <= clock.now():
        return []
    await db.flush()
    # callers hold the member's lock; the slot row lock makes the count and the pick one step
    await db.execute(select(Slot.id).where(Slot.id == slot.id).with_for_update())
    seated: list[str] = []
    while await booked_count(db, slot.id) < slot.capacity:
        first = await db.scalar(
            scoped(Booking, slot.business_id, soft_delete=True)
            .where(Booking.slot_id == slot.id, Booking.status == "waitlisted")
            .order_by(Booking.created_at, Booking.id)
            .limit(1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if first is None:
            break
        seat_booking(first)
        db.add(
            Audit(
                id=new_id("audit"),
                business_id=slot.business_id,
                performed_by=performed_by,
                action="class.seat_opened",
                entity_type="booking",
                entity_id=first.id,
                changes={},
            )
        )
        await db.flush()
        await queued_notifier(db, seat_scope(slot.id, first.id), slot.business_id).on_seat_opened(
            db, first.id
        )
        seated.append(first.id)
    return seated


async def conflicting_slot(
    db: AsyncSession,
    business_id: str,
    item: Item,
    staff_id: str,
    starts_at: datetime,
    ends_at: datetime,
    exclude: str | None = None,
) -> bool:
    """Whether a live slot for this staff overlaps the window, buffers included."""
    new_start = starts_at - timedelta(minutes=item.buffer_before_min)
    new_end = ends_at + timedelta(minutes=item.buffer_after_min)
    q = (
        scoped(Slot, business_id)
        .join(Item, Item.id == Slot.item_id)
        .where(
            Slot.staff_id == staff_id,
            Slot.status != "canceled",
            Slot.starts_at - func.make_interval(0, 0, 0, 0, 0, Item.buffer_before_min) < new_end,
            Slot.ends_at + func.make_interval(0, 0, 0, 0, 0, Item.buffer_after_min) > new_start,
            or_(
                seats_closed_expr(),
                Slot.item_id != item.id,
                Slot.starts_at != starts_at,
                Slot.ends_at != ends_at,
            ),
        )
    )
    if exclude is not None:
        q = q.where(Slot.id != exclude)
    return (await db.execute(q.limit(1))).first() is not None


async def assert_free(
    db: AsyncSession,
    business_id: str,
    item: Item,
    staff_id: str,
    starts_at: datetime,
    ends_at: datetime,
    exclude: str | None = None,
) -> None:
    if await conflicting_slot(db, business_id, item, staff_id, starts_at, ends_at, exclude):
        raise Conflict(OVERLAP)


async def open_class_slot(
    db: AsyncSession, business_id: str, item_id: str, staff_id: str, starts_at: datetime
) -> Slot | None:
    q = scoped(Slot, business_id).where(
        Slot.item_id == item_id,
        Slot.staff_id == staff_id,
        Slot.starts_at == starts_at,
        Slot.status != "canceled",
    )
    return (await db.execute(q)).scalars().first()


async def client_has_seat(db: AsyncSession, business_id: str, slot_id: str, client_id: str) -> bool:
    """Whether this client already has a live booking on the slot."""
    q = (
        scoped(Booking, business_id, soft_delete=True)
        .where(
            Booking.slot_id == slot_id,
            Booking.client_id == client_id,
            Booking.status != "canceled",
        )
        .limit(1)
    )
    return (await db.execute(q)).first() is not None


async def blocking_exception(
    db: AsyncSession,
    business_id: str,
    staff_id: str,
    start: datetime,
    end: datetime,
    skip: str | None = None,
) -> Hours | None:
    """A closure or this member's time off overlapping the window; closures come first."""
    q = (
        scoped(Hours, business_id)
        .where(
            Hours.basis == "exception",
            or_(Hours.staff_id.is_(None), Hours.staff_id == staff_id),
            Hours.starts_at < end,
            Hours.ends_at > start,
        )
        .order_by(Hours.staff_id.is_(None).desc(), Hours.starts_at)
        .limit(1)
    )
    if skip is not None:
        q = q.where(Hours.id != skip)
    return (await db.execute(q)).scalars().first()


def _verdict(problem: Problem, message: str, reason: str | None = None) -> BookingCheck:
    return BookingCheck(ok=False, problem=problem, reason=reason, message=message)


def _code(problem: BookingCheck) -> str | None:
    return "crew_busy" if problem.problem == "crew" else None


async def slot_problem(
    db: AsyncSession,
    business_id: str,
    item: Item,
    staff_id: str,
    starts_at: datetime,
    ends_at: datetime,
    *,
    exclude: str | None = None,
    skip_hours: str | None = None,
) -> BookingCheck | None:
    """Why a visit can't take this window, most fundamental reason first; None when it can."""
    away = await blocking_exception(db, business_id, staff_id, starts_at, ends_at, skip_hours)
    if away is not None:
        if away.staff_id is None:
            return _verdict("closed", _CLOSED, away.reason)
        return _verdict("time_off", _AWAY, away.reason)
    if not await is_within_hours(db, staff_id, business_id, starts_at, ends_at):
        return _verdict("off_hours", _OUTSIDE_HOURS)
    if await conflicting_slot(db, business_id, item, staff_id, starts_at, ends_at, exclude):
        return _verdict("overlap", OVERLAP)
    return None


def is_class(item: Item) -> bool:
    return item.kind == "class" and item.capacity is not None and item.capacity > 1


def addon_minutes(products: Sequence[tuple[Item, int]]) -> int:
    """The minutes a visit's add-ons add to it: each product's duration times its quantity."""
    return sum((product.duration_min or 0) * quantity for product, quantity in products)


def visit_minutes(item: Item, extra_min: int = 0) -> int:
    """A visit's length with its add-ons; a class session keeps the class's own length."""
    return (item.duration_min or 0) + (0 if is_class(item) else extra_min)


async def crew_rows(db: AsyncSession, business_id: str, booking_id: str) -> list[Hours]:
    """The helpers' blocks on a visit, oldest first."""
    rows = await db.scalars(
        scoped(Hours, business_id)
        .where(Hours.basis == "exception", Hours.note == crew_note(booking_id))
        .order_by(Hours.created_at, Hours.id)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def crew_problem(
    db: AsyncSession,
    business_id: str,
    item: Item,
    crew: Sequence[Hours],
    starts_at: datetime,
    ends_at: datetime,
) -> BookingCheck | None:
    """Why a helper can't follow the visit to this window; their own block for it doesn't count."""
    for row in crew:
        if row.staff_id is None:
            continue
        found = await slot_problem(
            db, business_id, item, row.staff_id, starts_at, ends_at, skip_hours=row.id
        )
        if found is not None:
            return _verdict("crew", CREW_BUSY, found.reason)
    return None


async def carry_crew(db: AsyncSession, business_id: str, booking: Booking, slot: Slot) -> None:
    """Keep the helpers' blocks on the visit's window, and drop them once it is canceled."""
    for row in await crew_rows(db, business_id, booking.id):
        if booking.status == "canceled" or booking.deleted_at is not None:
            await db.delete(row)
        else:
            row.starts_at, row.ends_at = slot.starts_at, slot.ends_at
    await db.flush()


async def create_booking_core(
    db: AsyncSession,
    business_id: str,
    *,
    item: Item,
    staff_id: str,
    starts_at: datetime,
    client_id: str,
    source: str,
    subject_id: str | None = None,
    recurrence_id: str | None = None,
    dedupe_client: bool = False,
    extra_min: int = 0,
) -> tuple[Booking, Slot]:
    """Create a confirmed booking under the scheduling invariant (staff and online paths)."""
    assert_offers(item, staff_id)
    await lock_staff(db, business_id, staff_id)
    ends_at = starts_at + timedelta(minutes=visit_minutes(item, extra_min))
    away = await blocking_exception(db, business_id, staff_id, starts_at, ends_at)
    if away is not None:
        raise Conflict(_CLOSED if away.staff_id is None else _AWAY)
    if not await is_within_hours(db, staff_id, business_id, starts_at, ends_at):
        raise Conflict(_OUTSIDE_HOURS)
    session = is_class(item)
    slot = None
    if session:
        slot = await open_class_slot(db, business_id, item.id, staff_id, starts_at)
        if slot is not None:
            if dedupe_client and await client_has_seat(db, business_id, slot.id, client_id):
                raise Conflict(ALREADY_IN_CLASS)
            if await seats_closed(db, slot.id):
                raise Conflict(_CLASS_FULL, code="class_full")
    if slot is None:
        await assert_free(db, business_id, item, staff_id, starts_at, ends_at)
        slot = Slot(
            id=new_id("slot"),
            business_id=business_id,
            item_id=item.id,
            staff_id=staff_id,
            recurrence_id=recurrence_id,
            starts_at=starts_at,
            ends_at=ends_at,
            capacity=item.capacity if session and item.capacity is not None else 1,
            status="scheduled",
        )
        db.add(slot)
        try:
            # the exclusion constraint backstops a concurrent overlapping insert
            await db.flush()
        except IntegrityError as exc:
            raise Conflict(OVERLAP) from exc
    deposit = deposit_cents(item) if item.deposit_type != "none" else 0
    booking = Booking(
        id=new_id("booking"),
        business_id=business_id,
        slot_id=slot.id,
        starts_at=slot.starts_at,
        staff_id=staff_id,
        client_id=client_id,
        subject_id=subject_id,
        status="confirmed",
        source=source,
        price_cents=item.price_cents,
        deposit_amount_cents=deposit_cents(item),
        deposit_status="pending" if deposit > 0 else "none",
        confirmed_at=clock.now(),
        manage_token=secrets.token_urlsafe(18),
    )
    db.add(booking)
    await db.flush()
    return booking, slot


async def move_slot(
    db: AsyncSession, business_id: str, slot: Slot, starts_at: datetime, ends_at: datetime
) -> None:
    moved = starts_at != slot.starts_at
    slot.starts_at, slot.ends_at = starts_at, ends_at
    if moved:
        await db.execute(
            scoped_update(Booking, business_id)
            .where(Booking.slot_id == slot.id)
            .values(starts_at=starts_at, reminded_at=None)
        )


async def lock_staff(db: AsyncSession, business_id: str, *staff_ids: str) -> None:
    """Serialise booking writes per member so the conflict check is atomic with the write."""
    # Lock order: hours lock, members by id, bookings by id, then slots, so writers never deadlock.
    for staff_id in sorted(set(staff_ids)):
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"{business_id}:{staff_id}"},
        )


async def lock_bookings(
    db: AsyncSession, business_id: str, booking_ids: list[str]
) -> list[Booking]:
    """The live rows of these bookings, locked in id order and reloaded."""
    rows = await db.scalars(
        scoped(Booking, business_id, soft_delete=True)
        .where(Booking.id.in_(booking_ids))
        .order_by(Booking.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def assert_subject(
    db: AsyncSession, business_id: str, subject_id: str, client_id: str
) -> None:
    found = await db.scalar(
        scoped(Subject, business_id, soft_delete=True)
        .with_only_columns(Subject.id)
        .where(Subject.id == subject_id, Subject.client_id == client_id)
    )
    if found is None:
        raise NotFound("subject not found")


async def release_slot(db: AsyncSession, slot: Slot) -> None:
    """Cancel the slot once its last live or waiting booking is gone."""
    await db.flush()
    left = await db.execute(
        select(func.count(Booking.id)).where(
            Booking.slot_id == slot.id,
            Booking.status != "canceled",
            Booking.deleted_at.is_(None),
        )
    )
    if int(left.scalar_one()) == 0:
        slot.status = "canceled"
    await db.flush()


def _assert_started(starts_at: datetime) -> None:
    if starts_at > clock.now():
        raise Conflict(_NOT_STARTED, code="visit_not_started")


async def settle_deposit(db: AsyncSession, gateway: PaymentGateway, booking_id: str) -> str | None:
    """Collect a settled deposit and apply it to the open invoice, or forfeit it after a no-show."""
    booking = await db.get(Booking, booking_id)
    if booking is None:
        return None
    if booking.status == "canceled":
        booking.deposit_status = "collected"
        await refund_deposit(db, gateway, booking)
        return None
    if booking.status == "no_show":
        await ledger.post_forfeit(db, booking)
        booking.deposit_status = "forfeited"
        await db.flush()
        return None
    booking.deposit_status = "collected"
    invoice = await _open_invoice(db, booking)
    if invoice is not None and await apply_deposit(db, booking, invoice):
        return invoice.id
    await db.flush()
    return None


async def apply_deposit(db: AsyncSession, booking: Booking, invoice: Invoice) -> bool:
    if booking.deposit_status != "collected":
        return False
    if await ledger.post_application(db, booking, invoice) <= 0:
        return False
    if await ledger.deposit_held(db, booking) <= 0:
        booking.deposit_status = "applied"
    await db.flush()
    return True


async def unapply_deposit(db: AsyncSession, booking: Booking, invoice_id: str) -> None:
    await ledger.reverse_application(db, booking, invoice_id)
    if booking.deposit_status == "applied":
        booking.deposit_status = "collected"
    await db.flush()


async def reverse_deposit(db: AsyncSession, booking_id: str) -> list[str]:
    """Undo a deposit being refunded; returns the invoices it no longer pays."""
    booking = await db.get(Booking, booking_id)
    if booking is None:
        return []
    await ledger.reverse_forfeit(db, booking)
    invoices = await ledger.applied_invoices(db, booking)
    for invoice_id in invoices:
        await unapply_deposit(db, booking, invoice_id)
    return invoices


async def deposit_refunded(db: AsyncSession, booking_id: str) -> None:
    booking = await db.get(Booking, booking_id)
    if booking is not None:
        held = await ledger.deposit_held(db, booking)
        booking.deposit_status = "collected" if held > 0 else "refunded"
        await db.flush()


async def _open_invoice(db: AsyncSession, booking: Booking) -> Invoice | None:
    rows = await db.execute(
        scoped(Invoice, booking.business_id)
        .join(Line, Line.invoice_id == Invoice.id)
        .where(Line.booking_id == booking.id, ledger.invoice_status_expr().in_(("sent", "partial")))
        .order_by(Invoice.issued_at.desc())
        .limit(1)
    )
    return rows.scalars().first()


async def hold_estimate(
    db: AsyncSession, business_id: str, estimate_id: str
) -> tuple[str | None, str | None]:
    """Lock the estimate, then read its invoice and its live booked visit, so the two can't race."""
    invoiced = await db.scalar(
        scoped(Estimate, business_id)
        .with_only_columns(Estimate.converted_invoice_id)
        .where(Estimate.id == estimate_id)
        .with_for_update()
    )
    live = await db.scalar(
        scoped(Booking, business_id, soft_delete=True)
        .with_only_columns(Booking.id)
        .where(Booking.estimate_id == estimate_id, Booking.status != "canceled")
        .limit(1)
    )
    return invoiced, live


class BookingService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def create(self, data: BookingCreate, idempotency_key: str | None) -> BookingOut:
        self._assert_can_act_as(data.staff_id)
        item = await self._item(data.item_id)
        if item.duration_min is None or item.duration_min <= 0:
            raise AppError("that service has no duration and can't be booked", status_code=422)
        await self._client(data.client_id)
        await self._staff(data.staff_id)
        if data.subject_id is not None:
            await assert_subject(self.db, self.biz, data.subject_id, data.client_id)
        quoted = (
            await self._estimate_addons(data.estimate_id, data.client_id)
            if data.estimate_id is not None
            else []
        )

        async def run(cmd: Command) -> BookingOut:
            if data.estimate_id is not None:
                await self._assert_estimate_unbooked(data.estimate_id)
            booking, slot = await create_booking_core(
                self.db,
                self.biz,
                item=item,
                staff_id=data.staff_id,
                starts_at=data.starts_at,
                client_id=data.client_id,
                source="manual",
                subject_id=data.subject_id,
                extra_min=addon_minutes([(product, qty) for _, product, qty in quoted]),
            )
            booking.estimate_id = data.estimate_id
            if data.note is not None and data.note.strip() != "":
                self.db.add(
                    Note(
                        id=new_id("note"),
                        business_id=self.biz,
                        created_by=self.principal.user_id,
                        parent_type="booking",
                        parent_id=booking.id,
                        body=data.note.strip(),
                    )
                )
                await self.db.flush()
            for line, product, quantity in quoted:
                self.db.add(
                    Addon(
                        id=new_id("addon"),
                        business_id=self.biz,
                        booking_id=booking.id,
                        staff_id=booking.staff_id,
                        item_id=product.id,
                        description=line.description,
                        quantity=quantity,
                        unit_amount_cents=line.unit_amount_cents,
                    )
                )
            await self.db.flush()
            cmd.record("booking.create", entity_type="booking", entity_id=booking.id)
            if data.notify:
                await queued_notifier(
                    self.db, f"booking:{booking.id}", self.biz
                ).on_booking_confirmed(self.db, booking.id)
            return await booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.create",
            run=run,
            response_model=BookingOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def patch(
        self, booking_id: str, data: BookingPatch
    ) -> tuple[BookingOut, BookingNotice | None]:
        """Apply the change; also names the notice the client is owed for it, if any."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)
        moving = self._moves(data, slot)
        before, starts_before = booking.status, slot.starts_at

        # A terminal booking is frozen — only an idempotent re-set of the same status is allowed.
        if booking.status in _TERMINAL and (
            moving or (data.status is not None and data.status != booking.status)
        ):
            raise Conflict(f"a {booking.status} booking can't be modified")
        if booking.status == "waitlisted" and data.status not in (None, "canceled"):
            raise Conflict(_WAITLIST_SEAT, code="class_seat")
        target = await self._target(data, slot) if moving else None
        starts_at = target[1] if target is not None else slot.starts_at
        if data.status in _AFTER_START and data.status != before:
            _assert_started(starts_at)

        async def run(cmd: Command) -> BookingOut:
            if target is None and data.status is not None and data.status != booking.status:
                await lock_staff(self.db, self.biz, slot.staff_id)
                await lock_bookings(self.db, self.biz, [booking.id])
                if booking.status in _TERMINAL and data.status != booking.status:
                    raise Conflict(f"a {booking.status} booking can't be modified")
            if target is not None:
                staff_id, starts_at, ends_at = target
                crew = await crew_ids(self.db, self.biz, booking.id)
                await lock_staff(self.db, self.biz, slot.staff_id, staff_id, *crew)
                await lock_bookings(self.db, self.biz, [booking.id])
                await self.db.refresh(slot)
                if booking.status in _TERMINAL:
                    raise Conflict(f"a {booking.status} booking can't be modified")
                item = await self._item(slot.item_id, require_active=False)
                problem = await slot_problem(
                    self.db,
                    self.biz,
                    item,
                    staff_id,
                    starts_at,
                    ends_at,
                    exclude=slot.id,
                ) or await crew_problem(
                    self.db,
                    self.biz,
                    item,
                    await crew_rows(self.db, self.biz, booking.id),
                    starts_at,
                    ends_at,
                )
                if problem is not None:
                    raise Conflict(problem.message or OVERLAP, code=_code(problem))
                await move_slot(self.db, self.biz, slot, starts_at, ends_at)
                slot.staff_id = staff_id
                if booking.staff_id != staff_id:
                    booking.staff_id = staff_id
                    await self.db.execute(
                        scoped_update(Addon, self.biz)
                        .where(Addon.booking_id == booking.id)
                        .values(staff_id=staff_id)
                    )
                try:
                    await self.db.flush()
                except IntegrityError as exc:
                    raise Conflict(OVERLAP) from exc
                await carry_crew(self.db, self.biz, booking, slot)
                cmd.record("booking.reschedule", entity_type="booking", entity_id=booking.id)
            if data.status is not None and data.status != booking.status:
                held_seat = booking.status in ("pending", "confirmed")
                booking.status = data.status
                if data.status == "confirmed":
                    booking.confirmed_at = booking.confirmed_at or clock.now()
                if data.status == "canceled" and booking.deposit_status == "pending":
                    await cancel_open_deposits(self.db, self.gateway, booking)
                if data.status in ("canceled", "completed") and booking.deposit_status == "pending":
                    booking.deposit_status = "none"  # nothing was collected and none is due now
                if data.status == "canceled":
                    booking.canceled_at = clock.now()
                    await release_slot(self.db, slot)  # a class keeps its slot for the rest
                    await carry_crew(self.db, self.biz, booking, slot)
                elif data.status == "completed":
                    booking.completed_at = clock.now()
                    await complete_when_done(self.db, slot)
                elif data.status == "no_show":
                    await self.forfeit_deposit(cmd, booking)
                cmd.record(f"booking.{data.status}", entity_type="booking", entity_id=booking.id)
                if held_seat and data.status in ("canceled", "no_show"):
                    await fill_freed_seats(self.db, slot, performed_by=self.principal.user_id)
            await self.db.flush()
            return await booking_out(self.db, booking, slot)

        out = await run_command(
            self.db,
            self.principal,
            action="booking.patch",
            run=run,
            response_model=BookingOut,
        )
        notice: BookingNotice | None = None
        if out.status != before and out.status == "canceled":
            notice = "canceled"
        elif out.status != before and (before, out.status) == ("pending", "confirmed"):
            notice = "confirmed"
        elif out.starts_at != starts_before and out.status in ("pending", "confirmed"):
            notice = "rescheduled"
        return out, notice

    async def check(self, booking_id: str, data: BookingMove) -> BookingCheck:
        """What the server would say to this move or resize, without making it."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)
        if booking.status in _TERMINAL:
            raise Conflict(f"a {booking.status} booking can't be modified")
        if not self._moves(data, slot):
            return BookingCheck(ok=True)
        try:
            staff_id, starts_at, ends_at = await self._target(data, slot)
        except Conflict as exc:
            return _verdict("class" if exc.message == _CLASS_MOVE else "past", exc.message)
        except Unprocessable as exc:
            if exc.code != "service_not_offered":
                raise
            return _verdict("not_offered", exc.message)
        item = await self._item(slot.item_id, require_active=False)
        problem = await slot_problem(
            self.db,
            self.biz,
            item,
            staff_id,
            starts_at,
            ends_at,
            exclude=slot.id,
        ) or await crew_problem(
            self.db,
            self.biz,
            item,
            await crew_rows(self.db, self.biz, booking.id),
            starts_at,
            ends_at,
        )
        return problem or BookingCheck(ok=True)

    def _moves(self, data: BookingMove, slot: Slot) -> bool:
        return (
            data.starts_at is not None
            or data.ends_at is not None
            or (data.staff_id is not None and data.staff_id != slot.staff_id)
        )

    async def _target(self, data: BookingMove, slot: Slot) -> tuple[str, datetime, datetime]:
        """The member and window a move lands on, validated before any check runs."""
        staff_id = data.staff_id or slot.staff_id
        if staff_id != slot.staff_id:
            self._assert_can_act_as(staff_id)
            await self._staff(staff_id)
            if slot.capacity > 1:
                raise Conflict(_CLASS_MOVE, code="class_move")
            assert_offers(await self._item(slot.item_id, require_active=False), staff_id)
        starts_at = data.starts_at or slot.starts_at
        ends_at = data.ends_at or starts_at + (slot.ends_at - slot.starts_at)
        if slot.capacity > 1 and (starts_at, ends_at) != (slot.starts_at, slot.ends_at):
            raise Conflict(_CLASS_MOVE, code="class_move")
        if ends_at - starts_at < _MIN_VISIT:
            raise Unprocessable("a visit must end at least five minutes after it starts")
        if starts_at != slot.starts_at and starts_at < clock.now():
            raise Conflict(_PAST)
        return staff_id, starts_at, ends_at

    async def visits(
        self, client_id: str, before: datetime, before_id: str | None, limit: int
    ) -> VisitPage:
        """A client's older visits, newest first: the history the device no longer keeps."""
        await self._client(client_id)
        stmt = (
            scoped(Booking, self.biz, soft_delete=True)
            .add_columns(Slot.starts_at, Slot.ends_at, Item.name, Item.color, staff_name())
            .join(Slot, Slot.id == Booking.slot_id)
            .join(Item, Item.id == Slot.item_id)
            .outerjoin(Staff, Staff.id == Booking.staff_id)
            .where(
                Booking.client_id == client_id,
                Slot.starts_at < before
                if before_id is None
                else tuple_(Slot.starts_at, Booking.id)
                < tuple_(literal(before), literal(before_id)),
            )
            .order_by(Slot.starts_at.desc(), Booking.id.desc())
            .limit(limit + 1)
        )
        done = (
            scoped(Booking, self.biz, soft_delete=True)
            .with_only_columns(func.count(Booking.id), func.max(Slot.starts_at))
            .join(Slot, Slot.id == Booking.slot_id)
            .where(
                Booking.client_id == client_id,
                Booking.status == "completed",
                Slot.starts_at < before,
            )
        )
        if not is_manager(self.principal.role):
            stmt = stmt.where(Booking.staff_id == self.principal.staff_id)
            done = done.where(Booking.staff_id == self.principal.staff_id)
        rows = (await self.db.execute(stmt)).all()
        completed, last_completed_at = (await self.db.execute(done)).one()
        return VisitPage(
            visits=[
                VisitOut(
                    id=booking.id,
                    status=booking.status,
                    subject_id=booking.subject_id,
                    staff_id=booking.staff_id,
                    deposit_amount_cents=booking.deposit_amount_cents,
                    deposit_status=booking.deposit_status,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    item_name=item_name,
                    item_color=item_color,
                    staff_name=staff_name,
                )
                for booking, starts_at, ends_at, item_name, item_color, staff_name in rows[:limit]
            ],
            more=len(rows) > limit,
            completed=completed,
            last_completed_at=last_completed_at,
        )

    async def reminder(self, booking_id: str) -> ReminderPreview:
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)
        message = await reminder_message(self.db, booking)
        if message is None:
            raise NotFound("booking not found")
        return ReminderPreview(
            subject=message.subject,
            body=message.body,
            sends_at=slot.starts_at - _REMINDER_WINDOW,
            sent_at=booking.reminded_at,
        )

    async def check_in(self, booking_id: str) -> BookingOut:
        """Record that the client has arrived; checking in again keeps the first arrival time."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        if booking.status in _TERMINAL:
            raise Conflict(f"a {booking.status} booking can't be checked in")
        slot = await self._slot(booking.slot_id)
        [owed] = await visit_needs(self.db, self.biz, [booking])

        async def run(cmd: Command) -> BookingOut:
            if booking.checked_in_at is None:
                booking.checked_in_at = clock.now()
                await self.db.flush()
                cmd.record(
                    "booking.check_in",
                    entity_type="booking",
                    entity_id=booking.id,
                    changes={
                        "outstanding": [
                            n.model_dump(include={"kind", "ref_id"}) for n in owed.needs
                        ]
                    }
                    if owed.needs
                    else None,
                )
            return await booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.check_in",
            run=run,
            response_model=BookingOut,
        )

    async def undo_check_in(self, booking_id: str) -> BookingOut:
        """Take back a check-in made by mistake, while the visit is still open and unpaid."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)

        async def run(cmd: Command) -> BookingOut:
            if booking.status in _TERMINAL:
                raise Conflict(f"a {booking.status} visit's check-in can't be undone")
            if booking.checked_in_at is None:
                raise Conflict("this visit isn't checked in")
            if booking.charged_at is not None:
                raise Conflict("a paid visit's check-in can't be undone")
            booking.checked_in_at = None
            await self.db.flush()
            cmd.record("booking.check_in_undo", entity_type="booking", entity_id=booking.id)
            return await booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.check_in_undo",
            run=run,
            response_model=BookingOut,
        )

    async def _estimate_addons(
        self, estimate_id: str, client_id: str
    ) -> list[tuple[Line, Item, int]]:
        """An accepted estimate's chosen product lines, in whole units, to book as add-ons."""
        assert_role(
            self.principal,
            "owner",
            "admin",
            message="only an owner or admin can book from an estimate",
        )
        estimate = (
            await self.db.execute(scoped(Estimate, self.biz).where(Estimate.id == estimate_id))
        ).scalar_one_or_none()
        if estimate is None:
            raise NotFound("estimate not found")
        if estimate.client_id != client_id:
            raise Unprocessable("the estimate is for another client", code="invalid_request")
        if estimate.status != "accepted":
            raise Conflict("only an accepted estimate can be booked")
        if estimate.converted_invoice_id is not None:
            raise Conflict(_ESTIMATE_INVOICED)
        lines = [
            ln
            for ln in await fetch_lines(self.db, self.biz, "estimate", estimate.id)
            if ln.item_id is not None and (ln.selected or not ln.optional)
        ]
        items = (
            (
                await self.db.execute(
                    scoped(Item, self.biz).where(
                        Item.id.in_([ln.item_id for ln in lines]), Item.kind == "product"
                    )
                )
            )
            .scalars()
            .all()
        )
        products = {i.id: i for i in items}
        return [
            (ln, products[ln.item_id], int(ln.quantity))
            for ln in lines
            if ln.item_id in products and ln.quantity > 0 and ln.quantity == int(ln.quantity)
        ]

    async def _assert_estimate_unbooked(self, estimate_id: str) -> None:
        invoiced, live = await hold_estimate(self.db, self.biz, estimate_id)
        if invoiced is not None:
            raise Conflict(_ESTIMATE_INVOICED)
        if live is not None:
            raise Conflict(_ESTIMATE_BOOKED, code="estimate_booked")

    async def depart(self, booking_id: str) -> BookingOut:
        """Record that the member set off and text the client; setting off again sends nothing."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        if booking.status in _TERMINAL:
            raise Conflict(f"a {booking.status} booking can't be started")
        slot = await self._slot(booking.slot_id)

        async def run(cmd: Command) -> BookingOut:
            if booking.departed_at is None:
                booking.departed_at = clock.now()
                await self.db.flush()
                cmd.record("booking.depart", entity_type="booking", entity_id=booking.id)
                await queued_notifier(
                    self.db, f"booking:{booking.id}:depart", self.biz
                ).on_booking_departed(self.db, booking.id)
            return await booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.depart",
            run=run,
            response_model=BookingOut,
        )

    async def collect_deposit(
        self, booking_id: str, payment_method_id: str | None, idempotency_key: str | None
    ) -> DepositOut:
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        if booking.deposit_amount_cents <= 0:
            raise Conflict("no deposit due")
        business = await self._business()
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("set up card payments in Setup before taking payments")
        account_id = business.stripe_account_id
        client = await self._client(booking.client_id)
        amount = booking.deposit_amount_cents
        pm_ref = await resolve_saved_method_ref(
            self.db, self.biz, payment_method_id, booking.client_id
        )

        async def run(cmd: Command) -> DepositOut:
            await self._assert_no_open_deposit(booking.id)
            payment, client_secret = await open_booking_deposit(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                booking=booking,
                client=client,
                amount=amount,
                payment_method=pm_ref,
                idempotency_key=idempotency_key,
            )
            cmd.record("booking.deposit", entity_type="booking", entity_id=booking.id)
            return DepositOut(
                booking_id=booking.id, payment_id=payment.id, client_secret=client_secret
            )

        return await run_command(
            self.db,
            self.principal,
            action="booking.deposit",
            run=run,
            response_model=DepositOut,
            idempotency_key=idempotency_key,
            request={"booking_id": booking_id, "payment_method_id": payment_method_id},
        )

    async def forfeit_deposit(self, cmd: Command, booking: Booking) -> None:
        """Keep a collected deposit, or charge the default card for one; never charges twice."""
        if booking.deposit_status in ("none", "applied", "forfeited", "refunded"):
            return
        if booking.deposit_status == "collected":
            await ledger.post_forfeit(self.db, booking)
            booking.deposit_status = "forfeited"
            await self.db.flush()
            cmd.record("booking.deposit_forfeited", entity_type="booking", entity_id=booking.id)
            return
        if booking.deposit_amount_cents <= 0 or await self._has_open_deposit(booking.id):
            return
        business = await self._business()
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            return
        pm_ref = await default_method_ref(self.db, self.biz, booking.client_id)
        if pm_ref is None:
            return
        client = await self._client(booking.client_id)
        try:
            await open_booking_deposit(
                self.db,
                self.gateway,
                account_id=business.stripe_account_id,
                business_id=self.biz,
                booking=booking,
                client=client,
                amount=booking.deposit_amount_cents,
                payment_method=pm_ref,
                idempotency_key="no_show",
            )
        except (CardDeclined, PaymentActionRequired):
            return  # the no-show still stands; the deposit stays pending to collect by hand
        cmd.record("booking.deposit_forfeited", entity_type="booking", entity_id=booking.id)

    async def _assert_no_open_deposit(self, booking_id: str) -> None:
        if await self._has_open_deposit(booking_id):
            raise Conflict("deposit already collected or pending")

    async def _has_open_deposit(self, booking_id: str) -> bool:
        row = (
            await self.db.execute(
                scoped(Payment, self.biz)
                .with_only_columns(Payment.id)
                .where(
                    Payment.booking_id == booking_id,
                    Payment.kind == "deposit",
                    Payment.status.notin_(("failed", "canceled")),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return row is not None

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
        return row

    async def add_addon(
        self, booking_id: str, data: AddonAdd, idempotency_key: str | None
    ) -> BookingOut:
        """Add a product to a visit before it is invoiced; its minutes lengthen the visit."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        self._assert_open_for_addons(booking)
        product = await self._item(data.item_id)
        if product.kind != "product":
            raise NotFound("product not found")
        if product.track_stock and (product.stock_on_hand or 0) < data.quantity:
            raise Conflict(f"only {max(product.stock_on_hand or 0, 0)} left of {product.name}")
        slot = await self._slot(booking.slot_id)

        async def run(cmd: Command) -> BookingOut:
            await self._lengthen(booking, slot, (product.duration_min or 0) * data.quantity)
            self.db.add(
                Addon(
                    id=new_id("addon"),
                    business_id=self.biz,
                    booking_id=booking.id,
                    staff_id=booking.staff_id,
                    item_id=product.id,
                    description=product.name,
                    quantity=data.quantity,
                    unit_amount_cents=product.price_cents,
                )
            )
            await self.db.flush()
            cmd.record("booking.addon_add", entity_type="booking", entity_id=booking.id)
            return await booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.addon_add",
            run=run,
            response_model=BookingOut,
            idempotency_key=idempotency_key,
            request={"booking_id": booking_id, **data.model_dump(mode="json")},
        )

    async def remove_addon(self, booking_id: str, addon_id: str) -> BookingOut:
        """Drop an add-on before the visit is invoiced; the visit shortens by its minutes."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        if booking.invoice_id is not None:
            raise Conflict(_INVOICED)
        addon = (
            await self.db.execute(
                scoped(Addon, self.biz).where(Addon.id == addon_id, Addon.booking_id == booking.id)
            )
        ).scalar_one_or_none()
        if addon is None:
            raise NotFound("add-on not found")
        product = await self._item(addon.item_id, require_active=False)
        slot = await self._slot(booking.slot_id)

        async def run(cmd: Command) -> BookingOut:
            await self._lengthen(booking, slot, -(product.duration_min or 0) * addon.quantity)
            await self.db.delete(addon)
            await self.db.flush()
            cmd.record("booking.addon_remove", entity_type="booking", entity_id=booking.id)
            return await booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.addon_remove",
            run=run,
            response_model=BookingOut,
        )

    async def crew(self, booking_id: str) -> CrewOut:
        """The visit's job and crew, for a manager, its lead or one of its helpers."""
        booking = await self._booking(booking_id)
        crew = await crew_ids(self.db, self.biz, booking.id)
        if not is_manager(self.principal.role) and self.principal.staff_id not in (
            booking.staff_id,
            *crew,
        ):
            raise Forbidden("only the visit's crew or a manager can read it")
        return await self._crew_out(booking)

    async def add_crew(
        self, booking_id: str, data: CrewAdd, idempotency_key: str | None
    ) -> CrewOut:
        """Put a helper on the visit: their calendar is blocked for its window under the lock."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)
        if slot.capacity > 1:
            raise Conflict(_CLASS_CREW, code="class_move")
        helper = await self._staff(data.staff_id)
        item = await self._item(slot.item_id, require_active=False)
        assert_offers(item, helper.id)

        async def run(cmd: Command) -> CrewOut:
            await lock_staff(self.db, self.biz, slot.staff_id, helper.id)
            await self._lock_live(booking, slot)
            if helper.id == booking.staff_id or helper.id in await crew_ids(
                self.db, self.biz, booking.id
            ):
                raise Conflict("that member is already on this visit", code="crew_member")
            problem = await slot_problem(
                self.db, self.biz, item, helper.id, slot.starts_at, slot.ends_at
            )
            if problem is not None:
                raise Conflict(problem.message or OVERLAP, code="crew_busy")
            self.db.add(
                Hours(
                    id=new_id("hours"),
                    business_id=self.biz,
                    staff_id=helper.id,
                    basis="exception",
                    starts_at=slot.starts_at,
                    ends_at=slot.ends_at,
                    reason=await self._job_label(booking, item),
                    note=crew_note(booking.id),
                    available=False,
                )
            )
            await self.db.flush()
            cmd.record(
                "booking.crew_add",
                entity_type="booking",
                entity_id=booking.id,
                changes={"staff_id": helper.id},
            )
            return await self._crew_out(booking)

        return await run_command(
            self.db,
            self.principal,
            action="booking.crew_add",
            run=run,
            response_model=CrewOut,
            idempotency_key=idempotency_key,
            request={"booking_id": booking_id, "staff_id": data.staff_id},
        )

    async def remove_crew(self, booking_id: str, staff_id: str) -> CrewOut:
        """Take a helper off the visit and free their calendar."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)

        async def run(cmd: Command) -> CrewOut:
            await lock_staff(self.db, self.biz, slot.staff_id, staff_id)
            await self._lock_live(booking, slot)
            rows = [
                r for r in await crew_rows(self.db, self.biz, booking.id) if r.staff_id == staff_id
            ]
            if not rows:
                raise NotFound("that member isn't on this visit")
            for row in rows:
                await self.db.delete(row)
            await self.db.flush()
            cmd.record(
                "booking.crew_remove",
                entity_type="booking",
                entity_id=booking.id,
                changes={"staff_id": staff_id},
            )
            return await self._crew_out(booking)

        return await run_command(
            self.db,
            self.principal,
            action="booking.crew_remove",
            run=run,
            response_model=CrewOut,
        )

    async def _lock_live(self, booking: Booking, slot: Slot) -> None:
        await lock_bookings(self.db, self.biz, [booking.id])
        await self.db.refresh(slot)
        if booking.status not in ("pending", "confirmed"):
            raise Conflict(f"a {booking.status} visit's crew can't change")

    async def _job_label(self, booking: Booking, item: Item) -> str:
        """What the helper's calendar calls the block: the service and the client."""
        client = await self._client(booking.client_id)
        locale = locale_for(business=await self._business(), client=client)
        return message(locale, "crew.job", service=item.name, client=client.name)[:120]

    async def _crew_out(self, booking: Booking) -> CrewOut:
        slot = await self._slot(booking.slot_id)
        item = await self._item(slot.item_id, require_active=False)
        client = await self._client(booking.client_id)
        subject = await self.db.get(Subject, booking.subject_id) if booking.subject_id else None
        crew = await crew_ids(self.db, self.biz, booking.id)
        names = await staff_names(
            self.db, self.biz, [*crew, *([booking.staff_id] if booking.staff_id else [])]
        )
        return CrewOut(
            booking_id=booking.id,
            status=booking.status,
            lead_id=booking.staff_id,
            lead_name=names.get(booking.staff_id) if booking.staff_id else None,
            service=item.name,
            client_name=client.name,
            address=visit_address(await self._business(), subject),
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
            members=[CrewMember(staff_id=h, name=names.get(h)) for h in crew],
            can_edit=booking.status in ("pending", "confirmed")
            and slot.capacity <= 1
            and (is_manager(self.principal.role) or self.principal.staff_id == booking.staff_id),
        )

    def _assert_open_for_addons(self, booking: Booking) -> None:
        if booking.invoice_id is not None:
            raise Conflict(_INVOICED)
        if booking.status in ("canceled", "no_show", "waitlisted"):
            raise Conflict(f"a {booking.status} booking can't take an add-on")

    async def _lengthen(self, booking: Booking, slot: Slot, minutes: int) -> None:
        """Resize a live one-to-one visit by an add-on's minutes, refused when the time is taken."""
        if minutes == 0 or slot.capacity > 1:
            return
        crew = await crew_ids(self.db, self.biz, booking.id)
        await lock_staff(self.db, self.biz, slot.staff_id, *crew)
        await lock_bookings(self.db, self.biz, [booking.id])
        await self.db.refresh(slot)
        if booking.status not in ("pending", "confirmed"):
            return
        ends_at = max(slot.ends_at + timedelta(minutes=minutes), slot.starts_at + _MIN_VISIT)
        if minutes > 0:
            item = await self._item(slot.item_id, require_active=False)
            problem = await slot_problem(
                self.db, self.biz, item, slot.staff_id, slot.starts_at, ends_at, exclude=slot.id
            ) or await crew_problem(
                self.db,
                self.biz,
                item,
                await crew_rows(self.db, self.biz, booking.id),
                slot.starts_at,
                ends_at,
            )
            if problem is not None:
                raise Conflict(problem.message or OVERLAP, code="visit_no_room")
        await move_slot(self.db, self.biz, slot, slot.starts_at, ends_at)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            raise Conflict(OVERLAP, code="visit_no_room") from exc
        await carry_crew(self.db, self.biz, booking, slot)

    async def needs(self, booking_id: str) -> VisitNeeds:
        """What the client still owes before this visit: forms, signatures and a deposit."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        return (await visit_needs(self.db, self.biz, [booking]))[0]

    async def needs_on(self, day: date) -> list[VisitNeeds]:
        """The same for each open visit on a day, staff seeing only their own."""
        opens, closes = local_day(day, await business_tz(self.db, self.biz))
        query = (
            scoped(Booking, self.biz, soft_delete=True)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(
                Slot.starts_at >= opens,
                Slot.starts_at < closes,
                Booking.status.in_(("pending", "confirmed")),
            )
            .order_by(Slot.starts_at, Booking.id)
        )
        if not is_manager(self.principal.role):
            query = query.where(Booking.staff_id == self.principal.staff_id)
        bookings = list((await self.db.execute(query)).scalars().all())
        return await visit_needs(self.db, self.biz, bookings)

    def _assert_can_act_as(self, staff_id: str | None) -> None:
        assert_can_act_as(self.principal, staff_id)

    async def _item(self, item_id: str, *, require_active: bool = True) -> Item:
        return await load_item(self.db, self.biz, item_id, require_active=require_active)

    async def _client(self, client_id: str) -> Client:
        return await load_client(self.db, self.biz, client_id)

    async def _staff(self, staff_id: str) -> Staff:
        return await load_staff(self.db, self.biz, staff_id)

    async def _booking(self, booking_id: str) -> Booking:
        row = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True).where(Booking.id == booking_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("booking not found")
        return row

    async def _slot(self, slot_id: str) -> Slot:
        row = (
            await self.db.execute(scoped(Slot, self.biz).where(Slot.id == slot_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("slot not found")
        return row


async def open_slots(
    db: AsyncSession,
    business_id: str,
    item: Item,
    staff_id: str,
    on_date: date,
    step_min: int | None = None,
    *,
    exclude: str | None = None,
    minutes: int | None = None,
    crew: Sequence[Hours] = (),
) -> list[datetime]:
    """Bookable start times for the item and staff on a date, in UTC; none until hours are set."""
    tz = await business_tz(db, business_id)
    members = [staff_id, *(row.staff_id for row in crew if row.staff_id is not None)]
    found = await load_availability(db, business_id, members, on_date, on_date, tz, [item])
    return found.open_starts(
        item, staff_id, on_date, step_min, exclude=exclude, minutes=minutes, crew=crew
    )


@dataclass(frozen=True)
class Away:
    starts_at: datetime
    ends_at: datetime
    reason: str | None
    id: str = ""


@dataclass(frozen=True)
class Busy:
    id: str
    item_id: str
    starts_at: datetime
    ends_at: datetime
    before: timedelta
    after: timedelta
    full: bool


@dataclass(frozen=True)
class Availability:
    """Members' hours, closures, time off and live slots over a span, read once per request."""

    tz: ZoneInfo
    closures: list[Away]
    hours: dict[str, list[Hours]]
    time_off: dict[str, list[Away]]
    busy: dict[str, list[Busy]]

    def open_starts(
        self,
        item: Item,
        staff_id: str,
        on_date: date,
        step_min: int | None = None,
        *,
        exclude: str | None = None,
        minutes: int | None = None,
        crew: Sequence[Hours] = (),
    ) -> list[datetime]:
        """The starts `slot_problem` would accept on the date's step grid, in UTC."""
        duration = item.duration_min if minutes is None else minutes
        if duration is None or duration <= 0:
            return []
        windows = windows_on(self.hours.get(staff_id, []), on_date)
        # unset hours read as open to within_hours; here there is no window to lay a grid over
        if not windows:
            return []
        away = self.closures + self.time_off.get(staff_id, [])
        busy = [b for b in self.busy.get(staff_id, []) if b.id != exclude]
        before = timedelta(minutes=item.buffer_before_min)
        after = timedelta(minutes=item.buffer_after_min)
        length = timedelta(minutes=duration)
        step = timedelta(minutes=step_min) if step_min else length + before + after
        slots: list[datetime] = []
        for window_start, window_end in windows:
            # window times are local wall-clock; anchor them in the business tz, then work in UTC
            start = datetime.combine(on_date, window_start, tzinfo=self.tz).astimezone(UTC)
            limit = datetime.combine(on_date, window_end, tzinfo=self.tz).astimezone(UTC)
            while start + length <= limit:
                end = start + length
                if (
                    not any(a.starts_at < end and a.ends_at > start for a in away)
                    and not any(
                        b.starts_at - b.before < end + after
                        and b.ends_at + b.after > start - before
                        and (
                            b.full
                            or b.item_id != item.id
                            or b.starts_at != start
                            or b.ends_at != end
                        )
                        for b in busy
                    )
                    and all(self.free(item, row, start, end) for row in crew)
                ):
                    slots.append(start)
                start += step
        return slots

    def free(self, item: Item, block: Hours, start: datetime, end: datetime) -> bool:
        """Whether a helper can follow their visit to this window, as `crew_problem` checks it."""
        staff_id = block.staff_id
        if staff_id is None:
            return True
        away = self.closures + self.time_off.get(staff_id, [])
        if any(a.id != block.id and a.starts_at < end and a.ends_at > start for a in away):
            return False
        if not within_hours(self.hours.get(staff_id, []), self.tz, start, end):
            return False
        before = timedelta(minutes=item.buffer_before_min)
        after = timedelta(minutes=item.buffer_after_min)
        return not any(
            b.starts_at - b.before < end + after and b.ends_at + b.after > start - before
            for b in self.busy.get(staff_id, [])
        )


async def load_availability(
    db: AsyncSession,
    business_id: str,
    staff_ids: Sequence[str],
    first: date,
    last: date,
    tz: ZoneInfo,
    items: Sequence[Item],
) -> Availability:
    """Three reads for any number of members and days: hours, closures and time off, slots."""
    opens, closes = local_day(first, tz)[0], local_day(last, tz)[1]
    hours: dict[str, list[Hours]] = {staff_id: [] for staff_id in staff_ids}
    rows = await db.scalars(
        scoped(Hours, business_id).where(Hours.staff_id.in_(staff_ids), Hours.basis != "exception")
    )
    for row in rows:
        if row.staff_id is not None:
            hours[row.staff_id].append(row)
    closures: list[Away] = []
    time_off: dict[str, list[Away]] = {}
    exceptions = await db.scalars(
        scoped(Hours, business_id).where(
            Hours.basis == "exception",
            or_(Hours.staff_id.is_(None), Hours.staff_id.in_(staff_ids)),
            Hours.starts_at < closes,
            Hours.ends_at > opens,
        )
    )
    for row in exceptions:
        if row.starts_at is None or row.ends_at is None:
            continue
        window = Away(row.starts_at, row.ends_at, row.reason, row.id)
        if row.staff_id is None:
            closures.append(window)
        else:
            time_off.setdefault(row.staff_id, []).append(window)
    margin = timedelta(
        minutes=max((max(i.buffer_before_min, i.buffer_after_min) for i in items), default=0)
    )
    before = func.make_interval(0, 0, 0, 0, 0, Item.buffer_before_min)
    after = func.make_interval(0, 0, 0, 0, 0, Item.buffer_after_min)
    slots = await db.execute(
        scoped(Slot, business_id)
        .join(Item, Item.id == Slot.item_id)
        .with_only_columns(
            Slot.id,
            Slot.staff_id,
            Slot.item_id,
            Slot.starts_at,
            Slot.ends_at,
            Item.buffer_before_min,
            Item.buffer_after_min,
            seats_closed_expr(),
        )
        .where(
            Slot.staff_id.in_(staff_ids),
            Slot.status != "canceled",
            Slot.starts_at - before < closes + margin,
            Slot.ends_at + after > opens - margin,
        )
    )
    busy: dict[str, list[Busy]] = {}
    for slot_id, staff_id, item_id, starts_at, ends_at, buffer_before, buffer_after, full in slots:
        busy.setdefault(staff_id, []).append(
            Busy(
                id=slot_id,
                item_id=item_id,
                starts_at=starts_at,
                ends_at=ends_at,
                before=timedelta(minutes=buffer_before),
                after=timedelta(minutes=buffer_after),
                full=bool(full),
            )
        )
    return Availability(tz=tz, closures=closures, hours=hours, time_off=time_off, busy=busy)


async def visit_needs(
    db: AsyncSession, business_id: str, bookings: list[Booking]
) -> list[VisitNeeds]:
    clients = {b.client_id for b in bookings}
    forms = (
        await db.execute(
            scoped(Form, business_id)
            .with_only_columns(Form.id, Form.name)
            .where(Form.active, Form.send_on == "booking")
            .order_by(Form.name, Form.id)
        )
    ).all()
    responses = (
        await db.execute(
            scoped(FormResponse, business_id)
            .with_only_columns(
                FormResponse.form_id,
                FormResponse.client_id,
                FormResponse.status,
                FormResponse.token,
            )
            .where(FormResponse.client_id.in_(clients))
            .order_by(FormResponse.created_at)
        )
    ).all()
    submitted = {(r.form_id, r.client_id) for r in responses if r.status == "submitted"}
    drafts = {(r.form_id, r.client_id): r.token for r in responses if r.status == "draft"}
    contracts = {
        row.id: row
        for row in (
            await db.execute(
                scoped(Contract, business_id)
                .with_only_columns(Contract.id, Contract.name, Contract.version)
                .where(Contract.active)
            )
        ).all()
    }
    asked: dict[tuple[str, str], list[tuple[str, str, int, str | None]]] = {}
    signatures = await db.execute(
        scoped(Signature, business_id)
        .with_only_columns(
            Signature.client_id,
            Signature.contract_id,
            Signature.id,
            Signature.status,
            func.coalesce(Signature.contract_version, 0),
            Signature.token,
        )
        .where(Signature.client_id.in_(clients))
        .order_by(Signature.created_at)
    )
    for client_id, contract_id, sig_id, status, version, token in signatures.tuples().all():
        asked.setdefault((client_id, contract_id), []).append((sig_id, status, version, token))
    owed: dict[str, list[VisitNeed]] = {client_id: [] for client_id in clients}
    for client_id in clients:
        for form in forms:
            if (form.id, client_id) not in submitted:
                owed[client_id].append(
                    VisitNeed(
                        kind="form",
                        ref_id=form.id,
                        label=form.name,
                        token=drafts.get((form.id, client_id)),
                    )
                )
    for (client_id, contract_id), requests in asked.items():
        contract = contracts.get(contract_id)
        if contract is None:
            continue
        signed = max((v for _, status, v, _ in requests if status == "signed"), default=0)
        if signed >= contract.version:
            continue
        pending = next((r for r in reversed(requests) if r[1] == "pending"), None)
        if pending is not None:
            need = VisitNeed(
                kind="signature", ref_id=pending[0], label=contract.name, token=pending[3]
            )
        elif signed > 0:
            need = VisitNeed(kind="signature", ref_id=contract_id, label=contract.name)
        else:
            continue
        owed[client_id].append(need)
    return [
        VisitNeeds(
            booking_id=b.id,
            needs=[
                *owed[b.client_id],
                *(
                    [VisitNeed(kind="deposit", ref_id=b.id, amount_cents=b.deposit_amount_cents)]
                    if b.deposit_status == "pending" and b.deposit_amount_cents > 0
                    else []
                ),
            ],
        )
        for b in bookings
    ]


def local_day(on_date: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """A local date's span in UTC, midnight to midnight, so 23- and 25-hour days come out right."""
    opens = datetime.combine(on_date, time.min, tzinfo=tz).astimezone(UTC)
    return opens, datetime.combine(on_date + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)


_WEEKDAY_CODES: dict[Weekday, int] = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
_WEEKDAY_NAMES: dict[int, Weekday] = {v: k for k, v in _WEEKDAY_CODES.items()}
_SKIPPED = "left out when the series was booked"
_SERVICE_ONLY = "a client's series repeats a service; book a class's sessions one at a time"
_MAX_OCCURRENCES = 60  # a full year of weekly + headroom; caps runaway/unbounded rules
_TOO_LONG = f"a series can hold at most {_MAX_OCCURRENCES} visits; end it sooner"


def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year, month = d.year + total // 12, total % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _same_weekday(start: date, months: int) -> date:
    """The same nth weekday `months` later (2nd Tuesday stays 2nd Tuesday); a 5th falls back."""
    nth = (start.day - 1) // 7
    first = _add_months(start.replace(day=1), months)
    shift = (start.weekday() - first.weekday()) % 7
    day = 1 + shift + nth * 7
    while day > calendar.monthrange(first.year, first.month)[1]:
        day -= 7
    return first.replace(day=day)


def expand_occurrences(
    *,
    start_date: date,
    frequency: RecurrenceFrequency,
    interval: int,
    byday: Sequence[Weekday] | None,
    count: int | None,
    until: date | None,
    monthly_by: MonthlyBy = "date",
    cap: int = _MAX_OCCURRENCES,
) -> list[date]:
    """Occurrence dates for a rule, bounded by count, until and a hard cap."""
    interval = max(1, interval)
    limit = min(count if count is not None else cap, cap)
    dates: list[date] = []

    if frequency == "week":
        weekdays = sorted({_WEEKDAY_CODES[d] for d in byday}) if byday else [start_date.weekday()]
        week_start = start_date - timedelta(days=start_date.weekday())
        for week in range(limit * interval + 8):
            base = week_start + timedelta(weeks=week * interval)
            for wd in weekdays:
                d = base + timedelta(days=wd)
                if d < start_date:
                    continue
                if until is not None and d > until:
                    return dates
                dates.append(d)
                if len(dates) >= limit:
                    return dates
        return dates

    for step in range(limit):
        if frequency == "day":
            cur = start_date + timedelta(days=step * interval)
        elif monthly_by == "weekday":
            cur = _same_weekday(start_date, step * interval)
        else:
            cur = _add_months(start_date, step * interval)
        if until is not None and cur > until:
            break
        dates.append(cur)
    return dates


class RecurrenceService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def create(self, data: RecurrenceCreate, idempotency_key: str | None) -> RecurrenceOut:
        """Create the recurrence and its bookings; clashing occurrences are skipped and reported."""
        assert_can_act_as(self.principal, data.staff_id)
        if data.count is None and data.until is None:
            raise AppError("a recurring schedule needs an end: set count or until", status_code=422)
        item = await load_item(self.db, self.biz, data.item_id)
        if item.kind != "service":
            raise Unprocessable(_SERVICE_ONLY, code="series_service_only")
        if item.duration_min is None or item.duration_min <= 0:
            raise AppError("that service has no duration and can't be booked", status_code=422)
        await load_client(self.db, self.biz, data.client_id)
        await load_staff(self.db, self.biz, data.staff_id)

        if data.subject_id is not None:
            await assert_subject(self.db, self.biz, data.subject_id, data.client_id)

        base = data.starts_at
        # Re-localize the wall-clock time per date, so occurrences keep their time across DST.
        tz = await business_tz(self.db, self.biz)
        local = (base if base.tzinfo is not None else base.replace(tzinfo=UTC)).astimezone(tz)
        local_time = local.time()
        occ_dates = expand_occurrences(
            start_date=local.date(),
            frequency=data.frequency,
            interval=data.interval,
            byday=data.byday,
            count=data.count,
            until=data.until,
            monthly_by=data.monthly_by,
            cap=_MAX_OCCURRENCES + 1,
        )
        if len(occ_dates) > _MAX_OCCURRENCES:
            raise Unprocessable(_TOO_LONG, code="recurrence_too_long")
        handled = {e.date: e for e in data.exceptions}

        async def run(cmd: Command) -> RecurrenceOut:
            recurrence = Recurrence(
                id=new_id("recurrence"),
                business_id=self.biz,
                item_id=item.id,
                staff_id=data.staff_id,
                client_id=data.client_id,
                frequency=data.frequency,
                interval=data.interval,
                byday=data.byday,
                monthly_by=data.monthly_by,
                count=data.count,
                until=data.until,
                status="active",
            )
            self.db.add(recurrence)
            await self.db.flush()

            occurrences: list[RecurrenceOccurrence] = []
            created = 0
            for d in occ_dates:
                starts_at = datetime.combine(d, local_time, tzinfo=tz).astimezone(UTC)
                handling = handled.get(d)
                if handling is not None and handling.action == "skip":
                    occurrences.append(
                        RecurrenceOccurrence(starts_at=starts_at, booking_id=None, skipped=_SKIPPED)
                    )
                    continue
                if handling is not None and handling.starts_at is not None:
                    starts_at = handling.starts_at
                try:
                    async with self.db.begin_nested():
                        booking, _ = await create_booking_core(
                            self.db,
                            self.biz,
                            item=item,
                            staff_id=data.staff_id,
                            starts_at=starts_at,
                            client_id=data.client_id,
                            source="manual",
                            subject_id=data.subject_id,
                            recurrence_id=recurrence.id,
                        )
                    created += 1
                    occurrences.append(
                        RecurrenceOccurrence(
                            starts_at=starts_at, booking_id=booking.id, skipped=None
                        )
                    )
                except Conflict as exc:
                    occurrences.append(
                        RecurrenceOccurrence(starts_at=starts_at, booking_id=None, skipped=str(exc))
                    )

            cmd.record("recurrence.create", entity_type="recurrence", entity_id=recurrence.id)
            return RecurrenceOut(
                id=recurrence.id,
                business_id=self.biz,
                item_id=recurrence.item_id,
                staff_id=recurrence.staff_id,
                client_id=recurrence.client_id,
                frequency=recurrence.frequency,
                interval=recurrence.interval,
                status=recurrence.status,
                created=created,
                skipped=len(occurrences) - created,
                occurrences=occurrences,
            )

        return await run_command(
            self.db,
            self.principal,
            action="recurrence.create",
            run=run,
            response_model=RecurrenceOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def change(self, recurrence_id: str, data: RecurrenceChange) -> RecurrenceChangeOut:
        """Move one, the following or all upcoming visits; a visit that would clash stays put."""
        recurrence = await self._recurrence(recurrence_id)
        assert_can_act_as(self.principal, recurrence.staff_id)
        if data.weekday is None and data.time is None and data.staff_id is None:
            raise Unprocessable("say what changes: a weekday, a time or a member")
        if data.staff_id is not None:
            assert_can_act_as(self.principal, data.staff_id)
            await load_staff(self.db, self.biz, data.staff_id)
            series_item = await load_item(
                self.db, self.biz, recurrence.item_id, require_active=False
            )
            assert_offers(series_item, data.staff_id)
        tz = await business_tz(self.db, self.biz)
        visits = await self._upcoming(recurrence, data.scope, data.from_date, tz)
        new_time = time.fromisoformat(data.time) if data.time is not None else None

        async def run(cmd: Command) -> RecurrenceChangeOut:
            moved: list[str] = []
            skipped: list[RecurrenceOccurrence] = []
            members = {slot.staff_id for _, slot in visits}
            for booking, _ in visits:
                members.update(await crew_ids(self.db, self.biz, booking.id))
            await lock_staff(
                self.db, self.biz, *members, *([data.staff_id] if data.staff_id else [])
            )
            for booking, slot in await self._lock_visits(visits):
                local = slot.starts_at.astimezone(tz)
                day = local.date()
                if data.weekday is not None:
                    day += timedelta(days=data.weekday - day.weekday())
                starts_at = datetime.combine(day, new_time or local.time(), tzinfo=tz).astimezone(
                    UTC
                )
                ends_at = starts_at + (slot.ends_at - slot.starts_at)
                staff_id = data.staff_id or slot.staff_id
                item = await load_item(self.db, self.biz, slot.item_id, require_active=False)
                problem = (
                    _verdict("past", _PAST)
                    if starts_at < clock.now()
                    else _verdict("class", _CLASS_MOVE)
                    if slot.capacity > 1
                    else await slot_problem(
                        self.db,
                        self.biz,
                        item,
                        staff_id,
                        starts_at,
                        ends_at,
                        exclude=slot.id,
                    )
                    or await crew_problem(
                        self.db,
                        self.biz,
                        item,
                        await crew_rows(self.db, self.biz, booking.id),
                        starts_at,
                        ends_at,
                    )
                )
                if problem is not None:
                    skipped.append(
                        RecurrenceOccurrence(
                            starts_at=starts_at, booking_id=booking.id, skipped=problem.message
                        )
                    )
                    continue
                await move_slot(self.db, self.biz, slot, starts_at, ends_at)
                slot.staff_id = staff_id
                if booking.staff_id != staff_id:
                    booking.staff_id = staff_id
                    await self.db.execute(
                        scoped_update(Addon, self.biz)
                        .where(Addon.booking_id == booking.id)
                        .values(staff_id=staff_id)
                    )
                await self.db.flush()
                await carry_crew(self.db, self.biz, booking, slot)
                moved.append(booking.id)
            if data.scope != "one" and data.staff_id is not None:
                recurrence.staff_id = data.staff_id
            if data.scope != "one" and data.weekday is not None and recurrence.frequency == "week":
                recurrence.byday = [_WEEKDAY_NAMES[data.weekday]]
            await self.db.flush()
            cmd.record("recurrence.change", entity_type="recurrence", entity_id=recurrence.id)
            return RecurrenceChangeOut(id=recurrence.id, moved=moved, skipped=skipped)

        return await run_command(
            self.db,
            self.principal,
            action="recurrence.change",
            run=run,
            response_model=RecurrenceChangeOut,
        )

    async def cancel(
        self, recurrence_id: str, data: RecurrenceCancel, gateway: PaymentGateway
    ) -> RecurrenceCancelOut:
        """Cancel the visits from a date on and end the series there; paid deposits go back."""
        recurrence = await self._recurrence(recurrence_id)
        assert_can_act_as(self.principal, recurrence.staff_id)
        if recurrence.status == "canceled":
            raise Conflict("this series is already canceled")
        tz = await business_tz(self.db, self.biz)
        scope = "all" if data.from_date is None else "following"
        visits = await self._upcoming(recurrence, scope, data.from_date, tz, strict=False)

        async def run(cmd: Command) -> RecurrenceCancelOut:
            refunded = 0
            canceled: list[str] = []
            now = clock.now()
            await lock_staff(self.db, self.biz, *{slot.staff_id for _, slot in visits})
            for booking, slot in await self._lock_visits(visits):
                if booking.deposit_status == "collected":
                    refunded += await refund_deposit(self.db, gateway, booking)
                elif booking.deposit_status == "pending":
                    await cancel_open_deposits(self.db, gateway, booking)
                    booking.deposit_status = "none"
                booking.status = "canceled"
                booking.canceled_at = now
                await release_slot(self.db, slot)
                await carry_crew(self.db, self.biz, booking, slot)
                await fill_freed_seats(self.db, slot, performed_by=self.principal.user_id)
                canceled.append(booking.id)
            remaining = await self._upcoming(recurrence, "all", None, tz, strict=False)
            if remaining:
                recurrence.status = "ended"
                if data.from_date is not None:
                    recurrence.until = data.from_date - timedelta(days=1)
            else:
                recurrence.status = "canceled"
            await self.db.flush()
            cmd.record("recurrence.cancel", entity_type="recurrence", entity_id=recurrence.id)
            return RecurrenceCancelOut(
                id=recurrence.id,
                status=recurrence.status,
                canceled=canceled,
                refunded_cents=refunded,
            )

        return await run_command(
            self.db,
            self.principal,
            action="recurrence.cancel",
            run=run,
            response_model=RecurrenceCancelOut,
        )

    async def _lock_visits(self, visits: list[tuple[Booking, Slot]]) -> list[tuple[Booking, Slot]]:
        """The visits still live once their rows are locked, with their slots reloaded."""
        live = {
            b.id
            for b in await lock_bookings(self.db, self.biz, [b.id for b, _ in visits])
            if b.status in ("pending", "confirmed")
        }
        kept = [(b, s) for b, s in visits if b.id in live]
        for _, slot in kept:
            await self.db.refresh(slot)
        return kept

    async def _recurrence(self, recurrence_id: str) -> Recurrence:
        row = (
            await self.db.execute(
                scoped(Recurrence, self.biz).where(Recurrence.id == recurrence_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("series not found")
        return row

    async def _upcoming(
        self,
        recurrence: Recurrence,
        scope: str,
        from_date: date | None,
        tz: ZoneInfo,
        *,
        strict: bool = True,
    ) -> list[tuple[Booking, Slot]]:
        """The series client's live visits still ahead, narrowed to one date or from a date on."""
        rows = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True)
                .add_columns(Slot)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Slot.recurrence_id == recurrence.id,
                    Booking.client_id == recurrence.client_id,
                    Booking.status.in_(("pending", "confirmed")),
                    Slot.starts_at >= clock.now(),
                )
                .order_by(Slot.starts_at)
            )
        ).all()
        visits = [(row[0], row[1]) for row in rows]
        if scope == "all":
            return visits
        if from_date is None:
            raise Unprocessable("name the visit the change starts from")
        if scope == "one":
            visits = [v for v in visits if v[1].starts_at.astimezone(tz).date() == from_date]
        else:
            visits = [v for v in visits if v[1].starts_at.astimezone(tz).date() >= from_date]
        if strict and not visits:
            raise NotFound("no upcoming visit in this series on that date")
        return visits


async def open_windows(
    db: AsyncSession, staff_id: str, business_id: str, on_date: date
) -> list[tuple[time, time]] | None:
    """Open work intervals on a date; None when the day has no hours set, [] when closed."""
    rows = (
        (await db.execute(scoped(Hours, business_id).where(Hours.staff_id == staff_id)))
        .scalars()
        .all()
    )
    return windows_on(rows, on_date)


def windows_on(rows: Sequence[Hours], on_date: date) -> list[tuple[time, time]] | None:
    date_rows = [r for r in rows if r.basis == "date" and r.date == on_date]
    if date_rows:
        if any(not r.available and r.start_time is None for r in date_rows):
            return []
        return [
            (r.start_time or time.min, r.end_time or time.max) for r in date_rows if r.available
        ]
    weekday_rows = [r for r in rows if r.basis == "recurring" and r.weekday == on_date.weekday()]
    if not weekday_rows:
        return None
    return [(r.start_time or time.min, r.end_time or time.max) for r in weekday_rows if r.available]


def _as_utc(dt: datetime) -> datetime:
    return (dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)).astimezone(UTC)


async def is_within_hours(
    db: AsyncSession, staff_id: str, business_id: str, start: datetime, end: datetime
) -> bool:
    """Whether the window sits inside open hours on its local date, or the day has none set."""
    tz = await business_tz(db, business_id)
    rows = (
        (await db.execute(scoped(Hours, business_id).where(Hours.staff_id == staff_id)))
        .scalars()
        .all()
    )
    return within_hours(rows, tz, start, end)


def within_hours(rows: Sequence[Hours], tz: ZoneInfo, start: datetime, end: datetime) -> bool:
    """Whether the window sits inside these hours on its local date, or the day has none set."""
    start_local, end_local = _as_utc(start).astimezone(tz), _as_utc(end).astimezone(tz)
    windows = windows_on(rows, start_local.date())
    if windows is None:
        return True
    if end_local.date() != start_local.date():
        return False
    return any(ws <= start_local.time() and end_local.time() <= we for ws, we in windows)


class ClassService:
    """A class session's roster: adding (to the waitlist when full), check-in, no-shows, seats."""

    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def add(
        self, slot_id: str, data: RosterAdd, idempotency_key: str | None = None
    ) -> RosterEntry:
        slot = await self._session(slot_id)
        assert_can_act_as(self.principal, slot.staff_id)
        await load_client(self.db, self.biz, data.client_id)
        if data.subject_id is not None:
            await self._subject(data.subject_id, data.client_id)
        if slot.starts_at < clock.now() - timedelta(hours=12):
            raise Conflict("that class has already happened")
        item = await load_item(self.db, self.biz, slot.item_id, require_active=False)

        async def run(cmd: Command) -> RosterEntry:
            await lock_staff(self.db, self.biz, slot.staff_id)
            if await client_has_seat(self.db, self.biz, slot.id, data.client_id):
                raise Conflict(ALREADY_IN_CLASS)
            full = await seats_closed(self.db, slot.id)
            deposit = deposit_cents(item) if item.deposit_type != "none" else 0
            booking = Booking(
                id=new_id("booking"),
                business_id=self.biz,
                slot_id=slot.id,
                starts_at=slot.starts_at,
                staff_id=slot.staff_id,
                client_id=data.client_id,
                subject_id=data.subject_id,
                status="waitlisted",
                source="manual",
                price_cents=item.price_cents,
                deposit_amount_cents=deposit,
                deposit_status="pending" if deposit > 0 else "none",
                manage_token=secrets.token_urlsafe(18),
            )
            if not full:
                seat_booking(booking)
            self.db.add(booking)
            await self.db.flush()
            action = "class.waitlist" if full else "class.add"
            cmd.record(action, entity_type="booking", entity_id=booking.id)
            if data.notify:
                notifier = queued_notifier(self.db, f"booking:{booking.id}", self.biz)
                if full:
                    await notifier.on_waitlist_joined(self.db, booking.id)
                else:
                    await notifier.on_booking_confirmed(self.db, booking.id)
            return await self._entry(booking)

        return await run_command(
            self.db,
            self.principal,
            action="class.add",
            run=run,
            response_model=RosterEntry,
            idempotency_key=idempotency_key,
            request={"slot_id": slot_id, **data.model_dump(mode="json")},
        )

    async def act(self, slot_id: str, booking_id: str, data: RosterAction) -> RosterEntry:
        slot = await self._session(slot_id)
        assert_can_act_as(self.principal, slot.staff_id)
        booking = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True).where(
                    Booking.id == booking_id, Booking.slot_id == slot.id
                )
            )
        ).scalar_one_or_none()
        if booking is None:
            raise NotFound("that booking isn't on this class")
        if data.action == "no_show":
            _assert_started(slot.starts_at)

        async def run(cmd: Command) -> RosterEntry:
            await lock_staff(self.db, self.biz, slot.staff_id)
            await lock_bookings(self.db, self.biz, [booking.id])
            if data.action == "check_in":
                if booking.status != "confirmed":
                    raise Conflict(f"a {booking.status} booking can't be checked in")
                booking.checked_in_at = booking.checked_in_at or clock.now()
            elif data.action == "undo":
                await self._undo(booking)
            elif data.action == "no_show":
                if booking.status != "confirmed":
                    raise Conflict(f"a {booking.status} booking can't be marked a no-show")
                booking.status = "no_show"
                booking.checked_in_at = None
                await BookingService(self.db, self.principal, self.gateway).forfeit_deposit(
                    cmd, booking
                )
                await fill_freed_seats(self.db, slot, performed_by=self.principal.user_id)
            else:
                if booking.status != "waitlisted":
                    raise Conflict("only someone on the waitlist can be given a seat")
                if await booked_count(self.db, slot.id) >= slot.capacity:
                    raise Conflict(_CLASS_FULL, code="class_full")
                seat_booking(booking)
                await self.db.flush()
                await queued_notifier(
                    self.db, seat_scope(slot.id, booking.id), self.biz
                ).on_seat_opened(self.db, booking.id)
            await self.db.flush()
            cmd.record(f"class.{data.action}", entity_type="booking", entity_id=booking.id)
            return await self._entry(booking)

        return await run_command(
            self.db, self.principal, action="class.roster", run=run, response_model=RosterEntry
        )

    async def message(
        self, slot_id: str, data: ClassMessage, sms: SmsSender, email: EmailSender
    ) -> ClassMessageOut:
        """One message to everyone booked, by text when they have a mobile, else by email."""
        slot = await self._session(slot_id)
        assert_can_act_as(self.principal, slot.staff_id)
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        brand = await business_brand(self.db, business)
        clients = (
            (
                await self.db.execute(
                    scoped(Client, self.biz, soft_delete=True)
                    .join(Booking, Booking.client_id == Client.id)
                    .where(Booking.slot_id == slot.id, Booking.status == "confirmed")
                    .distinct()
                )
            )
            .scalars()
            .all()
        )

        async def run(cmd: Command) -> ClassMessageOut:
            sent = 0
            for client in clients:
                channel: Channel = "sms" if client.phone else "email"
                to = client.phone or client.email
                if not to:
                    continue
                thread = await open_thread(self.db, self.biz, client.id, channel)
                note = Message(
                    id=new_id("message"),
                    business_id=self.biz,
                    thread_id=thread.id,
                    direction="out",
                    channel=channel,
                    sent_by=self.principal.user_id,
                    body=data.body,
                    status="queued",
                )
                self.db.add(note)
                await self.db.flush()
                notice = message_notice(
                    locale_for(business=business, client=client), business.name, data.body
                )
                await dispatch_message(
                    sms, email, channel, to, notice, message=note, business=business, brand=brand
                )
                sent += 1
            await self.db.flush()
            cmd.record("class.message", entity_type="slot", entity_id=slot.id)
            return ClassMessageOut(sent=sent)

        return await run_command(
            self.db, self.principal, action="class.message", run=run, response_model=ClassMessageOut
        )

    async def _undo(self, booking: Booking) -> None:
        if booking.status == "confirmed" and booking.checked_in_at is not None:
            booking.checked_in_at = None
        elif booking.status == "no_show" and booking.deposit_status != "forfeited":
            booking.status = "confirmed"
        else:
            raise Conflict("there's nothing to undo on this booking")

    async def _session(self, slot_id: str) -> Slot:
        slot = (
            await self.db.execute(scoped(Slot, self.biz).where(Slot.id == slot_id))
        ).scalar_one_or_none()
        if slot is None:
            raise NotFound("class not found")
        if slot.capacity <= 1 or slot.status == "canceled":
            raise Conflict("that time isn't a class session")
        return slot

    async def _subject(self, subject_id: str, client_id: str) -> None:
        await assert_subject(self.db, self.biz, subject_id, client_id)

    async def _entry(self, booking: Booking) -> RosterEntry:
        return RosterEntry(
            booking_id=booking.id,
            slot_id=booking.slot_id,
            client_id=booking.client_id,
            subject_id=booking.subject_id,
            status=booking.status,
            checked_in_at=booking.checked_in_at,
            waitlist_position=await waitlist_position(self.db, booking),
        )


def policy_of(business: Business) -> BookingPolicy:
    """The business's booking rules, with a default for anything never set."""
    return BookingPolicy.model_validate(business.booking_policy or {})


_ONLINE_ADMIN = "only an owner or admin can change online booking"


class OnlineBookingService:
    """The owner's online booking page: rules, cancellation policy, what and who is bookable."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        assert_role(principal, "owner", "admin", message=_ONLINE_ADMIN)
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def get(self) -> OnlineBookingOut:
        business = await self._business()
        services = (
            (
                await self.db.execute(
                    scoped(Item, self.biz)
                    .where(Item.active.is_(True), Item.kind.in_(("service", "class")))
                    .order_by(Item.name)
                )
            )
            .scalars()
            .all()
        )
        staff = (
            await self.db.execute(
                scoped(Staff, self.biz)
                .add_columns(staff_name())
                .where(Staff.status == "active")
                .order_by(Staff.created_at)
            )
        ).tuples()
        since = clock.now() - timedelta(days=30)
        online = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True)
                .where(Booking.source == "online", Booking.created_at >= since)
                .with_only_columns(
                    func.count(Booking.id), func.coalesce(func.sum(Booking.deposit_amount_cents), 0)
                )
            )
        ).one()
        return OnlineBookingOut(
            slug=business.slug,
            business_name=business.name,
            policy=policy_of(business),
            services=[
                OnlineService(
                    id=i.id,
                    name=i.name,
                    kind=i.kind,
                    duration_min=i.duration_min,
                    price_cents=i.price_cents,
                    color=i.color,
                    deposit_type=i.deposit_type,
                    deposit_cents=deposit_cents(i) if i.deposit_type != "none" else 0,
                    online_bookable=i.online_bookable,
                )
                for i in services
            ],
            staff=[
                OnlineStaff(
                    id=s.id,
                    name=name,
                    title=s.title,
                    color=s.color,
                    bookable_online=s.bookable_online,
                )
                for s, name in staff
            ],
            online_30d=int(online[0]),
            deposits_30d_cents=int(online[1]),
        )

    async def update(self, data: OnlineBookingPatch) -> OnlineBookingOut:
        business = await self._business()

        async def run(cmd: Command) -> OnlineBookingOut:
            if data.policy is not None:
                changes = data.policy.model_dump(exclude_unset=True)
                if changes.get("step_min") == 0:
                    changes["step_min"] = None
                merged = policy_of(business).model_copy(update=changes)
                rules = BookingPolicy.model_validate(merged.model_dump()).model_dump()
                # stored settings the API no longer shows (late_cancel_deposit) are kept as they are
                business.booking_policy = {**(business.booking_policy or {}), **rules}
            for item_id, bookable in (data.services or {}).items():
                item = (
                    await self.db.execute(
                        scoped(Item, self.biz).where(
                            Item.id == item_id, Item.kind.in_(("service", "class"))
                        )
                    )
                ).scalar_one_or_none()
                if item is None:
                    raise NotFound("service not found")
                item.online_bookable = bookable
            for staff_id, shown in (data.staff or {}).items():
                member = await load_staff(self.db, self.biz, staff_id)
                member.bookable_online = shown
            await self.db.flush()
            cmd.record("online_booking.update", entity_type="business", entity_id=self.biz)
            return await self.get()

        return await run_command(
            self.db,
            self.principal,
            action="online_booking.update",
            run=run,
            response_model=OnlineBookingOut,
        )

    async def set_addons(self, data: AddonOffersPatch) -> AddonOffersOut:
        services = set(
            (
                await self.db.execute(
                    scoped(Item, self.biz)
                    .where(Item.kind.in_(("service", "class")))
                    .with_only_columns(Item.id)
                )
            )
            .scalars()
            .all()
        )
        for offer in data.offers:
            unknown = set(offer.addon_for) - services
            if unknown:
                raise NotFound("service not found")

        async def run(cmd: Command) -> AddonOffersOut:
            out: list[AddonOffer] = []
            for offer in data.offers:
                item = (
                    await self.db.execute(
                        scoped(Item, self.biz).where(Item.id == offer.id, Item.kind == "product")
                    )
                ).scalar_one_or_none()
                if item is None:
                    raise NotFound("product not found")
                item.addon = offer.addon
                item.addon_for = sorted(set(offer.addon_for))
                out.append(AddonOffer(id=item.id, addon=item.addon, addon_for=item.addon_for))
            await self.db.flush()
            cmd.record("online_booking.addons", entity_type="business", entity_id=self.biz)
            return AddonOffersOut(offers=out)

        return await run_command(
            self.db,
            self.principal,
            action="online_booking.addons",
            run=run,
            response_model=AddonOffersOut,
        )

    async def _business(self) -> Business:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        return business


_MAX_AWAY = timedelta(days=366)


class TimeOffService:
    """Time off for one member, or a closure for the whole business, as hours exceptions."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def create(self, data: TimeOffCreate, idempotency_key: str | None) -> TimeOffOut:
        await self._assert_may_edit(data.staff_id)
        if data.ends_at <= data.starts_at:
            raise Unprocessable("time off must end after it starts")
        if data.ends_at - data.starts_at > _MAX_AWAY:
            raise Unprocessable("time off can't run longer than a year; add it in parts")

        async def run(cmd: Command) -> TimeOffOut:
            await lock_staff(self.db, self.biz, *await self._covered(data.staff_id))
            row = Hours(
                id=new_id("hours"),
                business_id=self.biz,
                staff_id=data.staff_id,
                basis="exception",
                starts_at=data.starts_at,
                ends_at=data.ends_at,
                reason=data.reason.strip(),
                available=False,
            )
            self.db.add(row)
            await self.db.flush()
            action = "closure.create" if data.staff_id is None else "time_off.create"
            cmd.record(action, entity_type="hours", entity_id=row.id)
            return await self._out(row)

        return await run_command(
            self.db,
            self.principal,
            action="time_off.create",
            run=run,
            response_model=TimeOffOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def delete(self, hours_id: str) -> TimeOffOut:
        row = (
            await self.db.execute(
                scoped(Hours, self.biz).where(Hours.id == hours_id, Hours.basis == "exception")
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("time off not found")
        await self._assert_may_edit(row.staff_id)
        if row.note is not None and row.note.startswith(crew_note("")):
            raise Conflict("take the member off the visit's crew instead", code="crew_block")

        async def run(cmd: Command) -> TimeOffOut:
            out = await self._out(row)
            await self.db.delete(row)
            await self.db.flush()
            cmd.record("time_off.delete", entity_type="hours", entity_id=row.id)
            return out

        return await run_command(
            self.db,
            self.principal,
            action="time_off.delete",
            run=run,
            response_model=TimeOffOut,
        )

    async def _covered(self, staff_id: str | None) -> list[str]:
        if staff_id is not None:
            return [staff_id]
        rows = await self.db.scalars(
            scoped(Staff, self.biz).with_only_columns(Staff.id).where(Staff.status == "active")
        )
        return list(rows)

    async def _assert_may_edit(self, staff_id: str | None) -> None:
        if staff_id is None:
            assert_role(
                self.principal,
                "owner",
                "admin",
                message="only an owner or admin can close the business",
            )
            return
        assert_can_act_as(self.principal, staff_id)
        await load_staff(self.db, self.biz, staff_id)

    async def _out(self, row: Hours) -> TimeOffOut:
        assert row.starts_at is not None and row.ends_at is not None
        q = (
            scoped(Booking, self.biz, soft_delete=True)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(
                Booking.status.in_(("pending", "confirmed")),
                Slot.starts_at < row.ends_at,
                Slot.ends_at > row.starts_at,
            )
            .order_by(Slot.starts_at)
        )
        if row.staff_id is not None:
            q = q.where(Booking.staff_id == row.staff_id)
        affected = (await self.db.execute(q.with_only_columns(Booking.id))).scalars().all()
        return TimeOffOut(
            id=row.id,
            business_id=row.business_id,
            staff_id=row.staff_id,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            reason=row.reason or "",
            affected=list(affected),
        )


_UNPAID_TTL = timedelta(minutes=30)
_REMINDER_WINDOW = timedelta(hours=24)


async def run_reap_unpaid_bookings(
    db: AsyncSession, gateway: PaymentGateway, notifier: Notifier, now: datetime
) -> int:
    """Release online bookings whose deposit went unpaid past the window, and tell the client."""

    def deposits(*statuses: str) -> Exists:
        q = select(Payment.id).where(Payment.booking_id == Booking.id, Payment.kind == "deposit")
        return (q.where(Payment.status.in_(statuses)) if statuses else q).exists()

    due = (
        Booking.deleted_at.is_(None),
        Booking.source == "online",
        Booking.deposit_amount_cents > 0,
        Booking.status.not_in(_CLOSED_OR_WAITING),
        Booking.created_at < now - _UNPAID_TTL,
        Slot.starts_at > now,
        deposits(),
        ~deposits("succeeded"),
    )
    members = await db.execute(
        select(Booking.business_id, Slot.staff_id)
        .join(Slot, Slot.id == Booking.slot_id)
        .where(*due)
        .distinct()
        .order_by(Booking.business_id, Slot.staff_id)
    )
    for business_id, staff_id in members.tuples():
        await lock_staff(db, business_id, staff_id)
    rows = (
        await db.execute(
            select(Booking, Slot)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(*due)
            .with_for_update(of=Booking, skip_locked=True)
            .execution_options(populate_existing=True)
        )
    ).all()
    released: list[str] = []
    for booking, slot in rows:
        if not await cancel_open_deposits(db, gateway, booking):
            continue
        booking.status = "canceled"
        booking.canceled_at = now
        if booking.deposit_status == "pending":
            booking.deposit_status = "none"
        await release_slot(db, slot)
        await carry_crew(db, booking.business_id, booking, slot)
        await fill_freed_seats(db, slot)
        released.append(booking.id)
    await db.commit()
    for booking_id in released:
        await notifier.on_booking_released(db, booking_id)
    return len(released)


async def run_complete_past_bookings(
    db: AsyncSession, gateway: PaymentGateway, now: datetime
) -> int:
    """Close the visits and waitlists still open after their business's local midnight."""
    open_past = (
        select(Booking.business_id)
        .join(Slot, Slot.id == Booking.slot_id)
        .where(
            Booking.deleted_at.is_(None),
            Booking.status.in_(("pending", "confirmed", "waitlisted")),
            Slot.ends_at <= now,
        )
        .distinct()
    )
    businesses = (
        await db.execute(
            select(Business.id, Business.timezone, Business.booking_policy).where(
                Business.id.in_(open_past)
            )
        )
    ).all()
    closed = 0
    for business_id, timezone, policy in businesses:
        closed += await _close_past_waitlists(db, business_id, zone(timezone), now)
        if BookingPolicy.model_validate(policy or {}).auto_complete:
            closed += await _close_past_visits(db, gateway, business_id, zone(timezone), now)
        await db.commit()
    return closed


async def _close_past_waitlists(
    db: AsyncSession, business_id: str, tz: ZoneInfo, now: datetime
) -> int:
    """Take the people still waiting off a class that has ended, and tell them it filled up."""
    midnight, _ = local_day(now.astimezone(tz).date(), tz)
    rows = await db.scalars(
        scoped(Booking, business_id, soft_delete=True)
        .join(Slot, Slot.id == Booking.slot_id)
        .where(Booking.status == "waitlisted", Slot.ends_at <= midnight)
        .order_by(Booking.id)
        .with_for_update(of=Booking, skip_locked=True)
        .execution_options(populate_existing=True)
    )
    closed = 0
    for booking in rows.all():
        booking.status, booking.canceled_at = "canceled", now
        if booking.deposit_status == "pending":
            booking.deposit_status = "none"
        db.add(
            Audit(
                id=new_id("audit"),
                business_id=business_id,
                action="booking.waitlist_closed",
                entity_type="booking",
                entity_id=booking.id,
                changes={"reason": "class_full"},
            )
        )
        await db.flush()
        await queued_notifier(db, f"waitlist:{booking.id}", business_id).on_waitlist_closed(
            db, booking.id
        )
        closed += 1
    return closed


async def _close_past_visits(
    db: AsyncSession, gateway: PaymentGateway, business_id: str, tz: ZoneInfo, now: datetime
) -> int:
    midnight, _ = local_day(now.astimezone(tz).date(), tz)
    due = (Booking.status.in_(("pending", "confirmed")), Slot.ends_at <= midnight)
    members = await db.scalars(
        scoped(Slot, business_id)
        .with_only_columns(Slot.staff_id)
        .join(Booking, Booking.slot_id == Slot.id)
        .where(Booking.deleted_at.is_(None), *due)
        .distinct()
    )
    await lock_staff(db, business_id, *members)
    rows = (
        await db.execute(
            scoped(Booking, business_id, soft_delete=True)
            .add_columns(Slot)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(*due)
            .order_by(Booking.id)
            .with_for_update(of=Booking, skip_locked=True)
            .execution_options(populate_existing=True)
        )
    ).all()
    slots: dict[str, Slot] = {}
    changed = 0
    for booking, slot in rows:
        if booking.status == "confirmed":
            booking.status, booking.completed_at = "completed", now
            action = "booking.auto_complete"
        elif booking.deposit_status == "collected":
            continue  # a paid deposit on an unapproved visit is staff's to refund or keep
        elif booking.deposit_status == "pending" and not await cancel_open_deposits(
            db, gateway, booking
        ):
            continue
        else:
            booking.status, booking.canceled_at = "canceled", now
            action = "booking.auto_cancel"
            await carry_crew(db, business_id, booking, slot)
        if booking.deposit_status == "pending":
            booking.deposit_status = "none"
        db.add(
            Audit(
                id=new_id("audit"),
                business_id=business_id,
                action=action,
                entity_type="booking",
                entity_id=booking.id,
                changes={},
            )
        )
        slots[slot.id] = slot
        changed += 1
    for slot in slots.values():
        await release_slot(db, slot)
        if slot.status != "canceled":
            await complete_when_done(db, slot)
    await db.flush()
    return changed


async def run_reminders(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Remind each active booking starting in the next 24 hours once, retrying a failed send."""
    bookings = (
        (
            await db.execute(
                select(Booking)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Booking.deleted_at.is_(None),
                    Booking.reminded_at.is_(None),
                    Booking.status == "confirmed",
                    Slot.starts_at > now,
                    Slot.starts_at <= now + _REMINDER_WINDOW,
                    Booking.business_id.in_(select(Business.id).where(serving(now))),
                )
            )
        )
        .scalars()
        .all()
    )
    reminded = 0
    for booking in bookings:
        if await notifier.on_booking_reminder(db, booking.id) is Outcome.FAILED:
            continue
        booking.reminded_at = now
        # commit each marker before the next send, so an interrupted run never repeats one
        await db.commit()
        reminded += 1
    return reminded
