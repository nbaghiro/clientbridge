import secrets
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_can_act_as
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.catalog import Item
from clientbridge.models.scheduling import Booking, BookingSource, Recurrence, Slot
from clientbridge.schemas.programs import (
    EnrolmentCancel,
    EnrolmentCancelOut,
    EnrolmentCreate,
    EnrolmentOut,
    ProgramCancelOut,
    ProgramCreate,
    ProgramOut,
    ProgramSession,
)
from clientbridge.services.billing import issue_enrolment_invoice, void_enrolment_invoice
from clientbridge.services.bookings import (
    ALREADY_IN_CLASS,
    MAX_OCCURRENCES,
    OVERLAP,
    assert_subject,
    booked_count,
    enrolment,
    expand_occurrences,
    has_seat,
    is_class,
    is_program,
    lock_bookings,
    lock_staff,
    open_class_slot,
    slot_problem,
)
from clientbridge.services.business import business_tz, load_staff
from clientbridge.services.catalog import assert_offers, deposit_cents, load_item
from clientbridge.services.clients import load_client
from clientbridge.services.deliveries import delivery_key
from clientbridge.services.notifications import queued_notifier
from clientbridge.services.payments import cancel_open_deposits, refund_deposit
from clientbridge.services.resources import choose_resource, lock_resources, lost_race

_CLASS_ONLY = "a schedule lays out the sessions of a class"
_DAYS = "a program's schedule holds one session for each of its days"
_TOO_LONG = f"a schedule can hold at most {MAX_OCCURRENCES} sessions; end it sooner"
_STARTED = "a schedule starts in the future"
_BUSY = "the instructor is away, off or already booked on one of those days"
_NO_ROOM = "none of the class's rooms or equipment is free on one of those days"
_NOT_PROGRAM = "only a class with a number of days is enrolled in as a whole"
_ENDED = "this schedule isn't taking enrolments"
_OVER = "this program has no sessions left"
_FULL = "a day of this program is full"
_ENROLLED = "there are enrolments; cancel them before the schedule"
_NOT_ENROLLED = "no enrolment in this program for that client"
_PAID = "money was taken on this enrolment's invoice; refund it before canceling"
_LIVE = ("pending", "confirmed")


