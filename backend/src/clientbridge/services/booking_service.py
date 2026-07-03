from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Booking, Session
from clientbridge.schemas.bookings import BookingCreate, BookingOut, BookingPatch, DepositOut
from clientbridge.services.availability_service import is_within_availability
from clientbridge.services.payment_service import (
    default_method_ref,
    open_booking_deposit,
    resolve_saved_method_ref,
)

_OVERLAP = "that staff member is already booked at that time"
_RESOURCE_BUSY = "that resource is already booked at that time"
_OUTSIDE_HOURS = "outside the provider's available hours"
_CLASS_FULL = "that class is full"
_ALREADY_IN_CLASS = "you already have a booking for this class"
_TERMINAL = frozenset({"completed", "canceled", "no_show"})


def _deposit_cents(item: Item) -> int:
    """The deposit owed for a booking of this item: fixed cents, or a percent of its price."""
    if item.deposit_type == "none" or item.deposit_value is None:
        return 0
    if item.deposit_type == "fixed":
        return int(item.deposit_value)
    return round(item.price_cents * float(item.deposit_value) / 100)


def _booking_out(booking: Booking, session: Session) -> BookingOut:
    return BookingOut(
        id=booking.id,
        business_id=booking.business_id,
        session_id=session.id,
        client_id=booking.client_id,
        staff_id=booking.staff_id,
        item_id=session.item_id,
        status=booking.status,
        source=booking.source,
        price_cents=booking.price_cents,
        deposit_amount_cents=booking.deposit_amount_cents,
        deposit_status=booking.deposit_status,
        starts_at=session.starts_at,
        ends_at=session.ends_at,
    )


async def conflicting_session(
    db: AsyncSession,
    business_id: str,
    item: Item,
    staff_id: str,
    starts_at: datetime,
    ends_at: datetime,
    exclude: str | None = None,
) -> bool:
    """Whether a non-canceled session for this staff overlaps ``[starts_at, ends_at]`` once both
    sides are padded by their item's buffers. A class session with room at the same slot is
    joinable, not a conflict. The single source of truth the write path asserts on and the slot
    reader filters on."""
    new_start = starts_at - timedelta(minutes=item.buffer_before_min)
    new_end = ends_at + timedelta(minutes=item.buffer_after_min)
    q = (
        scoped(Session, business_id)
        .join(Item, Item.id == Session.item_id)
        .where(
            Session.staff_id == staff_id,
            Session.status != "canceled",
            Session.starts_at - func.make_interval(0, 0, 0, 0, 0, Item.buffer_before_min) < new_end,
            Session.ends_at + func.make_interval(0, 0, 0, 0, 0, Item.buffer_after_min) > new_start,
            or_(
                Session.booked_count >= Session.capacity,
                Session.item_id != item.id,
                Session.starts_at != starts_at,
                Session.ends_at != ends_at,
            ),
        )
    )
    if exclude is not None:
        q = q.where(Session.id != exclude)
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
    if await conflicting_session(db, business_id, item, staff_id, starts_at, ends_at, exclude):
        raise Conflict(_OVERLAP)


async def conflicting_resource(
    db: AsyncSession,
    business_id: str,
    resource_id: str,
    starts_at: datetime,
    ends_at: datetime,
    exclude: str | None = None,
) -> bool:
    """Whether a non-canceled session already holds this resource (room/equipment) over the
    ``[starts_at, ends_at]`` window. Plain overlap — a resource can't be in two places at once."""
    q = scoped(Session, business_id).where(
        Session.resource_id == resource_id,
        Session.status != "canceled",
        Session.starts_at < ends_at,
        Session.ends_at > starts_at,
    )
    if exclude is not None:
        q = q.where(Session.id != exclude)
    return (await db.execute(q.limit(1))).first() is not None


async def open_class_session(
    db: AsyncSession, business_id: str, item_id: str, staff_id: str, starts_at: datetime
) -> Session | None:
    q = scoped(Session, business_id).where(
        Session.item_id == item_id,
        Session.staff_id == staff_id,
        Session.starts_at == starts_at,
        Session.status != "canceled",
    )
    return (await db.execute(q)).scalars().first()


