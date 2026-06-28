from datetime import UTC, datetime, timedelta

from sqlalchemy import select
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

_OVERLAP = "that staff member is already booked at that time"
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
            await self._assert_free(data.staff_id, data.starts_at, ends_at)
            session = Session(
                id=new_id("session"),
                business_id=self.biz,
                item_id=item.id,
                staff_id=data.staff_id,
                resource_id=data.resource_id,
                starts_at=data.starts_at,
                ends_at=ends_at,
                capacity=1,
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
                await self._assert_free(
                    session.staff_id, data.starts_at, new_ends, exclude=session.id
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
        self, staff_id: str, starts_at: datetime, ends_at: datetime, exclude: str | None = None
    ) -> None:
        q = select(Session.id).where(
            Session.business_id == self.biz,
            Session.staff_id == staff_id,
            Session.status != "canceled",
            Session.starts_at < ends_at,
            Session.ends_at > starts_at,
        )
        if exclude is not None:
            q = q.where(Session.id != exclude)
        if (await self.db.execute(q.limit(1))).scalar_one_or_none() is not None:
            raise Conflict(_OVERLAP)

    async def _item(self, item_id: str) -> Item:
        row = (
            await self.db.execute(
                scoped(Item, self.biz).where(Item.id == item_id, Item.active.is_(True))
            )
        ).scalar_one_or_none()
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