async def sessions_of(
    db: AsyncSession, business_id: str, program_id: str, *, after: datetime
) -> list[Slot]:
    """A schedule's sessions still on that start after `after`, in order."""
    rows = await db.scalars(
        scoped(Slot, business_id)
        .where(
            Slot.recurrence_id == program_id,
            Slot.status != "canceled",
            Slot.starts_at > after,
        )
        .order_by(Slot.starts_at, Slot.id)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def enrol(
    db: AsyncSession,
    business_id: str,
    program: Recurrence,
    item: Item,
    *,
    client_id: str,
    subject_id: str | None,
    source: BookingSource,
    after: datetime,
    cmd: Command,
) -> list[Booking]:
    """Book every session ahead or none; the first carries the price, deposit and invoice."""
    if program.staff_id is not None:
        await lock_staff(db, business_id, program.staff_id)
    await db.refresh(program)
    if program.status != "active":
        raise Conflict(_ENDED, code="program_closed")
    sessions = await sessions_of(db, business_id, program.id, after=after)
    if not sessions:
        raise Conflict(_OVER, code="program_over")
    await lock_staff(db, business_id, *{s.staff_id for s in sessions})
    for slot in sessions:
        if await has_seat(db, business_id, slot.id, client_id, subject_id):
            raise Conflict(ALREADY_IN_CLASS, code="already_enrolled")
        if await booked_count(db, slot.id) >= slot.capacity:
            raise Conflict(
                _FULL, code="program_full", detail={"starts_at": slot.starts_at.isoformat()}
            )
    deposit = deposit_cents(item) if item.deposit_type != "none" else 0
    bookings: list[Booking] = []
    for index, slot in enumerate(sessions):
        first = index == 0
        bookings.append(
            Booking(
                id=new_id("booking"),
                business_id=business_id,
                slot_id=slot.id,
                starts_at=slot.starts_at,
                staff_id=slot.staff_id,
                client_id=client_id,
                subject_id=subject_id,
                status="confirmed",
                source=source,
                price_cents=item.price_cents if first else 0,
                deposit_amount_cents=deposit if first else 0,
                deposit_status="pending" if first and deposit > 0 else "none",
                confirmed_at=clock.now(),
                manage_token=secrets.token_urlsafe(18),
            )
        )
    db.add_all(bookings)
    await db.flush()
    await issue_enrolment_invoice(db, bookings[0], cmd)
    return bookings


async def withdraw(
    db: AsyncSession, gateway: PaymentGateway, bookings: Sequence[Booking], cmd: Command
) -> int:
    """Cancel an enrolment's days, voiding its invoice and refunding a paid deposit."""
    for booking in bookings:
        if not await void_enrolment_invoice(db, booking, cmd):
            raise Conflict(_PAID, code="enrolment_paid")
    refunded = 0
    now = clock.now()
    for booking in bookings:
        if booking.deposit_status == "collected":
            refunded += await refund_deposit(db, gateway, booking)
        elif booking.deposit_status == "pending":
            await cancel_open_deposits(db, gateway, booking)
            booking.deposit_status = "none"
        booking.status = "canceled"
        booking.canceled_at = now
    await db.flush()
    return refunded


class ProgramService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def create(self, data: ProgramCreate, idempotency_key: str | None) -> ProgramOut:
        """Lay out a class's sessions, every one or none; a busy day refuses the whole schedule."""
        assert_can_act_as(self.principal, data.staff_id)
        item = await load_item(self.db, self.biz, data.item_id)
        if not is_class(item) or item.duration_min is None or item.duration_min <= 0:
            raise Unprocessable(_CLASS_ONLY, code="schedule_class_only")
        await load_staff(self.db, self.biz, data.staff_id)
        assert_offers(item, data.staff_id)
        tz = await business_tz(self.db, self.biz)
        local = data.starts_at.astimezone(tz)
        days = expand_occurrences(
            start_date=local.date(),
            frequency="week",
            interval=1,
            byday=data.byday,
            count=data.count,
            until=data.until,
            cap=MAX_OCCURRENCES + 1,
        )
        if len(days) > MAX_OCCURRENCES:
            raise Unprocessable(_TOO_LONG, code="recurrence_too_long")
        if is_program(item) and len(days) != item.session_count:
            raise Unprocessable(_DAYS, code="program_days")
        length = timedelta(minutes=item.duration_min)
        starts = [datetime.combine(d, local.time(), tzinfo=tz).astimezone(UTC) for d in days]
        if not starts or starts[0] <= clock.now():
            raise Unprocessable(_STARTED, code="schedule_past")

        async def run(cmd: Command) -> ProgramOut:
            await lock_staff(self.db, self.biz, data.staff_id)
            await lock_resources(self.db, self.biz, *item.resource_ids)
            rooms: list[str | None] = []
            for start in starts:
                problem = await slot_problem(
                    self.db, self.biz, item, data.staff_id, start, start + length
                )
                taken = await open_class_slot(self.db, self.biz, item.id, data.staff_id, start)
                if problem is not None or taken is not None:
                    raise Conflict(
                        _BUSY,
                        code="schedule_conflict",
                        detail={
                            "starts_at": start.isoformat(),
                            "problem": problem.problem if problem else "overlap",
                        },
                    )
                choice = await choose_resource(self.db, self.biz, item, start, start + length)
                if choice.refusal is not None:
                    raise _no_room(start)
                rooms.append(choice.held)
            program = Recurrence(
                id=new_id("recurrence"),
                business_id=self.biz,
                item_id=item.id,
                staff_id=data.staff_id,
                frequency="week",
                interval=1,
                byday=data.byday,
                count=data.count,
                until=data.until,
                status="active",
            )
            self.db.add(program)
            await self.db.flush()
            slots = [
                Slot(
                    id=new_id("slot"),
                    business_id=self.biz,
                    item_id=item.id,
                    staff_id=data.staff_id,
                    recurrence_id=program.id,
                    resource_id=room,
                    starts_at=start,
                    ends_at=start + length,
                    capacity=item.capacity or 1,
                    status="scheduled",
                )
                for start, room in zip(starts, rooms, strict=True)
            ]
            self.db.add_all(slots)
            try:
                await self.db.flush()
            except IntegrityError as exc:
                raise lost_race(exc, Conflict(OVERLAP, code="schedule_conflict")) from exc
            cmd.record("program.create", entity_type="recurrence", entity_id=program.id)
            return _out(program, slots)

        return await run_command(
            self.db,
            self.principal,
            action="program.create",
            run=run,
            response_model=ProgramOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def cancel(self, program_id: str) -> ProgramCancelOut:
        """Call off the sessions ahead; refused while anyone is enrolled, so no one loses a seat."""
        program = await self._program(program_id)
        assert_can_act_as(self.principal, program.staff_id)
        if program.status == "canceled":
            raise Conflict("this schedule is already canceled", code="program_closed")

        async def run(cmd: Command) -> ProgramCancelOut:
            if program.staff_id is not None:
                await lock_staff(self.db, self.biz, program.staff_id)
            await self.db.refresh(program)
            if program.status == "canceled":
                raise Conflict("this schedule is already canceled", code="program_closed")
            sessions = await sessions_of(self.db, self.biz, program.id, after=clock.now())
            await lock_staff(self.db, self.biz, *{s.staff_id for s in sessions})
            for slot in sessions:
                if await booked_count(self.db, slot.id) > 0 or await self._waiting(slot.id):
                    raise Conflict(_ENROLLED, code="program_enrolled")
            for slot in sessions:
                slot.status = "canceled"
            past = await self.db.scalar(
                scoped(Slot, self.biz)
                .with_only_columns(Slot.id)
                .where(Slot.recurrence_id == program.id, Slot.status != "canceled")
                .limit(1)
            )
            program.status = "ended" if past is not None else "canceled"
            await self.db.flush()
            cmd.record("program.cancel", entity_type="recurrence", entity_id=program.id)
            return ProgramCancelOut(
                id=program.id, status=program.status, canceled=[s.id for s in sessions]
            )

        return await run_command(
            self.db,
            self.principal,
            action="program.cancel",
            run=run,
            response_model=ProgramCancelOut,
        )

    async def enrol(
        self, program_id: str, data: EnrolmentCreate, idempotency_key: str | None
    ) -> EnrolmentOut:
        program = await self._program(program_id)
        assert_can_act_as(self.principal, program.staff_id)
        item = await load_item(self.db, self.biz, program.item_id, require_active=False)
        if not is_program(item):
            raise Unprocessable(_NOT_PROGRAM, code="not_a_program")
        await load_client(self.db, self.biz, data.client_id)
        if data.subject_id is not None:
            await assert_subject(self.db, self.biz, data.subject_id, data.client_id)

        async def run(cmd: Command) -> EnrolmentOut:
            bookings = await enrol(
                self.db,
                self.biz,
                program,
                item,
                client_id=data.client_id,
                subject_id=data.subject_id,
                source="manual",
                after=clock.now(),
                cmd=cmd,
            )
            cmd.record("program.enrol", entity_type="recurrence", entity_id=program.id)
            if data.notify:
                await queued_notifier(
                    self.db, self.biz, delivery_key("recurrence", program.id, each=True)
                ).on_series_booked(self.db, [b.id for b in bookings], "booked")
            return EnrolmentOut(
                program_id=program.id,
                client_id=data.client_id,
                subject_id=data.subject_id,
                booking_ids=[b.id for b in bookings],
            )

        return await run_command(
            self.db,
            self.principal,
            action="program.enrol",
            run=run,
            response_model=EnrolmentOut,
            idempotency_key=idempotency_key,
            request={"program_id": program_id, **data.model_dump(mode="json")},
        )

    async def withdraw(
        self, program_id: str, data: EnrolmentCancel, gateway: PaymentGateway
    ) -> EnrolmentCancelOut:
        """Cancel every day of an enrolment still to come, and refund its paid deposit."""
        program = await self._program(program_id)
        assert_can_act_as(self.principal, program.staff_id)
        ahead = [
            b
            for b in await enrolment(self.db, self.biz, program.id, data.client_id, data.subject_id)
            if b.starts_at > clock.now()
        ]
        if not ahead:
            raise NotFound(_NOT_ENROLLED)

        async def run(cmd: Command) -> EnrolmentCancelOut:
            await lock_staff(self.db, self.biz, *{b.staff_id for b in ahead if b.staff_id})
            live = [
                b
                for b in await lock_bookings(self.db, self.biz, [b.id for b in ahead])
                if b.status in _LIVE
            ]
            refunded = await withdraw(self.db, gateway, live, cmd)
            cmd.record("program.withdraw", entity_type="recurrence", entity_id=program.id)
            if data.notify:
                await queued_notifier(
                    self.db, self.biz, delivery_key("recurrence", program.id, each=True)
                ).on_series_booked(self.db, [b.id for b in live], "canceled")
            return EnrolmentCancelOut(
                program_id=program.id, canceled=[b.id for b in live], refunded_cents=refunded
            )

        return await run_command(
            self.db,
            self.principal,
            action="program.withdraw",
            run=run,
            response_model=EnrolmentCancelOut,
        )

    async def _waiting(self, slot_id: str) -> bool:
        found = await self.db.scalar(
            scoped(Booking, self.biz, soft_delete=True)
            .with_only_columns(Booking.id)
            .where(Booking.slot_id == slot_id, Booking.status == "waitlisted")
            .limit(1)
        )
        return found is not None

    async def _program(self, program_id: str) -> Recurrence:
        program = await self.db.scalar(
            scoped(Recurrence, self.biz).where(
                Recurrence.id == program_id, Recurrence.client_id.is_(None)
            )
        )
        if program is None:
            raise NotFound("schedule not found")
        return program


def _no_room(start: datetime) -> Conflict:
    return Conflict(
        _NO_ROOM,
        code="schedule_conflict",
        detail={"starts_at": start.isoformat(), "problem": "resource"},
    )


def _out(program: Recurrence, slots: Sequence[Slot]) -> ProgramOut:
    return ProgramOut(
        id=program.id,
        business_id=program.business_id,
        item_id=program.item_id,
        staff_id=program.staff_id,
        status=program.status,
        sessions=[
            ProgramSession(
                slot_id=s.id,
                starts_at=s.starts_at,
                ends_at=s.ends_at,
                capacity=s.capacity,
                resource_id=s.resource_id,
            )
            for s in slots
        ],
    )
