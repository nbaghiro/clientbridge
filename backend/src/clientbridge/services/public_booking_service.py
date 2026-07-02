from datetime import date, timedelta

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.catalog import Item
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff, User
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.public_booking import (
    PublicBookingClient,
    PublicBookingCreate,
    PublicBookingPage,
    PublicBookingResult,
    PublicService,
    PublicSlot,
    PublicSlots,
    PublicStaff,
)
from clientbridge.services.booking_service import _deposit_cents, create_booking_core
from clientbridge.services.payment_service import open_booking_deposit
from clientbridge.services.public_common import public_brand
from clientbridge.services.scheduling_service import open_slots


def _account(business: Business) -> str | None:
    """The connected account the client pays into, exposed only once charges are enabled."""
    return business.stripe_account_id if business.stripe_charges_enabled else None


def _service_out(item: Item) -> PublicService:
    return PublicService(
        id=item.id,
        name=item.name,
        description=item.description,
        duration_min=item.duration_min,
        price_cents=item.price_cents,
        currency=item.currency,
        deposit_required=item.deposit_type != "none",
        deposit_amount_cents=_deposit_cents(item),
    )


class PublicBookingService:
    """The unauthenticated online-booking surface (#4), keyed by ``Business.slug``. The slug is the
    only credential and scopes everything to one business — no principal is involved (mirrors
    PublicPay). Reads are open; the booking write enforces the same invariant as the authed command
    path through ``create_booking_core``, then commits directly."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def page(self, slug: str) -> PublicBookingPage:
        business = await self._business(slug)
        items = (
            (
                await self.db.execute(
                    scoped(Item, business.id)
                    .where(Item.online_bookable.is_(True), Item.active.is_(True))
                    .order_by(Item.id)
                )
            )
            .scalars()
            .all()
        )
        staff_rows = (
            await self.db.execute(
                scoped(Staff, business.id)
                .add_columns(User.name)
                .join(User, User.id == Staff.user_id, isouter=True)
                .where(Staff.status == "active")
                .order_by(Staff.id)
            )
        ).all()
        return PublicBookingPage(
            business_name=business.name,
            brand=public_brand(business),
            services=[_service_out(i) for i in items],
            staff=[PublicStaff(id=r[0].id, name=r[1], title=r[0].title) for r in staff_rows],
            stripe_account_id=_account(business),
        )

    async def slots(self, slug: str, item_id: str, staff_id: str, on_date: date) -> PublicSlots:
        business = await self._business(slug)
        item = await self._bookable_item(business.id, item_id)
        await self._active_staff(business.id, staff_id)
        starts = await open_slots(self.db, business.id, item, staff_id, on_date)
        delta = timedelta(minutes=item.duration_min or 0)
        return PublicSlots(slots=[PublicSlot(starts_at=s, ends_at=s + delta) for s in starts])

    async def book(self, slug: str, data: PublicBookingCreate) -> PublicBookingResult:
        business = await self._business(slug)
        item = await self._bookable_item(business.id, data.item_id)
        if item.duration_min is None or item.duration_min <= 0:
            raise Unprocessable("that service has no duration and can't be booked")
        await self._active_staff(business.id, data.staff_id)
        client = await self._find_or_create_client(business.id, data.client)
        booking, _ = await create_booking_core(
            self.db,
            business.id,
            item=item,
            staff_id=data.staff_id,
            starts_at=data.starts_at,
            client_id=client.id,
            source="online",
            dedupe_client=True,
        )
        secret = await self._open_deposit(business, booking, client)
        await self.db.commit()
        return PublicBookingResult(
            booking_id=booking.id,
            deposit_client_secret=secret,
            stripe_account_id=_account(business),
        )

    async def _open_deposit(
        self, business: Business, booking: Booking, client: Client
    ) -> str | None:
        """Open an interactive deposit PaymentIntent so the client pays to hold the slot. Skipped
        when no deposit is due or the business can't take cards yet (the booking still stands)."""
        if not booking.deposit_required or booking.deposit_amount_cents <= 0:
            return None
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            return None
        _, client_secret = await open_booking_deposit(
            self.db,
            self.gateway,
            account_id=business.stripe_account_id,
            business_id=business.id,
            booking=booking,
            client=client,
            amount=booking.deposit_amount_cents,
            fee_bps=get_settings().platform_fee_bps,
        )
        booking.deposit_status = "pending"
        await self.db.flush()
        return client_secret

    async def _find_or_create_client(self, business_id: str, data: PublicBookingClient) -> Client:
        match: list[ColumnElement[bool]] = []
        if data.email:
            match.append(Client.email == data.email)
        if data.phone:
            match.append(Client.phone == data.phone)
        existing = (
            (
                await self.db.execute(
                    scoped(Client, business_id, soft_delete=True).where(or_(*match)).limit(1)
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            return existing
        client = Client(
            id=new_id("client"),
            business_id=business_id,
            name=data.name,
            email=data.email,
            phone=data.phone,
            tags=[],
            status="active",
            custom_fields={"source": "online_booking"},
        )
        self.db.add(client)
        await self.db.flush()
        return client

    async def _business(self, slug: str) -> Business:
        business = (
            await self.db.execute(select(Business).where(Business.slug == slug))
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("booking page not found")
        return business

    async def _bookable_item(self, business_id: str, item_id: str) -> Item:
        item = (
            await self.db.execute(
                scoped(Item, business_id).where(Item.id == item_id, Item.active.is_(True))
            )
        ).scalar_one_or_none()
        if item is None:
            raise NotFound("service not found")
        if not item.online_bookable:
            raise Conflict("that service isn't available for online booking")
        return item

    async def _active_staff(self, business_id: str, staff_id: str) -> Staff:
        staff = (
            await self.db.execute(
                scoped(Staff, business_id).where(Staff.id == staff_id, Staff.status == "active")
            )
        ).scalar_one_or_none()
        if staff is None:
            raise NotFound("staff not found")
        return staff