async def _client_has_seat(
    db: AsyncSession, business_id: str, session_id: str, client_id: str
) -> bool:
    """Whether this client already holds a live (non-canceled) booking on the given session — the
    self-service double-submit guard for shared class sessions."""
    q = (
        scoped(Booking, business_id, soft_delete=True)
        .where(
            Booking.session_id == session_id,
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
) -> tuple[Booking, Session]:
    """Mint a confirmed booking (+ its session) enforcing the scheduling invariant — availability,
    buffer/overlap conflicts, and class-capacity reuse — shared by the authed command path and the
    public online-booking surface so the rule has one home. The caller records/commits.

    ``dedupe_client`` rejects a client who already holds a seat on the class session (the
    self-service double-submit guard); the authed path leaves it off so staff can seat one client
    multiple times."""
    # Serialize all bookings for this staff within the transaction so the conflict + capacity checks
    # and the insert are atomic against a concurrent booker — the DB exclusion constraints only
    # catch raw overlap on a NEW session insert, not buffer erosion or a class-session increment.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"{business_id}:{staff_id}"},
    )
    ends_at = starts_at + timedelta(minutes=item.duration_min or 0)
    if not await is_within_availability(db, staff_id, business_id, starts_at, ends_at):
        raise Conflict(_OUTSIDE_HOURS)
    is_class = item.kind == "class" and item.capacity is not None and item.capacity > 1
    session = None
    if is_class:
        session = await open_class_session(db, business_id, item.id, staff_id, starts_at)
        if session is not None:
            if dedupe_client and await _client_has_seat(db, business_id, session.id, client_id):
                raise Conflict(_ALREADY_IN_CLASS)
            if session.booked_count >= session.capacity:
                raise Conflict(_CLASS_FULL)
            session.booked_count += 1
            await db.flush()
    if session is None:
        await assert_free(db, business_id, item, staff_id, starts_at, ends_at)
        if resource_id is not None and await conflicting_resource(
            db, business_id, resource_id, starts_at, ends_at
        ):
            raise Conflict(_RESOURCE_BUSY)
        session = Session(
            id=new_id("session"),
            business_id=business_id,
            item_id=item.id,
            staff_id=staff_id,
            resource_id=resource_id,
            recurrence_id=recurrence_id,
            starts_at=starts_at,
            ends_at=ends_at,
            capacity=item.capacity if is_class and item.capacity is not None else 1,
            booked_count=1,
            status="scheduled",
        )
        db.add(session)
        try:
            # the exclusion constraint backstops a concurrent overlapping insert
            await db.flush()
        except IntegrityError as exc:
            raise Conflict(_OVERLAP) from exc
    booking = Booking(
        id=new_id("booking"),
        business_id=business_id,
        session_id=session.id,
        staff_id=staff_id,
        client_id=client_id,
        subject_id=subject_id,
        status="confirmed",
        source=source,
        price_cents=item.price_cents,
        deposit_required=item.deposit_type != "none",
        deposit_amount_cents=_deposit_cents(item),
        confirmed_at=datetime.now(UTC),
    )
    db.add(booking)
    await db.flush()
    return booking, session


async def release_session_slot(db: AsyncSession, session: Session) -> None:
    """Free the seat a canceled booking held, canceling the session once it empties — the
    cancel-frees-the-slot rule (a canceled session is excluded from the overlap check)."""
    session.booked_count = max(0, session.booked_count - 1)
    if session.booked_count == 0:
        session.status = "canceled"
    await db.flush()


def assert_can_act_as(principal: Principal, staff_id: str | None) -> None:
    if principal.role in ("owner", "admin"):
        return
    if staff_id != principal.staff_id:
        raise Forbidden("staff can only manage their own bookings")


async def load_item(
    db: AsyncSession, biz: str, item_id: str, *, require_active: bool = True
) -> Item:
    q = scoped(Item, biz).where(Item.id == item_id)
    if require_active:
        q = q.where(Item.active.is_(True))
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None:
        raise NotFound("item not found")
    return row


async def load_client(db: AsyncSession, biz: str, client_id: str) -> Client:
    row = (
        await db.execute(scoped(Client, biz, soft_delete=True).where(Client.id == client_id))
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("client not found")
    return row


async def load_staff(db: AsyncSession, biz: str, staff_id: str) -> Staff:
    row = (
        await db.execute(scoped(Staff, biz).where(Staff.id == staff_id, Staff.status == "active"))
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("staff not found")
    return row


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
            booking, session = await create_booking_core(
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
            return _booking_out(booking, session)

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
        session = await self._session(booking.session_id)

        # A terminal booking is frozen — only an idempotent re-set of the same status is allowed.
        if booking.status in _TERMINAL and (
            data.starts_at is not None
            or (data.status is not None and data.status != booking.status)
        ):
            raise Conflict(f"a {booking.status} booking can't be modified")

        async def run(cmd: Command) -> BookingOut:
            if data.starts_at is not None:
                duration = session.ends_at - session.starts_at
                new_ends = data.starts_at + duration
                if not await is_within_availability(
                    self.db, session.staff_id, self.biz, data.starts_at, new_ends
                ):
                    raise Conflict(_OUTSIDE_HOURS)
                item = await self._item(session.item_id, require_active=False)
                await assert_free(
                    self.db, self.biz, item, session.staff_id, data.starts_at, new_ends, session.id
                )
                session.starts_at = data.starts_at
                session.ends_at = new_ends
                try:
                    await self.db.flush()
                except IntegrityError as exc:
                    raise Conflict(_OVERLAP) from exc
                cmd.record("booking.reschedule", entity_type="booking", entity_id=booking.id)
            if data.status is not None:
                booking.status = data.status
                if data.status == "canceled":
                    booking.canceled_at = datetime.now(UTC)
                    session.status = "canceled"  # frees the slot (excluded from the overlap check)
                elif data.status == "completed":
                    booking.completed_at = datetime.now(UTC)
                    session.status = "completed"
                elif data.status == "no_show":
                    await self._forfeit_deposit(cmd, booking)
                cmd.record(f"booking.{data.status}", entity_type="booking", entity_id=booking.id)
            await self.db.flush()
            return _booking_out(booking, session)

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
        if not booking.deposit_required or booking.deposit_amount_cents <= 0:
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
            if booking.deposit_status == "none":
                booking.deposit_status = "pending"
                await self.db.flush()
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
        """No-show forfeiture: keep an already-collected deposit (mark forfeited), or capture it
        off-session via the client's default card. Idempotent — a re-set no_show never recharges."""
        if not booking.deposit_required or booking.deposit_status == "forfeited":
            return
        if booking.deposit_status == "collected":
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
        booking.deposit_status = "forfeited"
        await self.db.flush()
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

    async def _session(self, session_id: str) -> Session:
        row = (
            await self.db.execute(scoped(Session, self.biz).where(Session.id == session_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("session not found")
        return row
