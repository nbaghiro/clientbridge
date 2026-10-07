import calendar
import secrets
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Exists, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_can_act_as, assert_role
from clientbridge.core.errors import (
    AppError,
    CardDeclined,
    Conflict,
    NotFound,
    PaymentActionRequired,
    Unprocessable,
)
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_update
from clientbridge.integrations.postmark import EmailSender
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.integrations.twilio import SmsSender
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Note, Subject
from clientbridge.models.messaging import Message
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Addon, Booking, Hours, Recurrence, Resource, Slot
from clientbridge.schemas.bookings import (
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
)
from clientbridge.services import ledger
from clientbridge.services.business import business_tz
from clientbridge.services.catalog import deposit_cents, load_item
from clientbridge.services.clients import load_client
from clientbridge.services.messaging import dispatch_message, open_thread
from clientbridge.services.notifications import Notifier, reminder_message
from clientbridge.services.payments import (
    default_method_ref,
    open_booking_deposit,
    refund_deposit,
    resolve_saved_method_ref,
)
from clientbridge.services.staff import load_staff

_OVERLAP = "that staff member is already booked at that time"
_RESOURCE_BUSY = "that resource is already booked at that time"
_OUTSIDE_HOURS = "outside the provider's available hours"
_CLASS_FULL = "that class is full"
_CLOSED = "the business is closed then"
_AWAY = "that staff member is away then"
_PAST = "that time has already passed"
_CLASS_MOVE = "a class session moves as a whole; change its time from the class"
_MIN_VISIT = timedelta(minutes=5)
_ALREADY_IN_CLASS = "you already have a booking for this class"
_TERMINAL = frozenset({"completed", "canceled", "no_show"})
_CLOSED_OR_WAITING = ("completed", "canceled", "no_show", "waitlisted")


