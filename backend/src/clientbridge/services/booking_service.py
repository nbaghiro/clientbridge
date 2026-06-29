from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Staff
from clientbridge.models.scheduling import Booking, Session
from clientbridge.schemas.bookings import BookingCreate, BookingOut, BookingPatch
from clientbridge.services.availability_service import is_within_availability

_OVERLAP = "that staff member is already booked at that time"
_OUTSIDE_HOURS = "outside the provider's available hours"
_CLASS_FULL = "that class is full"
_TERMINAL = frozenset({"completed", "canceled", "no_show"})


def _deposit_cents(item: Item) -> int:
    """The deposit owed for a booking of this item: fixed cents, or a percent of its price."""
    if item.deposit_type == "none" or item.deposit_value is None:
        return 0
    if item.deposit_type == "fixed":
        return int(item.deposit_value)
    return round(item.price_cents * float(item.deposit_value) / 100)


def _to_out(booking: Booking, session: Session) -> BookingOut:
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
        starts_at=session.starts_at,
        ends_at=session.ends_at,
    )


class BookingService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def create(self, data: BookingCreate, idempotency_key: str | None) -> BookingOut:
        self._assert_can_act_as(data.staff_id)
        item = await self._item(data.item_id)
        if item.duration_min is None or item.duration_min <= 0:
            raise AppError("that service has no duration and can't be booked", status_code=422)
        await self._client(data.client_id)
        await self._staff(data.staff_id)

        async def run(cmd: Command) -> BookingOut:
            ends_at = data.starts_at + timedelta(minutes=item.duration_min or 0)
            if not await is_within_availability(
                self.db, data.staff_id, self.biz, data.starts_at, ends_at
            ):
                raise Conflict(_OUTSIDE_HOURS)

            is_class = item.kind == "class" and item.capacity is not None and item.capacity > 1
            session = None
            if is_class:
                session = await self._open_class_session(item.id, data.staff_id, data.starts_at)
                if session is not None:
                    if session.booked_count >= session.capacity:
                        raise Conflict(_CLASS_FULL)
                    session.booked_count += 1
                    await self.db.flush()
            if session is None:
                await self._assert_free(item, data.staff_id, data.starts_at, ends_at)
                session = Session(
                    id=new_id("session"),
                    business_id=self.biz,
                    item_id=item.id,
                    staff_id=data.staff_id,
                    resource_id=data.resource_id,
                    starts_at=data.starts_at,
                    ends_at=ends_at,
                    capacity=item.capacity if is_class and item.capacity is not None else 1,
                    booked_count=1,
                    status="scheduled",
                )
                self.db.add(session)
                try:
                    # the exclusion constraint backstops a concurrent overlapping insert
                    await self.db.flush()
                except IntegrityError as exc:
                    raise Conflict(_OVERLAP) from exc
            booking = Booking(
                id=new_id("booking"),
                business_id=self.biz,
                session_id=session.id,
                staff_id=data.staff_id,
                client_id=data.client_id,
                subject_id=data.subject_id,
                status="confirmed",
                source="manual",
                price_cents=item.price_cents,
                deposit_required=item.deposit_type != "none",
                deposit_amount_cents=_deposit_cents(item),
                confirmed_at=datetime.now(UTC),
            )
            self.db.add(booking)
            await self.db.flush()
            cmd.record("booking.create", entity_type="booking", entity_id=booking.id)
            return _to_out(booking, session)

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
                await self._assert_free(
                    item, session.staff_id, data.starts_at, new_ends, exclude=session.id
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
                cmd.record(f"booking.{data.status}", entity_type="booking", entity_id=booking.id)
            await self.db.flush()
            return _to_out(booking, session)

        return await run_command(
            self.db,
            self.principal,
            action="booking.patch",
            run=run,
            response_model=BookingOut,
        )

    def _assert_can_act_as(self, staff_id: str | None) -> None:
        if self.principal.role in ("owner", "admin"):
            return
        if staff_id != self.principal.staff_id:
            raise Forbidden("staff can only manage their own bookings")

    async def _assert_free(
        self,
        item: Item,
        staff_id: str,
        starts_at: datetime,
        ends_at: datetime,
        exclude: str | None = None,
    ) -> None:
        # Buffer the candidate by its item's pad, and each existing session by its own, so two
        # bookings can't sit closer than their cleanup/prep buffers allow.
        new_start = starts_at - timedelta(minutes=item.buffer_before_min)
        new_end = ends_at + timedelta(minutes=item.buffer_after_min)
        q = (
            scoped(Session, self.biz)
            .join(Item, Item.id == Session.item_id)
            .where(
                Session.staff_id == staff_id,
                Session.status != "canceled",
                Session.starts_at - func.make_interval(0, 0, 0, 0, 0, Item.buffer_before_min)
                < new_end,
                Session.ends_at + func.make_interval(0, 0, 0, 0, 0, Item.buffer_after_min)
                > new_start,
                # A class session with room is joinable, not a conflict; a full one (incl. any 1:1
                # session, capacity 1) blocks.
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
        if (await self.db.execute(q.limit(1))).first() is not None:
            raise Conflict(_OVERLAP)

    async def _open_class_session(
        self, item_id: str, staff_id: str, starts_at: datetime
    ) -> Session | None:
        q = scoped(Session, self.biz).where(
            Session.item_id == item_id,
            Session.staff_id == staff_id,
            Session.starts_at == starts_at,
            Session.status != "canceled",
        )
        return (await self.db.execute(q)).scalars().first()

    async def _item(self, item_id: str, *, require_active: bool = True) -> Item:
        q = scoped(Item, self.biz).where(Item.id == item_id)
        if require_active:
            q = q.where(Item.active.is_(True))
        row = (await self.db.execute(q)).scalar_one_or_none()
        if row is None:
            raise NotFound("item not found")
        return row

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _staff(self, staff_id: str) -> Staff:
        row = (
            await self.db.execute(
                scoped(Staff, self.biz).where(Staff.id == staff_id, Staff.status == "active")
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("staff not found")
        return row

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
