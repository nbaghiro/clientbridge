from datetime import UTC, date, datetime, timedelta

from sqlalchemy import ColumnElement, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_can_act_as
from clientbridge.core.errors import (
    AppError,
    CardDeclined,
    Conflict,
    NotFound,
    PaymentActionRequired,
)
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Addon, Booking, Slot
from clientbridge.schemas.bookings import BookingCreate, BookingOut, BookingPatch, DepositOut
from clientbridge.services import ledger
from clientbridge.services.business import business_tz
from clientbridge.services.catalog import deposit_cents, load_item
from clientbridge.services.clients import load_client
from clientbridge.services.hours import is_within_hours, open_windows
from clientbridge.services.payments import (
    default_method_ref,
    open_booking_deposit,
    resolve_saved_method_ref,
)
from clientbridge.services.staff import load_staff

_OVERLAP = "that staff member is already booked at that time"
_RESOURCE_BUSY = "that resource is already booked at that time"
_OUTSIDE_HOURS = "outside the provider's available hours"
_CLASS_FULL = "that class is full"
_ALREADY_IN_CLASS = "you already have a booking for this class"
_TERMINAL = frozenset({"completed", "canceled", "no_show"})


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
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
    )


def booked_count_expr() -> ColumnElement[int]:
    """Seats taken on a slot: its live (not canceled, not deleted) bookings."""
    return (
        select(func.count(Booking.id))
        .where(
            Booking.slot_id == Slot.id,
            Booking.status != "canceled",
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
    # Lock the staff's bookings so conflict and capacity checks are atomic with the insert.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"{business_id}:{staff_id}"},
    )
    ends_at = starts_at + timedelta(minutes=item.duration_min or 0)
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
    )
    db.add(booking)
    await db.flush()
    return booking, slot


async def release_slot(db: AsyncSession, slot: Slot) -> None:
    """Cancel the slot once its last live booking is gone."""
    if await booked_count(db, slot.id) == 0:
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

        # A terminal booking is frozen — only an idempotent re-set of the same status is allowed.
        if booking.status in _TERMINAL and (
            data.starts_at is not None
            or (data.status is not None and data.status != booking.status)
        ):
            raise Conflict(f"a {booking.status} booking can't be modified")

        async def run(cmd: Command) -> BookingOut:
            if data.starts_at is not None:
                duration = slot.ends_at - slot.starts_at
                new_ends = data.starts_at + duration
                if not await is_within_hours(
                    self.db, slot.staff_id, self.biz, data.starts_at, new_ends
                ):
                    raise Conflict(_OUTSIDE_HOURS)
                item = await self._item(slot.item_id, require_active=False)
                await assert_free(
                    self.db, self.biz, item, slot.staff_id, data.starts_at, new_ends, slot.id
                )
                slot.starts_at = data.starts_at
                slot.ends_at = new_ends
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
                    slot.status = "canceled"  # frees the slot (excluded from the overlap check)
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
    db: AsyncSession, business_id: str, item: Item, staff_id: str, on_date: date
) -> list[datetime]:
    """Bookable start times for the item and staff on a date, in UTC; none until hours are set."""
    duration = item.duration_min
    if duration is None or duration <= 0:
        return []
    windows = await open_windows(db, staff_id, business_id, on_date)
    if not windows:
        return []
    tz = await business_tz(db, business_id)
    step = duration + item.buffer_before_min + item.buffer_after_min
    slots: list[datetime] = []
    for window_start, window_end in windows:
        # window times are local wall-clock; anchor them in the business tz, then work in UTC
        start = datetime.combine(on_date, window_start, tzinfo=tz).astimezone(UTC)
        limit = datetime.combine(on_date, window_end, tzinfo=tz).astimezone(UTC)
        while start + timedelta(minutes=duration) <= limit:
            end = start + timedelta(minutes=duration)
            if not await conflicting_slot(db, business_id, item, staff_id, start, end):
                slots.append(start)
            start += timedelta(minutes=step)
    return slots