async def _booking_out(db: AsyncSession, booking: Booking, slot: Slot) -> BookingOut:
    return BookingOut(
        id=booking.id,
        business_id=booking.business_id,
        slot_id=slot.id,
        client_id=booking.client_id,
        staff_id=booking.staff_id,
        item_id=slot.item_id,
        status=booking.status,
        source=booking.source,
        price_cents=booking.price_cents,
        deposit_amount_cents=booking.deposit_amount_cents,
        deposit_status=booking.deposit_status,
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
                booked_count_expr() >= Slot.capacity,
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
        raise Conflict(_OVERLAP)


async def conflicting_resource(
    db: AsyncSession,
    business_id: str,
    resource_id: str,
    starts_at: datetime,
    ends_at: datetime,
    exclude: str | None = None,
) -> bool:
    """Whether a live slot already holds this resource over the window."""
    q = scoped(Slot, business_id).where(
        Slot.resource_id == resource_id,
        Slot.status != "canceled",
        Slot.starts_at < ends_at,
        Slot.ends_at > starts_at,
    )
    if exclude is not None:
        q = q.where(Slot.id != exclude)
    return (await db.execute(q.limit(1))).first() is not None


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


async def _client_has_seat(
    db: AsyncSession, business_id: str, slot_id: str, client_id: str
) -> bool:
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
    db: AsyncSession, business_id: str, staff_id: str, start: datetime, end: datetime
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
    return (await db.execute(q)).scalars().first()


def _verdict(problem: Problem, message: str, reason: str | None = None) -> BookingCheck:
    return BookingCheck(ok=False, problem=problem, reason=reason, message=message)


async def slot_problem(
    db: AsyncSession,
    business_id: str,
    item: Item,
    staff_id: str,
    starts_at: datetime,
    ends_at: datetime,
    *,
    exclude: str | None = None,
    resource_id: str | None = None,
) -> BookingCheck | None:
    """Why a visit can't take this window, most fundamental reason first; None when it can."""
    away = await blocking_exception(db, business_id, staff_id, starts_at, ends_at)
    if away is not None:
        if away.staff_id is None:
            return _verdict("closed", _CLOSED, away.reason)
        return _verdict("time_off", _AWAY, away.reason)
    if not await is_within_hours(db, staff_id, business_id, starts_at, ends_at):
        return _verdict("off_hours", _OUTSIDE_HOURS)
    if await conflicting_slot(db, business_id, item, staff_id, starts_at, ends_at, exclude):
        return _verdict("overlap", _OVERLAP)
    if resource_id is not None and await conflicting_resource(
        db, business_id, resource_id, starts_at, ends_at, exclude
    ):
        return _verdict("resource", _RESOURCE_BUSY)
    return None


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
    resource_id: str | None = None,
    recurrence_id: str | None = None,
    dedupe_client: bool = False,
) -> tuple[Booking, Slot]:
    """Create a confirmed booking under the scheduling invariant (staff and online paths)."""
    await _lock_staff(db, business_id, staff_id)
    ends_at = starts_at + timedelta(minutes=item.duration_min or 0)
    away = await blocking_exception(db, business_id, staff_id, starts_at, ends_at)
    if away is not None:
        raise Conflict(_CLOSED if away.staff_id is None else _AWAY)
    if not await is_within_hours(db, staff_id, business_id, starts_at, ends_at):
        raise Conflict(_OUTSIDE_HOURS)
    is_class = item.kind == "class" and item.capacity is not None and item.capacity > 1
    slot = None
    if is_class:
        slot = await open_class_slot(db, business_id, item.id, staff_id, starts_at)
        if slot is not None:
            if dedupe_client and await _client_has_seat(db, business_id, slot.id, client_id):
                raise Conflict(_ALREADY_IN_CLASS)
            if await booked_count(db, slot.id) >= slot.capacity:
                raise Conflict(_CLASS_FULL)
    if slot is None:
        await assert_free(db, business_id, item, staff_id, starts_at, ends_at)
        if resource_id is not None and await conflicting_resource(
            db, business_id, resource_id, starts_at, ends_at
        ):
            raise Conflict(_RESOURCE_BUSY)
        slot = Slot(
            id=new_id("slot"),
            business_id=business_id,
            item_id=item.id,
            staff_id=staff_id,
            resource_id=resource_id,
            recurrence_id=recurrence_id,
            starts_at=starts_at,
            ends_at=ends_at,
            capacity=item.capacity if is_class and item.capacity is not None else 1,
            status="scheduled",
        )
        db.add(slot)
        try:
            # the exclusion constraint backstops a concurrent overlapping insert
            await db.flush()
        except IntegrityError as exc:
            raise Conflict(_OVERLAP) from exc
    deposit = deposit_cents(item) if item.deposit_type != "none" else 0
    booking = Booking(
        id=new_id("booking"),
        business_id=business_id,
        slot_id=slot.id,
        staff_id=staff_id,
        client_id=client_id,
        subject_id=subject_id,
        status="confirmed",
        source=source,
        price_cents=item.price_cents,
        deposit_amount_cents=deposit_cents(item),
        deposit_status="pending" if deposit > 0 else "none",
        confirmed_at=datetime.now(UTC),
        manage_token=secrets.token_urlsafe(18),
    )
    db.add(booking)
    await db.flush()
    return booking, slot


async def _lock_staff(db: AsyncSession, business_id: str, staff_id: str) -> None:
    """Serialise booking writes per member so the conflict check is atomic with the write."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"{business_id}:{staff_id}"}
    )


async def load_resource(db: AsyncSession, business_id: str, resource_id: str) -> Resource:
    row = (
        await db.execute(scoped(Resource, business_id).where(Resource.id == resource_id))
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("room or station not found")
    if not row.active:
        raise Conflict("that room or station is switched off for new bookings")
    return row


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


async def settle_deposit(db: AsyncSession, booking_id: str) -> str | None:
    """Collect a settled deposit and apply it to the open invoice, or forfeit it after a no-show."""
    booking = await db.get(Booking, booking_id)
    if booking is None:
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
        if data.resource_id is not None:
            await load_resource(self.db, self.biz, data.resource_id)

        async def run(cmd: Command) -> BookingOut:
            booking, slot = await create_booking_core(
                self.db,
                self.biz,
                item=item,
                staff_id=data.staff_id,
                starts_at=data.starts_at,
                client_id=data.client_id,
                source="manual",
                subject_id=data.subject_id,
                resource_id=data.resource_id,
            )
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
            cmd.record("booking.create", entity_type="booking", entity_id=booking.id)
            return await _booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.create",
            run=run,
            response_model=BookingOut,
            idempotency_key=idempotency_key,
        )

    async def patch(self, booking_id: str, data: BookingPatch) -> BookingOut:
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)
        moving = self._moves(data, slot)

        # A terminal booking is frozen — only an idempotent re-set of the same status is allowed.
        if booking.status in _TERMINAL and (
            moving or (data.status is not None and data.status != booking.status)
        ):
            raise Conflict(f"a {booking.status} booking can't be modified")
        target = await self._target(data, slot) if moving else None

        async def run(cmd: Command) -> BookingOut:
            if target is not None:
                staff_id, starts_at, ends_at, resource_id = target
                await _lock_staff(self.db, self.biz, staff_id)
                item = await self._item(slot.item_id, require_active=False)
                problem = await slot_problem(
                    self.db,
                    self.biz,
                    item,
                    staff_id,
                    starts_at,
                    ends_at,
                    exclude=slot.id,
                    resource_id=resource_id,
                )
                if problem is not None:
                    raise Conflict(problem.message or _OVERLAP)
                slot.starts_at, slot.ends_at = starts_at, ends_at
                slot.staff_id, slot.resource_id = staff_id, resource_id
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
                    raise Conflict(_OVERLAP) from exc
                cmd.record("booking.reschedule", entity_type="booking", entity_id=booking.id)
            if data.status is not None:
                booking.status = data.status
                if data.status in ("canceled", "completed") and booking.deposit_status == "pending":
                    booking.deposit_status = "none"  # nothing was collected and none is due now
                if data.status == "canceled":
                    booking.canceled_at = datetime.now(UTC)
                    await release_slot(self.db, slot)  # a class keeps its slot for the rest
                elif data.status == "completed":
                    booking.completed_at = datetime.now(UTC)
                    slot.status = "completed"
                elif data.status == "no_show":
                    await self._forfeit_deposit(cmd, booking)
                cmd.record(f"booking.{data.status}", entity_type="booking", entity_id=booking.id)
            await self.db.flush()
            return await _booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.patch",
            run=run,
            response_model=BookingOut,
        )

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
            staff_id, starts_at, ends_at, resource_id = await self._target(data, slot)
        except Conflict as exc:
            return _verdict("class" if exc.message == _CLASS_MOVE else "past", exc.message)
        item = await self._item(slot.item_id, require_active=False)
        problem = await slot_problem(
            self.db,
            self.biz,
            item,
            staff_id,
            starts_at,
            ends_at,
            exclude=slot.id,
            resource_id=resource_id,
        )
        return problem or BookingCheck(ok=True)

    def _moves(self, data: BookingMove, slot: Slot) -> bool:
        return (
            data.starts_at is not None
            or data.ends_at is not None
            or (data.staff_id is not None and data.staff_id != slot.staff_id)
            or ("resource_id" in data.model_fields_set and data.resource_id != slot.resource_id)
        )

    async def _target(
        self, data: BookingMove, slot: Slot
    ) -> tuple[str, datetime, datetime, str | None]:
        """The member, window and room a move lands on, validated before any check runs."""
        staff_id = data.staff_id or slot.staff_id
        if staff_id != slot.staff_id:
            self._assert_can_act_as(staff_id)
            await self._staff(staff_id)
            if slot.capacity > 1:
                raise Conflict(_CLASS_MOVE)
        starts_at = data.starts_at or slot.starts_at
        ends_at = data.ends_at or starts_at + (slot.ends_at - slot.starts_at)
        if ends_at - starts_at < _MIN_VISIT:
            raise Unprocessable("a visit must end at least five minutes after it starts")
        if starts_at != slot.starts_at and starts_at < datetime.now(UTC):
            raise Conflict(_PAST)
        resource_id = (
            data.resource_id if "resource_id" in data.model_fields_set else slot.resource_id
        )
        if resource_id is not None and resource_id != slot.resource_id:
            await load_resource(self.db, self.biz, resource_id)
        return staff_id, starts_at, ends_at, resource_id

    async def reminder(self, booking_id: str) -> ReminderPreview:
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        slot = await self._slot(booking.slot_id)
        message = await reminder_message(self.db, booking)
        if message is None:
            raise NotFound("booking not found")
        return ReminderPreview(
            subject=message[0],
            body=message[1],
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

        async def run(cmd: Command) -> BookingOut:
            if booking.checked_in_at is None:
                booking.checked_in_at = datetime.now(UTC)
                await self.db.flush()
                cmd.record("booking.check_in", entity_type="booking", entity_id=booking.id)
            return await _booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.check_in",
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
            raise Conflict("connect your Stripe account before taking payments")
        account_id = business.stripe_account_id
        client = await self._client(booking.client_id)
        amount = booking.deposit_amount_cents
        fee_bps = get_settings().platform_fee_bps
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
                fee_bps=fee_bps,
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
        )

    async def _forfeit_deposit(self, cmd: Command, booking: Booking) -> None:
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
                fee_bps=get_settings().platform_fee_bps,
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
                select(Payment.id)
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

    async def remove_addon(self, booking_id: str, addon_id: str) -> BookingOut:
        """Drop a product the client added online, before the visit is invoiced."""
        booking = await self._booking(booking_id)
        self._assert_can_act_as(booking.staff_id)
        if booking.invoice_id is not None:
            raise Conflict("this visit is already invoiced")
        addon = (
            await self.db.execute(
                scoped(Addon, self.biz).where(Addon.id == addon_id, Addon.booking_id == booking.id)
            )
        ).scalar_one_or_none()
        if addon is None:
            raise NotFound("add-on not found")
        slot = await self._slot(booking.slot_id)

        async def run(cmd: Command) -> BookingOut:
            await self.db.delete(addon)
            await self.db.flush()
            cmd.record("booking.addon_remove", entity_type="booking", entity_id=booking.id)
            return await _booking_out(self.db, booking, slot)

        return await run_command(
            self.db,
            self.principal,
            action="booking.addon_remove",
            run=run,
            response_model=BookingOut,
        )

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
) -> list[datetime]:
    """Bookable start times for the item and staff on a date, in UTC; none until hours are set."""
    duration = item.duration_min
    if duration is None or duration <= 0:
        return []
    windows = await open_windows(db, staff_id, business_id, on_date)
    if not windows:
        return []
    tz = await business_tz(db, business_id)
    day = datetime.combine(on_date, time.min, tzinfo=tz).astimezone(UTC)
    away = await exceptions_between(db, business_id, staff_id, day, day + timedelta(days=1))
    step = step_min or duration + item.buffer_before_min + item.buffer_after_min
    slots: list[datetime] = []
    for window_start, window_end in windows:
        # window times are local wall-clock; anchor them in the business tz, then work in UTC
        start = datetime.combine(on_date, window_start, tzinfo=tz).astimezone(UTC)
        limit = datetime.combine(on_date, window_end, tzinfo=tz).astimezone(UTC)
        while start + timedelta(minutes=duration) <= limit:
            end = start + timedelta(minutes=duration)
            blocked = any(a.starts_at < end and a.ends_at > start for a in away)
            if not blocked and not await conflicting_slot(
                db, business_id, item, staff_id, start, end
            ):
                slots.append(start)
            start += timedelta(minutes=step)
    return slots


class _Window:
    def __init__(self, starts_at: datetime, ends_at: datetime, reason: str | None) -> None:
        self.starts_at = starts_at
        self.ends_at = ends_at
        self.reason = reason


async def exceptions_between(
    db: AsyncSession, business_id: str, staff_id: str | None, start: datetime, end: datetime
) -> list[_Window]:
    """Closures, plus this member's time off when one is named, overlapping the range."""
    who: ColumnElement[bool] = Hours.staff_id.is_(None)
    if staff_id is not None:
        who = or_(who, Hours.staff_id == staff_id)
    rows = (
        (
            await db.execute(
                scoped(Hours, business_id).where(
                    Hours.basis == "exception",
                    who,
                    Hours.starts_at < end,
                    Hours.ends_at > start,
                )
            )
        )
        .scalars()
        .all()
    )
    return [
        _Window(r.starts_at, r.ends_at, r.reason)
        for r in rows
        if r.starts_at is not None and r.ends_at is not None
    ]


_WEEKDAY_CODES = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
_WEEKDAY_NAMES = {v: k for k, v in _WEEKDAY_CODES.items()}
_SKIPPED = "left out when the series was booked"
_MAX_OCCURRENCES = 60  # a full year of weekly + headroom; caps runaway/unbounded rules


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
    frequency: str,
    interval: int,
    byday: Sequence[str] | None,
    count: int | None,
    until: date | None,
    monthly_by: str = "date",
) -> list[date]:
    """Occurrence dates for a rule, bounded by count, until and a hard cap."""
    interval = max(1, interval)
    limit = min(count if count is not None else _MAX_OCCURRENCES, _MAX_OCCURRENCES)
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
        if item.duration_min is None or item.duration_min <= 0:
            raise AppError("that service has no duration and can't be booked", status_code=422)
        await load_client(self.db, self.biz, data.client_id)
        await load_staff(self.db, self.biz, data.staff_id)

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
        )
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
                            resource_id=data.resource_id,
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
        tz = await business_tz(self.db, self.biz)
        visits = await self._upcoming(recurrence.id, data.scope, data.from_date, tz)
        new_time = time.fromisoformat(data.time) if data.time is not None else None

        async def run(cmd: Command) -> RecurrenceChangeOut:
            moved: list[str] = []
            skipped: list[RecurrenceOccurrence] = []
            for booking, slot in visits:
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
                await _lock_staff(self.db, self.biz, staff_id)
                problem = (
                    _verdict("past", _PAST)
                    if starts_at < datetime.now(UTC)
                    else await slot_problem(
                        self.db,
                        self.biz,
                        item,
                        staff_id,
                        starts_at,
                        ends_at,
                        exclude=slot.id,
                        resource_id=slot.resource_id,
                    )
                )
                if problem is not None:
                    skipped.append(
                        RecurrenceOccurrence(
                            starts_at=starts_at, booking_id=booking.id, skipped=problem.message
                        )
                    )
                    continue
                slot.starts_at, slot.ends_at, slot.staff_id = starts_at, ends_at, staff_id
                if booking.staff_id != staff_id:
                    booking.staff_id = staff_id
                    await self.db.execute(
                        scoped_update(Addon, self.biz)
                        .where(Addon.booking_id == booking.id)
                        .values(staff_id=staff_id)
                    )
                await self.db.flush()
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
        visits = await self._upcoming(recurrence.id, scope, data.from_date, tz, strict=False)

        async def run(cmd: Command) -> RecurrenceCancelOut:
            refunded = 0
            canceled: list[str] = []
            now = datetime.now(UTC)
            for booking, slot in visits:
                if booking.deposit_status == "collected":
                    refunded += await refund_deposit(self.db, gateway, booking)
                elif booking.deposit_status == "pending":
                    booking.deposit_status = "none"
                booking.status = "canceled"
                booking.canceled_at = now
                await release_slot(self.db, slot)
                canceled.append(booking.id)
            remaining = await self._upcoming(recurrence.id, "all", None, tz, strict=False)
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
        recurrence_id: str,
        scope: str,
        from_date: date | None,
        tz: ZoneInfo,
        *,
        strict: bool = True,
    ) -> list[tuple[Booking, Slot]]:
        """The series' live visits still ahead, narrowed to one date or from a date on."""
        rows = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True)
                .add_columns(Slot)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Slot.recurrence_id == recurrence_id,
                    Booking.status.in_(("pending", "confirmed")),
                    Slot.starts_at >= datetime.now(UTC),
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
    start_local, end_local = _as_utc(start).astimezone(tz), _as_utc(end).astimezone(tz)
    windows = await open_windows(db, staff_id, business_id, start_local.date())
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

    async def add(self, slot_id: str, data: RosterAdd) -> RosterEntry:
        slot = await self._session(slot_id)
        assert_can_act_as(self.principal, slot.staff_id)
        await load_client(self.db, self.biz, data.client_id)
        if data.subject_id is not None:
            await self._subject(data.subject_id, data.client_id)
        if slot.starts_at < datetime.now(UTC) - timedelta(hours=12):
            raise Conflict("that class has already happened")
        item = await load_item(self.db, self.biz, slot.item_id, require_active=False)

        async def run(cmd: Command) -> RosterEntry:
            await _lock_staff(self.db, self.biz, slot.staff_id)
            if await _client_has_seat(self.db, self.biz, slot.id, data.client_id):
                raise Conflict(_ALREADY_IN_CLASS)
            full = await booked_count(self.db, slot.id) >= slot.capacity
            deposit = deposit_cents(item) if item.deposit_type != "none" else 0
            booking = Booking(
                id=new_id("booking"),
                business_id=self.biz,
                slot_id=slot.id,
                staff_id=slot.staff_id,
                client_id=data.client_id,
                subject_id=data.subject_id,
                status="waitlisted" if full else "confirmed",
                source="manual",
                price_cents=item.price_cents,
                deposit_amount_cents=deposit,
                deposit_status="pending" if deposit > 0 else "none",
                confirmed_at=None if full else datetime.now(UTC),
            )
            self.db.add(booking)
            await self.db.flush()
            action = "class.waitlist" if full else "class.add"
            cmd.record(action, entity_type="booking", entity_id=booking.id)
            return await self._entry(booking)

        return await run_command(
            self.db, self.principal, action="class.add", run=run, response_model=RosterEntry
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

        async def run(cmd: Command) -> RosterEntry:
            if data.action == "check_in":
                if booking.status != "confirmed":
                    raise Conflict(f"a {booking.status} booking can't be checked in")
                booking.checked_in_at = booking.checked_in_at or datetime.now(UTC)
            elif data.action == "undo":
                await self._undo(booking)
            elif data.action == "no_show":
                if booking.status != "confirmed":
                    raise Conflict(f"a {booking.status} booking can't be marked a no-show")
                booking.status = "no_show"
                booking.checked_in_at = None
                await BookingService(self.db, self.principal, self.gateway)._forfeit_deposit(
                    cmd, booking
                )
            else:
                await _lock_staff(self.db, self.biz, slot.staff_id)
                if booking.status != "waitlisted":
                    raise Conflict("only someone on the waitlist can be given a seat")
                if await booked_count(self.db, slot.id) >= slot.capacity:
                    raise Conflict(_CLASS_FULL)
                booking.status = "confirmed"
                booking.confirmed_at = datetime.now(UTC)
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
        subject = business.name if business is not None else ""
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
                channel, to = ("sms", client.phone) if client.phone else ("email", client.email)
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
                ok = await dispatch_message(sms, email, channel, to, subject, data.body)
                note.status = "sent" if ok else "failed"
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
        found = (
            await self.db.execute(
                scoped(Subject, self.biz).where(
                    Subject.id == subject_id, Subject.client_id == client_id
                )
            )
        ).scalar_one_or_none()
        if found is None:
            raise NotFound("pet not found")

    async def _entry(self, booking: Booking) -> RosterEntry:
        position = None
        if booking.status == "waitlisted":
            ahead = await self.db.execute(
                select(func.count(Booking.id)).where(
                    Booking.slot_id == booking.slot_id,
                    Booking.status == "waitlisted",
                    Booking.deleted_at.is_(None),
                    Booking.id < booking.id,
                )
            )
            position = int(ahead.scalar_one()) + 1
        return RosterEntry(
            booking_id=booking.id,
            slot_id=booking.slot_id,
            client_id=booking.client_id,
            subject_id=booking.subject_id,
            status=booking.status,
            checked_in_at=booking.checked_in_at,
            waitlist_position=position,
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
            (
                await self.db.execute(
                    scoped(Staff, self.biz)
                    .where(Staff.status == "active")
                    .order_by(Staff.created_at)
                )
            )
            .scalars()
            .all()
        )
        since = datetime.now(UTC) - timedelta(days=30)
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
                    name=s.name,
                    title=s.title,
                    color=s.color,
                    bookable_online=s.bookable_online,
                )
                for s in staff
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
                business.booking_policy = BookingPolicy.model_validate(
                    merged.model_dump()
                ).model_dump()
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


async def run_reap_unpaid_bookings(db: AsyncSession, now: datetime) -> int:
    """Cancel online bookings still holding a slot past the deposit window without paying."""

    def deposits(status: str) -> Exists:
        return (
            select(Payment.id)
            .where(
                Payment.booking_id == Booking.id,
                Payment.kind == "deposit",
                Payment.status == status,
            )
            .exists()
        )

    bookings = (
        await db.execute(
            select(Booking, Slot)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(
                Booking.deleted_at.is_(None),
                Booking.source == "online",
                Booking.deposit_amount_cents > 0,
                Booking.status.not_in(_CLOSED_OR_WAITING),
                Booking.created_at < now - _UNPAID_TTL,
                deposits("pending"),
                ~deposits("succeeded"),
            )
        )
    ).all()
    for booking, slot in bookings:
        booking.status = "canceled"
        booking.canceled_at = now
        await release_slot(db, slot)
    await db.commit()
    return len(bookings)


async def run_reminders(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Remind each active booking starting in the next 24 hours, once."""
    bookings = (
        (
            await db.execute(
                select(Booking)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(
                    Booking.deleted_at.is_(None),
                    Booking.reminded_at.is_(None),
                    Booking.status.not_in(_CLOSED_OR_WAITING),
                    Slot.starts_at > now,
                    Slot.starts_at <= now + _REMINDER_WINDOW,
                )
            )
        )
        .scalars()
        .all()
    )
    for booking in bookings:
        await notifier.on_booking_reminder(db, booking.id)
        booking.reminded_at = now
    await db.commit()
    return len(bookings)
