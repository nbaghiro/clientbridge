import re
import secrets
from collections.abc import Sequence
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import get_args

from sqlalchemy import ColumnElement, and_, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, PublicPrincipal, run_command
from clientbridge.core.db import Base
from clientbridge.core.errors import Conflict, NotFound, Unauthorized, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.locale import currency_for
from clientbridge.core.scoping import scoped
from clientbridge.integrations.s3 import FileStorage
from clientbridge.integrations.stripe import PaymentGateway
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import BOOKABLE_KINDS, Item
from clientbridge.models.clients import Channel, Client, Note, Subject
from clientbridge.models.documents import Contract, Form, FormField, FormResponse, Signature
from clientbridge.models.messaging import Message
from clientbridge.models.payments import Payment
from clientbridge.models.platform import File
from clientbridge.models.reviews import REVIEW_OPEN, Review
from clientbridge.models.scheduling import Addon, Booking, Slot
from clientbridge.schemas.billing import (
    LineInput,
    PublicEstimate,
    PublicEstimateAccept,
    PublicEstimateDecline,
    PublicEstimateLine,
)
from clientbridge.schemas.bookings import BookingPolicy
from clientbridge.schemas.business import BrandInput
from clientbridge.schemas.consents import PublicPreferences, PublicPreferencesUpdate
from clientbridge.schemas.contracts import PublicContractContext, PublicContractSign
from clientbridge.schemas.files import PublicFileComplete, PublicFileCreate, PublicFileUpload
from clientbridge.schemas.forms import (
    FormDefinition,
    PublicFormContext,
    PublicFormField,
    PublicFormSubmit,
)
from clientbridge.schemas.orders import PublicReceipt, PublicReceiptPayment
from clientbridge.schemas.payments import (
    PublicCardIntent,
    PublicDocLine,
    PublicDocTax,
    PublicInvoice,
    PublicPayIn,
)
from clientbridge.schemas.public import (
    ManageBlock,
    ManageCancelResult,
    ManagedAddon,
    ManagedBooking,
    ManageMessage,
    ManageMessageResult,
    ManageReschedule,
    PublicAddon,
    PublicBookingClient,
    PublicBookingCreate,
    PublicBookingPage,
    PublicBookingResult,
    PublicBrand,
    PublicDay,
    PublicDays,
    PublicPickupDays,
    PublicPolicy,
    PublicService,
    PublicShop,
    PublicShopItem,
    PublicShopLine,
    PublicShopOrderCreate,
    PublicShopOrderResult,
    PublicSlot,
    PublicSlots,
    PublicStaff,
)
from clientbridge.schemas.public_profiles import PublicNextOpenings, PublicServiceOpening
from clientbridge.schemas.reviews import PublicReviewContext, PublicReviewSubmit
from clientbridge.services import ledger
from clientbridge.services.billing import estimate_status
from clientbridge.services.bookings import (
    Availability,
    clash,
    create_booking_core,
    load_availability,
    local_day,
    lock_bookings,
    lock_staff,
    move_slot,
    open_slots,
    policy_of,
    release_slot,
    slot_problem,
)
from clientbridge.services.business import business_tz, local_today
from clientbridge.services.catalog import deposit_cents
from clientbridge.services.clients import find_or_create_by_contact
from clientbridge.services.consents import (
    allows_marketing,
    client_id_for_prefs,
    latest_consents,
    set_channel_consent,
)
from clientbridge.services.files import confirm_upload, item_images, media_url, mint_upload
from clientbridge.services.lines import (
    apply_totals,
    fetch_lines,
    included,
    included_totals,
    issued_at,
    price_lines,
    replace_lines,
)
from clientbridge.services.messaging import open_thread
from clientbridge.services.notifications import Notifier
from clientbridge.services.orders import next_order_number, pickup_setting, pickup_windows
from clientbridge.services.payments import (
    assert_payable,
    booking_refund_status,
    cancel_open_deposits,
    invoice_credits,
    open_booking_deposit,
    open_card_payment,
    open_order_card_payment,
    refund_deposit,
    resolve_tip,
)
from clientbridge.services.plans import assert_serving
from clientbridge.services.returning import ReturningService
from clientbridge.services.tax import (
    LineTax,
    TaxResult,
    issued_tax,
    rates_for_business,
    tax_breakdown,
    tax_for_lines,
)


def _account(business: Business) -> str | None:
    """The connected account the client pays into, exposed only once charges are enabled."""
    return business.stripe_account_id if business.stripe_charges_enabled else None


def _service_out(
    item: Item, image_url: str | None, staff_ids: list[str] | None = None
) -> PublicService:
    return PublicService(
        id=item.id,
        name=item.name,
        description=item.description,
        duration_min=item.duration_min,
        price_cents=item.price_cents,
        currency=item.currency,
        deposit_required=item.deposit_type != "none",
        deposit_amount_cents=deposit_cents(item),
        image_url=image_url,
        kind=item.kind,
        category=item.category,
        color=item.color,
        staff_ids=staff_ids or [],
    )


def _policy_out(policy: BookingPolicy) -> PublicPolicy:
    return PublicPolicy(
        self_service=policy.self_service,
        cancel_cutoff_hours=policy.cancel_cutoff_hours,
        reschedule_cutoff_hours=policy.reschedule_cutoff_hours,
        max_reschedules=policy.max_reschedules,
        horizon_days=policy.horizon_days,
    )


_ANY = "any"
_BOOK_SCOPE = "book.create"
_UNOFFERED = "that time isn't open for booking; pick another"
_MAX_DAYS = 14


class PublicBookingService:
    """Online booking, keyed by business slug; writes go through create_booking_core."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def page(self, slug: str) -> PublicBookingPage:
        business = await self._business(slug)
        items = (
            (
                await self.db.execute(
                    scoped(Item, business.id)
                    .where(
                        Item.online_bookable.is_(True),
                        Item.active.is_(True),
                        Item.kind.in_(BOOKABLE_KINDS),
                    )
                    .order_by(Item.id)
                )
            )
            .scalars()
            .all()
        )
        staff = await self._online_staff(business.id)
        images = await item_images(self.db, business.id, [i.id for i in items])
        addons = await addon_items(self.db, business.id)
        rating, reviews = await published_rating(self.db, business.id)
        tz = await business_tz(self.db, business.id)
        ids = [s.id for s in staff]
        return PublicBookingPage(
            business_name=business.name,
            brand=public_brand(business),
            services=[_service_out(i, images.get(i.id), ids) for i in items],
            staff=[PublicStaff(id=s.id, name=s.name, title=s.title, color=s.color) for s in staff],
            addons=addons,
            stripe_account_id=_account(business),
            slug=business.slug,
            now=clock.now().astimezone(tz),
            timezone=business.timezone,
            policy=_policy_out(policy_of(business)),
            rating=rating,
            review_count=reviews,
        )

    async def next_openings(self, slug: str, item_ids: list[str]) -> PublicNextOpenings:
        business = await self._business(slug)
        staff = await self._online_staff(business.id)
        tz = await business_tz(self.db, business.id)
        today = clock.today(tz)
        items = [await self._bookable_item(business.id, i) for i in dict.fromkeys(item_ids)]
        found = await load_availability(
            self.db,
            business.id,
            [s.id for s in staff],
            today,
            today + timedelta(days=6),
            tz,
            items,
        )
        services: list[PublicServiceOpening] = []
        for item in items:
            slots: list[PublicSlot] = []
            for offset in range(7):
                slots.extend(_open(business, found, item, staff, today + timedelta(days=offset)))
                if len(slots) >= 3:
                    break
            services.append(PublicServiceOpening(item_id=item.id, slots=slots[:3]))
        return PublicNextOpenings(
            services=services, through=(today + timedelta(days=6)).isoformat()
        )

    async def slots(self, slug: str, item_id: str, staff_id: str, on_date: date) -> PublicSlots:
        business = await self._business(slug)
        item = await self._bookable_item(business.id, item_id)
        staff = await self._who(business.id, staff_id)
        tz = await business_tz(self.db, business.id)
        found = await load_availability(
            self.db, business.id, [s.id for s in staff], on_date, on_date, tz, [item]
        )
        return PublicSlots(slots=_open(business, found, item, staff, on_date))

    async def days(
        self, slug: str, item_id: str, staff_id: str, start: date, count: int
    ) -> PublicDays:
        """How many open times each day has, so the date strip can grey out full days."""
        business = await self._business(slug)
        item = await self._bookable_item(business.id, item_id)
        staff = await self._who(business.id, staff_id)
        return PublicDays(days=await open_days(self.db, business, item, staff, start, count))

    async def book(
        self, slug: str, data: PublicBookingCreate, idempotency_key: str | None = None
    ) -> PublicBookingResult:
        business = await self._business(slug)

        async def run(cmd: Command) -> PublicBookingResult:
            assert_serving(business, clock.now())
            item = await self._bookable_item(business.id, data.item_id)
            if item.duration_min is None or item.duration_min <= 0:
                raise Unprocessable("that service has no duration and can't be booked")
            policy = policy_of(business)
            _assert_bookable_window(policy, data.starts_at)
            staff_id = await self._staff_for(business, item, data.staff_id, data.starts_at)
            addons = await offered_addons(
                self.db,
                business.id,
                item.id,
                [PublicShopLine(item_id=a.item_id, quantity=a.quantity) for a in data.addons],
            )
            returning = ReturningService(self.db)
            if data.subject_id is not None and data.returning_token is None:
                raise Unauthorized("verify your email before choosing an existing pet")
            client = (
                await returning.resolve(business.id, data.returning_token)
                if data.returning_token is not None
                else await self._find_or_create_client(business.id, data.client)
            )
            first_visit = not await _has_booked(self.db, business.id, client.id)
            subject_id = (
                await returning.subject(client, data.subject_id)
                if data.subject_id is not None
                else await _pet(self.db, business.id, client.id, data.pet_name)
            )
            booking, _ = await create_booking_core(
                self.db,
                business.id,
                item=item,
                staff_id=staff_id,
                starts_at=data.starts_at,
                client_id=client.id,
                source="online",
                subject_id=subject_id,
                dedupe_client=True,
            )
            if policy.approve_new_clients and first_visit:
                booking.status = "pending"
                booking.confirmed_at = None
            if data.note is not None and data.note.strip() != "":
                self.db.add(
                    Note(
                        id=new_id("note"),
                        business_id=business.id,
                        parent_type="booking",
                        parent_id=booking.id,
                        body=data.note.strip(),
                    )
                )
            for product, qty in addons:
                self.db.add(
                    Addon(
                        id=new_id("addon"),
                        business_id=business.id,
                        booking_id=booking.id,
                        staff_id=booking.staff_id,
                        item_id=product.id,
                        description=product.name,
                        quantity=qty,
                        unit_amount_cents=product.price_cents,
                    )
                )
            secret = await self._open_deposit(business, booking, client)
            result = PublicBookingResult(
                booking_id=booking.id,
                deposit_client_secret=secret,
                stripe_account_id=_account(business),
                status=booking.status,
                manage_token=booking.manage_token,
                deposit_cents=booking.deposit_amount_cents,
            )
            cmd.record(_BOOK_SCOPE, entity_type="booking", entity_id=booking.id)
            return result

        return await run_command(
            self.db,
            PublicPrincipal(business.id),
            action=_BOOK_SCOPE,
            run=run,
            response_model=PublicBookingResult,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def _staff_for(
        self, business: Business, item: Item, staff_id: str, starts_at: datetime
    ) -> str:
        """The member a time is booked with: the first one whose open times list it."""
        staff = await self._who(business.id, staff_id)
        member = await _offered(self.db, business, item, [s.id for s in staff], starts_at)
        if member is None:
            raise Conflict(_UNOFFERED, code="slot_unavailable")
        return member

    async def _who(self, business_id: str, staff_id: str) -> list[Staff]:
        staff = await self._online_staff(business_id)
        if staff_id == _ANY:
            return staff
        chosen = [s for s in staff if s.id == staff_id]
        if not chosen:
            raise NotFound("staff not found")
        return chosen

    async def _online_staff(self, business_id: str) -> list[Staff]:
        rows = await self.db.execute(
            scoped(Staff, business_id)
            .where(Staff.status == "active", Staff.bookable_online.is_(True))
            .order_by(Staff.created_at, Staff.id)
        )
        return list(rows.scalars().all())

    async def _open_deposit(
        self, business: Business, booking: Booking, client: Client
    ) -> str | None:
        """Open a deposit PaymentIntent, unless none is due or the business can't take cards."""
        if booking.deposit_amount_cents <= 0:
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
        )
        return client_secret

    async def _find_or_create_client(self, business_id: str, data: PublicBookingClient) -> Client:
        return await find_or_create_by_contact(
            self.db,
            business_id,
            name=data.name,
            email=data.email,
            phone=data.phone,
            source="online_booking",
        )

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
        if not item.online_bookable or item.kind not in BOOKABLE_KINDS:
            raise Conflict("that service isn't available for online booking")
        return item


def _open(
    business: Business, found: Availability, item: Item, staff: list[Staff], on_date: date
) -> list[PublicSlot]:
    policy = policy_of(business)
    now = clock.now()
    earliest = now + timedelta(hours=policy.lead_hours)
    latest = now + timedelta(days=policy.horizon_days)
    delta = timedelta(minutes=item.duration_min or 0)
    seen: dict[datetime, str] = {}
    for member in staff:
        for start in found.open_starts(item, member.id, on_date, policy.step_min):
            if earliest <= start <= latest and start not in seen:
                seen[start] = member.id
    return [
        PublicSlot(starts_at=start, ends_at=start + delta, staff_id=seen[start])
        for start in sorted(seen)
    ]


async def _offered(
    db: AsyncSession,
    business: Business,
    item: Item,
    staff_ids: list[str],
    starts_at: datetime,
    exclude: str | None = None,
) -> str | None:
    """The first member whose open times on the start's local day list it."""
    tz = await business_tz(db, business.id)
    day = starts_at.astimezone(tz).date()
    step = policy_of(business).step_min
    found = await load_availability(db, business.id, staff_ids, day, day, tz, [item])
    for staff_id in staff_ids:
        if starts_at in found.open_starts(item, staff_id, day, step, exclude=exclude):
            return staff_id
    return None


def _assert_bookable_window(policy: BookingPolicy, starts_at: datetime) -> None:
    now = clock.now()
    if starts_at < now + timedelta(hours=policy.lead_hours):
        raise Conflict("that time is too soon to book online")
    if starts_at > now + timedelta(days=policy.horizon_days):
        raise Conflict("that time is too far ahead to book online")


async def open_days(
    db: AsyncSession,
    business: Business,
    item: Item,
    staff: list[Staff],
    start: date,
    count: int,
) -> list[PublicDay]:
    """Open start times per day for one service, across the given members."""
    policy = policy_of(business)
    tz = await business_tz(db, business.id)
    now = clock.now()
    earliest = now + timedelta(hours=policy.lead_hours)
    latest = now + timedelta(days=policy.horizon_days)
    days = [start + timedelta(days=offset) for offset in range(min(max(count, 1), _MAX_DAYS))]
    found = await load_availability(
        db, business.id, [s.id for s in staff], days[0], days[-1], tz, [item]
    )
    out: list[PublicDay] = []
    for day in days:
        opens, closes = local_day(day, tz)
        closure = next(
            (w for w in found.closures if w.starts_at <= opens and w.ends_at >= closes), None
        )
        starts: set[datetime] = set()
        if closure is None and closes > earliest and opens <= latest:
            for member in staff:
                for s in found.open_starts(item, member.id, day, policy.step_min):
                    if earliest <= s <= latest:
                        starts.add(s)
        out.append(
            PublicDay(
                date=day,
                count=len(starts),
                closed=closure is not None,
                reason=closure.reason if closure is not None else None,
            )
        )
    return out


async def published_rating(db: AsyncSession, business_id: str) -> tuple[float | None, int]:
    row = (
        await db.execute(
            scoped(Review, business_id)
            .where(Review.status == "published")
            .with_only_columns(func.avg(Review.rating), func.count(Review.id))
        )
    ).one()
    count = int(row[1])
    return (round(float(row[0]), 1) if count > 0 and row[0] is not None else None), count


async def _has_booked(db: AsyncSession, business_id: str, client_id: str) -> bool:
    found = await db.execute(
        scoped(Booking, business_id).where(Booking.client_id == client_id).limit(1)
    )
    return found.first() is not None


async def _pet(db: AsyncSession, business_id: str, client_id: str, name: str | None) -> str | None:
    """The client's pet of that name, added to their file the first time it is booked."""
    if name is None or name.strip() == "":
        return None
    clean = name.strip()
    found = (
        (
            await db.execute(
                scoped(Subject, business_id).where(
                    Subject.client_id == client_id, func.lower(Subject.name) == clean.lower()
                )
            )
        )
        .scalars()
        .first()
    )
    if found is not None:
        return found.id
    pet = Subject(
        id=new_id("subject"),
        business_id=business_id,
        client_id=client_id,
        kind="pet",
        name=clean,
        attributes={},
    )
    db.add(pet)
    await db.flush()
    return pet.id


_MOVE_SCOPE = "manage.move"
_CANCEL_SCOPE = "manage.cancel"
_GONE = "booking not found"


class PublicManageService:
    """A client's manage link: view, move or cancel one booking within the business's rules."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def booking_id(self, token: str) -> str:
        booking, _, _ = await self._resolve(token)
        return booking.id

    async def view(self, token: str) -> ManagedBooking:
        booking, slot, business = await self._resolve(token)
        return await self._view(booking, slot, business)

    async def days(self, token: str, start: date, count: int) -> PublicDays:
        booking, slot, business = await self._resolve(token)
        item, staff = await self._movable(booking, slot, business)
        return PublicDays(days=await open_days(self.db, business, item, [staff], start, count))

    async def slots(self, token: str, on_date: date) -> PublicSlots:
        booking, slot, business = await self._resolve(token)
        item, staff = await self._movable(booking, slot, business)
        policy = policy_of(business)
        now = clock.now()
        earliest = now + timedelta(hours=policy.lead_hours)
        latest = now + timedelta(days=policy.horizon_days)
        delta = slot.ends_at - slot.starts_at
        starts = await open_slots(
            self.db, business.id, item, staff.id, on_date, policy.step_min, exclude=slot.id
        )
        return PublicSlots(
            slots=[
                PublicSlot(starts_at=s, ends_at=s + delta, staff_id=staff.id)
                for s in starts
                if earliest <= s <= latest and s != slot.starts_at
            ]
        )

    async def reschedule(
        self, token: str, data: ManageReschedule, idempotency_key: str | None
    ) -> ManagedBooking:
        booking, slot, business = await self._locked(token)
        request = {"booking_id": booking.id, **data.model_dump(mode="json")}

        async def run(cmd: Command) -> ManagedBooking:
            assert_serving(business, clock.now())
            item, staff = await self._movable(booking, slot, business)
            policy = policy_of(business)
            _assert_bookable_window(policy, data.starts_at)
            ends_at = data.starts_at + (slot.ends_at - slot.starts_at)
            problem = await slot_problem(
                self.db,
                business.id,
                item,
                staff.id,
                data.starts_at,
                ends_at,
                exclude=slot.id,
                resource_id=slot.resource_id,
            )
            if problem is not None:
                raise Conflict(problem.message or _UNOFFERED)
            if await _offered(self.db, business, item, [staff.id], data.starts_at, slot.id) is None:
                raise Conflict(_UNOFFERED, code="slot_unavailable")
            await move_slot(self.db, business.id, slot, data.starts_at, ends_at)
            booking.reschedule_count += 1
            try:
                await self.db.flush()
            except IntegrityError as exc:
                raise clash(exc) from exc
            out = await self._view(booking, slot, business)
            cmd.record(_MOVE_SCOPE, entity_type="booking", entity_id=booking.id)
            return out

        return await run_command(
            self.db,
            PublicPrincipal(business.id),
            action=_MOVE_SCOPE,
            run=run,
            response_model=ManagedBooking,
            idempotency_key=idempotency_key,
            request=request,
        )

    async def message(
        self, token: str, data: ManageMessage, key: str, notifier: Notifier
    ) -> ManageMessageResult:
        """Record the client's message in their thread and alert staff once, not on a replay."""
        booking, _, business = await self._resolve(token)
        client = (
            await self.db.execute(
                scoped(Client, business.id, soft_delete=True).where(Client.id == booking.client_id)
            )
        ).scalar_one_or_none()
        if client is None:
            raise NotFound("client not found")

        async def run(cmd: Command) -> ManageMessageResult:
            channel: Channel = "sms" if client.phone else "email"
            thread = await open_thread(self.db, business.id, client.id, channel)
            thread.status = "open"
            message = Message(
                id=new_id("message"),
                business_id=business.id,
                thread_id=thread.id,
                direction="in",
                channel=channel,
                body=data.body,
                status="delivered",
            )
            self.db.add(message)
            await self.db.flush()
            cmd.record("booking.message", entity_type="booking", entity_id=booking.id)
            received.append(message.id)
            return ManageMessageResult(id=message.id)

        received: list[str] = []
        result = await run_command(
            self.db,
            PublicPrincipal(business.id),
            action=f"booking.message.{booking.id}",
            run=run,
            response_model=ManageMessageResult,
            idempotency_key=key,
            request=data,
        )
        for message_id in received:
            await notifier.on_inbound_message(self.db, message_id)
        return result

    async def cancel(self, token: str, idempotency_key: str | None) -> ManageCancelResult:
        booking, slot, business = await self._locked(token)
        request = {"booking_id": booking.id}

        async def run(cmd: Command) -> ManageCancelResult:
            _, staff = await self._visit(booking, slot, business)
            blocked = self._blocked(booking, slot, business, staff, "cancel")
            if blocked is not None:
                raise Conflict(
                    f"this visit can't be canceled online ({blocked[0]})", code="change_blocked"
                )
            refunded = 0
            if booking.deposit_status == "collected":
                refunded = await refund_deposit(self.db, self.gateway, booking)
            elif booking.deposit_status == "pending":
                await cancel_open_deposits(self.db, self.gateway, booking)
                booking.deposit_status = "none"
            booking.status = "canceled"
            booking.canceled_at = clock.now()
            await release_slot(self.db, slot)
            result = ManageCancelResult(
                deposit=(await booking_refund_status(self.db, booking))
                or ("refunded" if refunded > 0 else "none"),
                refund_cents=refunded,
            )
            cmd.record(_CANCEL_SCOPE, entity_type="booking", entity_id=booking.id)
            return result

        return await run_command(
            self.db,
            PublicPrincipal(business.id),
            action=_CANCEL_SCOPE,
            run=run,
            response_model=ManageCancelResult,
            idempotency_key=idempotency_key,
            request=request,
        )

    def _blocked(
        self, booking: Booking, slot: Slot, business: Business, staff: Staff, change: str
    ) -> tuple[ManageBlock, int | None] | None:
        """Why the client can't make this change online, and the cutoff hours when that is why."""
        policy = policy_of(business)
        if booking.status not in ("pending", "confirmed"):
            return "status", None
        if not policy.self_service:
            return "by_phone", None
        hours_away = (slot.starts_at - clock.now()).total_seconds() / 3600
        if change == "cancel":
            if hours_away < policy.cancel_cutoff_hours:
                return "cutoff", policy.cancel_cutoff_hours
            return None
        if staff.status != "active":
            return "member_unavailable", None
        if slot.capacity > 1:
            return "class_session", None
        if booking.reschedule_count >= policy.max_reschedules:
            return "reschedule_limit", None
        if hours_away < policy.reschedule_cutoff_hours:
            return "cutoff", policy.reschedule_cutoff_hours
        return None

    async def _resolve(self, token: str) -> tuple[Booking, Slot, Business]:
        booking = await resolve_by_token(
            self.db,
            Booking,
            and_(Booking.manage_token == token, Booking.deleted_at.is_(None)),
            _GONE,
        )
        slot = await self.db.get(Slot, booking.slot_id)
        if slot is None:
            raise NotFound(_GONE)
        business = await business_or_404(self.db, booking.business_id, _GONE)
        return booking, slot, business

    async def _locked(self, token: str) -> tuple[Booking, Slot, Business]:
        """The booking with its member and row locked, so limits are read after other changes."""
        booking, slot, business = await self._resolve(token)
        member = slot.staff_id
        await lock_staff(self.db, business.id, member)
        if not await lock_bookings(self.db, business.id, [booking.id]):
            raise NotFound(_GONE)
        await self.db.refresh(slot)
        if slot.staff_id != member:
            raise Conflict(
                "this visit changed while you were looking; reload it and try again",
                code="visit_changed",
            )
        return booking, slot, business

    async def _visit(self, booking: Booking, slot: Slot, business: Business) -> tuple[Item, Staff]:
        item = await self.db.get(Item, slot.item_id)
        staff = await self.db.get(Staff, slot.staff_id)
        if item is None or staff is None or item.business_id != business.id:
            raise NotFound(_GONE)
        return item, staff

    async def _movable(
        self, booking: Booking, slot: Slot, business: Business
    ) -> tuple[Item, Staff]:
        """The visit's service and member, when the client may move it online."""
        item, staff = await self._visit(booking, slot, business)
        blocked = self._blocked(booking, slot, business, staff, "move")
        if blocked is not None:
            raise Conflict(
                f"this visit can't be moved online ({blocked[0]})", code="change_blocked"
            )
        return item, staff

    async def _view(self, booking: Booking, slot: Slot, business: Business) -> ManagedBooking:
        item, staff = await self._visit(booking, slot, business)
        client = await self.db.get(Client, booking.client_id)
        pet = await self.db.get(Subject, booking.subject_id) if booking.subject_id else None
        addons = (
            (
                await self.db.execute(
                    scoped(Addon, business.id).where(Addon.booking_id == booking.id)
                )
            )
            .scalars()
            .all()
        )
        images = await item_images(self.db, business.id, [item.id])
        tz = await business_tz(self.db, business.id)
        move = self._blocked(booking, slot, business, staff, "move")
        cancel = self._blocked(booking, slot, business, staff, "cancel")
        blocked, blocked_hours = cancel or move or (None, None)
        return ManagedBooking(
            refund_status=await booking_refund_status(self.db, booking),
            address=BrandInput.model_validate(business.brand or {}).address,
            booking_id=booking.id,
            business_name=business.name,
            brand=public_brand(business),
            slug=business.slug,
            client_name=client.name if client is not None else "",
            pet_name=pet.name if pet is not None else None,
            service=_service_out(item, images.get(item.id)),
            staff=PublicStaff(id=staff.id, name=staff.name, title=staff.title, color=staff.color),
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
            status=booking.status,
            deposit_cents=booking.deposit_amount_cents,
            deposit_status=booking.deposit_status,
            addons=[
                ManagedAddon(
                    name=a.description, quantity=a.quantity, unit_cents=a.unit_amount_cents
                )
                for a in addons
            ],
            reschedules_used=booking.reschedule_count,
            policy=_policy_out(policy_of(business)),
            now=clock.now().astimezone(tz),
            timezone=business.timezone,
            can_move=move is None,
            can_cancel=cancel is None,
            blocked=blocked,
            blocked_hours=blocked_hours,
        )


async def resolve_by_token[M: Base](
    db: AsyncSession, model: type[M], criterion: ColumnElement[bool], message: str
) -> M:
    """The single row matching a public-link token criterion, else 404 with `message`."""
    row = (await db.execute(select(model).where(criterion))).scalar_one_or_none()
    if row is None:
        raise NotFound(message)
    return row


async def business_or_404(db: AsyncSession, business_id: str, message: str) -> Business:
    """A public link's business, else 404 with the same message."""
    business = await db.get(Business, business_id)
    if business is None:
        raise NotFound(message)
    return business


def public_brand(business: Business) -> PublicBrand:
    brand = BrandInput.model_validate(business.brand or {})
    logo_url = media_url(brand.logo_file_id) if brand.logo_file_id is not None else None
    return PublicBrand(
        public_slug=business.slug if business.status != "closed" else None,
        business_name=business.name,
        cover_url=brand.cover_url,
        logo_url=logo_url,
        avatar_url=(
            media_url(brand.avatar_file_id) if brand.avatar_file_id is not None else logo_url
        ),
        primary=brand.primary,
        tagline=brand.tagline,
    )


class PublicContractService:
    """Public e-signing; the signature token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(
        self, token: str, *, lock: bool = False
    ) -> tuple[Signature, Contract, Business]:
        signature = await resolve_by_token(
            self.db, Signature, Signature.token == token, "signing link not found"
        )
        contract = await self.db.get(Contract, signature.contract_id)
        if contract is None:
            raise NotFound("signing link not found")
        if lock:
            await self.db.refresh(contract, with_for_update=True)
            await self.db.refresh(signature, with_for_update=True)
        business = await business_or_404(self.db, signature.business_id, "signing link not found")
        return signature, contract, business

    async def context(self, token: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token)
        if signature.status == "pending" and signature.opened_at is None:
            signature.opened_at = clock.now()
            await self.db.commit()
        return await self._context(signature, contract, business)

    async def sign(self, token: str, data: PublicContractSign, ip: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token, lock=True)
        if signature.status != "pending":
            raise Conflict("this contract is no longer awaiting a signature")
        if data.version != contract.version:
            raise Conflict("the contract changed; review the current version before signing")
        if not data.agreed:
            raise Unprocessable("agree to sign electronically first")
        if data.strokes is not None and not _valid_strokes(data.strokes):
            raise Unprocessable("the drawn signature is empty or too detailed")
        signature.status = "signed"
        signature.signed_at = clock.now()
        signature.signed_body = contract.body
        signature.contract_version = contract.version
        signature.signer_name = data.typed_name.strip()
        signature.method = "drawn" if data.strokes else "typed"
        signature.strokes = [[list(p) for p in stroke] for stroke in data.strokes or []] or None
        signature.ip = ip
        await self.db.commit()
        return await self._context(signature, contract, business)

    async def decline(self, token: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token, lock=True)
        if signature.status != "pending":
            raise Conflict("this contract is no longer awaiting a signature")
        signature.status = "declined"
        await self.db.commit()
        return await self._context(signature, contract, business)

    async def _context(
        self, signature: Signature, contract: Contract, business: Business
    ) -> PublicContractContext:
        client = await self.db.get(Client, signature.client_id)
        signed = signature.status == "signed"
        return PublicContractContext(
            contract_name=contract.name,
            business_name=business.name,
            brand=public_brand(business),
            body=signature.signed_body or contract.body,
            signer_name=client.name if client is not None else None,
            status=signature.status,
            version=(signature.contract_version if signed else None) or contract.version,
            timezone=business.timezone,
            signed_at=signature.signed_at,
            signer_ip=signature.ip if signed else None,
            method=signature.method,
            typed_name=signature.signer_name,
            strokes=_strokes_out(signature.strokes),
        )


_MAX_POINTS = 4000


def _valid_strokes(strokes: list[list[tuple[float, float]]]) -> bool:
    points = [p for stroke in strokes for p in stroke]
    in_box = all(-0.05 <= x <= 1.05 and -0.05 <= y <= 1.05 for x, y in points)
    return 0 < len(points) <= _MAX_POINTS and in_box


def _strokes_out(raw: list[object] | None) -> list[list[tuple[float, float]]] | None:
    if not raw:
        return None
    out: list[list[tuple[float, float]]] = []
    for stroke in raw:
        if isinstance(stroke, list):
            out.append(
                [(float(p[0]), float(p[1])) for p in stroke if isinstance(p, list) and len(p) == 2]
            )
    return out


FORM_UPLOAD_TYPES = frozenset({"application/pdf", "image/jpeg", "image/png", "image/heic"})
FORM_UPLOAD_MAX_BYTES = 10 * 1024 * 1024


class PublicFormService:
    """Public forms; the response token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[FormResponse, Form, Business]:
        response = await resolve_by_token(
            self.db, FormResponse, FormResponse.token == token, "form link not found"
        )
        form = await self.db.get(Form, response.form_id)
        if form is None:
            raise NotFound("form link not found")
        business = await business_or_404(self.db, response.business_id, "form link not found")
        return response, form, business

    async def context(self, token: str) -> PublicFormContext:
        response, _, business = await self._resolve(token)
        if response.status == "draft" and response.opened_at is None:
            response.opened_at = clock.now()
            await self.db.commit()
        definition = FormDefinition.model_validate(response.definition)
        fields = definition.fields
        return PublicFormContext(
            form_name=definition.name,
            business_name=business.name,
            brand=public_brand(business),
            timezone=business.timezone,
            completed=response.status == "submitted",
            require_signature=definition.require_signature,
            fields=fields,
        )

    async def upload(
        self, token: str, data: PublicFileCreate, storage: FileStorage
    ) -> PublicFileUpload:
        response, _, _ = await self._resolve(token)
        if data.content_type not in FORM_UPLOAD_TYPES:
            raise Unprocessable("attach a PDF, JPG, PNG or HEIC file")
        if data.size is None or data.size > FORM_UPLOAD_MAX_BYTES:
            raise Unprocessable("attach a file up to 10 MB")
        result = await mint_upload(
            self.db,
            storage,
            business_id=response.business_id,
            parent_type="form_response",
            parent_id=response.id,
            purpose="attachment",
            content_type=data.content_type,
            size=data.size,
        )
        await self.db.commit()
        return PublicFileUpload(file_id=result.file.id, upload_url=result.upload_url)

    async def complete_upload(
        self, token: str, file_id: str, storage: FileStorage
    ) -> PublicFileComplete:
        response, _, _ = await self._resolve(token)
        file = (
            await self.db.execute(
                scoped(File, response.business_id).where(
                    File.id == file_id,
                    File.parent_type == "form_response",
                    File.parent_id == response.id,
                )
            )
        ).scalar_one_or_none()
        if file is None:
            raise NotFound("upload not found")
        await confirm_upload(file, storage)
        await self.db.commit()
        return PublicFileComplete(file_id=file.id)

    async def _assert_uploaded(
        self,
        response: FormResponse,
        fields: Sequence[FormField | PublicFormField],
        answers: dict[str, object],
    ) -> None:
        """A file answer must name a finished upload attached to this response."""
        wanted = {
            str(answers[f.name])
            for f in fields
            if f.input in ("file", "image") and answers.get(f.name) not in (None, "")
        }
        if not wanted:
            return
        uploaded = {
            file.id
            for file in await self.db.scalars(
                scoped(File, response.business_id).where(
                    File.parent_type == "form_response",
                    File.parent_id == response.id,
                    File.id.in_(wanted),
                    File.uploaded_at.is_not(None),
                )
            )
        }
        if wanted - uploaded:
            raise Unprocessable("an attached file has not finished uploading")

    async def submit(self, token: str, data: PublicFormSubmit, ip: str) -> PublicFormContext:
        response, _, business = await self._resolve(token)
        await self.db.refresh(response, with_for_update=True)
        if response.status == "submitted":
            raise Conflict("this form was already submitted")
        definition = FormDefinition.model_validate(response.definition)
        fields = definition.fields
        if definition.require_signature and data.signature is None:
            raise Unprocessable("this form requires a signature")
        if data.signature is not None:
            if data.signature.strokes is not None and not _valid_strokes(data.signature.strokes):
                raise Unprocessable("draw a signature inside the box")
            response.signature = data.signature.model_dump(mode="json", exclude={"agreed"}) | {
                "ip": ip
            }
        validate_answers(fields, data.answers)
        await self._assert_uploaded(response, fields, data.answers)
        response.status = "submitted"
        response.answers = data.answers
        response.submitted_at = clock.now()
        await self.db.commit()
        return PublicFormContext(
            form_name=definition.name,
            business_name=business.name,
            brand=public_brand(business),
            timezone=business.timezone,
            completed=True,
            require_signature=definition.require_signature,
            fields=fields,
        )


def validate_answers(
    fields: Sequence[FormField | PublicFormField], answers: dict[str, object]
) -> None:
    if answers.keys() - {field.name for field in fields}:
        raise Unprocessable("answers contain an unknown field")
    for field in fields:
        value = answers.get(field.name)
        missing = value is None or value == [] or (isinstance(value, str) and not value.strip())
        if missing:
            if field.required:
                raise Unprocessable(f"missing required field: {field.name}")
            continue
        valid = True
        if field.input == "checkbox":
            valid = isinstance(value, bool) and (not field.required or value)
        elif field.input in ("number", "currency", "rating"):
            valid = _valid_numeric_answer(field, value)
        elif field.input == "multiselect":
            valid = isinstance(value, list) and all(
                isinstance(option, str) and option in _form_options(field) for option in value
            )
        else:
            valid = isinstance(value, str) and len(value) <= 40000
            if valid and isinstance(value, str):
                if field.input == "select":
                    valid = value in _form_options(field)
                elif field.input == "email":
                    valid = re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) is not None
                elif field.input in ("date", "time"):
                    try:
                        if field.input == "date":
                            valid = date.fromisoformat(value).isoformat() == value
                        else:
                            valid = time.fromisoformat(value).tzinfo is None
                    except ValueError:
                        valid = False
        if not valid:
            raise Unprocessable(f"invalid answer for field: {field.name}")


def _form_options(field: FormField | PublicFormField) -> set[str]:
    return {
        str(option.get("value", "")) if isinstance(option, dict) else str(option)
        for option in field.options
    }


def _valid_numeric_answer(field: FormField | PublicFormField, value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, str | int | float):
        return False
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return False
    if not number.is_finite():
        return False
    if field.input == "rating" and (number != number.to_integral_value() or not 1 <= number <= 5):
        return False
    for key, below in (("min", True), ("max", False)):
        bound = field.validation.get(key)
        if isinstance(bound, int | float) and (
            (below and number < bound) or (not below and number > bound)
        ):
            return False
    return True


class PublicPayService:
    """Public pay links; the pay token is the only credential."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def _resolve(self, token: str) -> tuple[Invoice, Business]:
        msg = "payment link not found"
        invoice = await resolve_by_token(self.db, Invoice, Invoice.pay_token == token, msg)
        return invoice, await business_or_404(self.db, invoice.business_id, msg)

    async def invoice(self, token: str) -> PublicInvoice:
        invoice, business = await self._resolve(token)
        client = await self.db.get(Client, invoice.client_id)
        lines = await fetch_lines(self.db, invoice.business_id, "invoice", invoice.id)
        doc_lines, taxes = await public_doc_lines(self.db, invoice, lines)
        contact = BrandInput.model_validate(business.brand or {})
        return PublicInvoice(
            tip_base_cents=sum(
                line.amount_cents for line in await tip_lines(self.db, invoice.business_id, lines)
            ),
            number=invoice.number,
            business_name=business.name,
            brand=public_brand(business),
            currency=invoice.currency,
            timezone=business.timezone,
            subtotal_cents=invoice.subtotal_cents,
            tax_total_cents=invoice.tax_total_cents,
            total_cents=invoice.total_cents,
            balance_cents=await ledger.invoice_balance(self.db, invoice),
            status=(await ledger.invoice_state(self.db, invoice))[0],
            accepts_card=business.stripe_charges_enabled,
            contact_phone=contact.phone,
            contact_email=contact.email,
            client_name=client.name if client is not None else None,
            issued_at=invoice.issued_at,
            due_at=invoice.due_at,
            notes=invoice.notes,
            gst_hst_number=business.gst_hst_number,
            qst_number=business.qst_number,
            lines=[line for line, _ in doc_lines],
            discount_cents=sum(ln.sale_discount_cents for ln in lines),
            discount_reason=invoice.discount_reason,
            taxes=taxes,
            credits=await invoice_credits(self.db, invoice),
            tip_for=await _tip_names(self.db, invoice.business_id, lines),
        )

    async def pay_card(self, token: str, data: PublicPayIn | None = None) -> PublicCardIntent:
        invoice, business = await self._resolve(token)
        amount = await assert_payable(self.db, invoice)
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("this business can't take card payments yet")
        client = await self.db.get(Client, invoice.client_id)
        if client is None:
            raise NotFound("client not found")
        tip_cents = data.tip_cents if data is not None else 0
        if tip_cents > amount:
            raise Unprocessable("a tip can't be more than the amount owed")
        eligible = await tip_lines(
            self.db, business.id, await fetch_lines(self.db, business.id, "invoice", invoice.id)
        )
        if tip_cents > 0 and not any(line.amount_cents > 0 for line in eligible):
            raise Unprocessable("this invoice has no services to tip on")
        tip = await resolve_tip(
            self.db,
            business.id,
            tip_cents,
            None,
            eligible,
            await owner_staff_id(self.db, business.id),
        )
        _, client_secret = await open_card_payment(
            self.db,
            self.gateway,
            account_id=business.stripe_account_id,
            business_id=business.id,
            invoice=invoice,
            client=client,
            amount=amount + tip.cents,
            tip=tip,
            supersede=True,
        )
        await self.db.commit()
        return PublicCardIntent(
            client_secret=client_secret, stripe_account_id=business.stripe_account_id
        )


async def tip_lines(db: AsyncSession, business_id: str, lines: list[Line]) -> list[Line]:
    kinds = dict(
        (
            await db.execute(
                scoped(Item, business_id)
                .with_only_columns(Item.id, Item.kind)
                .where(Item.id.in_([line.item_id for line in lines if line.item_id]))
            )
        )
        .tuples()
        .all()
    )
    return [
        line for line in lines if line.item_id is None or kinds.get(line.item_id) in BOOKABLE_KINDS
    ]


async def _tip_names(db: AsyncSession, business_id: str, lines: list[Line]) -> list[str]:
    """Who a pay-link tip goes to, by first name: the staff on its lines or their bookings."""
    ids: list[str] = []
    for line in lines:
        staff_id = line.staff_id
        if staff_id is None and line.booking_id is not None:
            booking = await db.get(Booking, line.booking_id)
            staff_id = booking.staff_id if booking is not None else None
        if staff_id is not None and staff_id not in ids:
            ids.append(staff_id)
    if not ids:
        return []
    rows = await db.execute(scoped(Staff, business_id).where(Staff.id.in_(ids)))
    names = {s.id: s.name for s in rows.scalars().all()}
    return [name.split()[0] for sid in ids if (name := names.get(sid))]


async def estimate_tax(
    db: AsyncSession, estimate: Estimate, lines: list[Line]
) -> tuple[datetime, TaxResult]:
    """An open estimate is quoted at today's rates; an accepted one keeps its acceptance rates."""
    if estimate.accepted_at is None:
        now = clock.now()
        return now, await tax_breakdown(db, estimate.business_id, lines, now)
    return estimate.accepted_at, await issued_tax(
        db, estimate.business_id, lines, estimate.accepted_at
    )


async def public_doc_lines(
    db: AsyncSession,
    document: Invoice | Estimate | Order,
    lines: list[Line],
    priced: tuple[datetime, TaxResult] | None = None,
) -> tuple[list[tuple[PublicDocLine, LineTax]], list[PublicDocTax]]:
    """A document's lines with their tax, labelled with the rates that tax was computed at."""
    at, result = priced or (
        issued_at(document),
        await issued_tax(db, document.business_id, lines, issued_at(document)),
    )
    rates = {
        r.jurisdiction: r.rate_bps for r in await rates_for_business(db, document.business_id, at)
    }
    taxes: dict[str, PublicDocTax] = {}
    for line, line_tax in zip(lines, result.lines, strict=True):
        if not included(line):
            continue
        for code, cents in line_tax.by_jurisdiction.items():
            row = taxes.setdefault(
                code, PublicDocTax(code=code, rate_bps=rates.get(code, 0), base_cents=0, cents=0)
            )
            row.base_cents += line.amount_cents
            row.cents += cents
    return [
        (
            PublicDocLine(
                description=line.description,
                quantity=float(line.quantity),
                unit_amount_cents=line.unit_amount_cents,
                amount_cents=line.amount_cents + line.sale_discount_cents,
                tax_codes=sorted(line_tax.by_jurisdiction),
                discount_cents=line.discount_cents,
                discount_reason=line.discount_reason,
            ),
            line_tax,
        )
        for line, line_tax in zip(lines, result.lines, strict=True)
    ], [taxes[code] for code in sorted(taxes)]


class PublicEstimateService:
    """Public estimate links; the view token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str, *, lock: bool = False) -> tuple[Estimate, Business]:
        msg = "estimate not found"
        query = select(Estimate).where(Estimate.view_token == token)
        estimate = (
            await self.db.execute(query.with_for_update() if lock else query)
        ).scalar_one_or_none()
        if estimate is None:
            raise NotFound(msg)
        return estimate, await business_or_404(self.db, estimate.business_id, msg)

    async def context(self, token: str) -> PublicEstimate:
        estimate, business = await self._resolve(token)
        return await self._context(estimate, business)

    async def accept(self, token: str, data: PublicEstimateAccept) -> PublicEstimate:
        estimate, business = await self._resolve(token, lock=True)
        self._assert_open(estimate, business)
        assert_serving(business, clock.now())
        lines = await fetch_lines(self.db, estimate.business_id, "estimate", estimate.id)
        offered = {ln.id for ln in lines if ln.optional}
        if not set(data.line_ids) <= offered:
            raise Unprocessable("only an optional add-on can be ticked")
        for line in lines:
            line.selected = line.optional and line.id in data.line_ids
        price_lines(lines, estimate)
        result = await tax_for_lines(self.db, estimate.business_id, lines)
        apply_totals(estimate, included_totals(lines, result))
        estimate.status = "accepted"
        estimate.accepted_at = clock.now()
        await self.db.commit()
        return await self._context(estimate, business)

    async def decline(self, token: str, data: PublicEstimateDecline) -> PublicEstimate:
        estimate, business = await self._resolve(token, lock=True)
        self._assert_open(estimate, business)
        estimate.status = "declined"
        estimate.declined_at = clock.now()
        estimate.decline_reason = (data.reason or "").strip() or None
        await self.db.commit()
        return await self._context(estimate, business)

    @staticmethod
    def _assert_open(estimate: Estimate, business: Business) -> None:
        status = estimate_status(estimate, local_today(business))
        if status != "sent":
            raise Conflict(f"this estimate is already {status}")

    async def _context(self, estimate: Estimate, business: Business) -> PublicEstimate:
        client = await self.db.get(Client, estimate.client_id)
        lines = await fetch_lines(self.db, estimate.business_id, "estimate", estimate.id)
        priced = await estimate_tax(self.db, estimate, lines)
        doc_lines, taxes = await public_doc_lines(self.db, estimate, lines, priced)
        totals = included_totals(lines, priced[1])
        return PublicEstimate(
            number=estimate.number,
            business_name=business.name,
            brand=public_brand(business),
            contact_email=business.billing_email,
            gst_hst_number=business.gst_hst_number,
            qst_number=business.qst_number,
            client_name=client.name if client is not None else None,
            status=estimate_status(estimate, local_today(business)),
            currency=currency_for(business),
            timezone=business.timezone,
            subtotal_cents=totals.subtotal_cents,
            tax_total_cents=totals.tax_total_cents,
            total_cents=totals.total_cents,
            issued_at=estimate.created_at,
            valid_until=estimate.valid_until,
            notes=estimate.notes,
            decline_reason=estimate.decline_reason,
            lines=[
                PublicEstimateLine(
                    **doc.model_dump(),
                    id=line.id,
                    optional=line.optional,
                    selected=line.selected,
                    tax_cents=line_tax.tax_cents,
                    tax_by_code=line_tax.by_jurisdiction,
                )
                for line, (doc, line_tax) in zip(lines, doc_lines, strict=True)
            ],
            taxes=taxes,
        )


async def owner_staff_id(db: AsyncSession, business_id: str) -> str:
    """The business owner's staff row: who a sale or tip falls to when nobody else is named."""
    staff_id = (
        await db.execute(
            scoped(Staff, business_id)
            .with_only_columns(Staff.id)
            .where(Staff.role == "owner", Staff.status == "active")
            .order_by(Staff.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    if staff_id is None:
        raise NotFound("business not found")
    return staff_id


class PublicReceiptService:
    """A desk sale's receipt; the receipt token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def receipt(self, token: str) -> PublicReceipt:
        msg = "receipt not found"
        order = await resolve_by_token(self.db, Order, Order.receipt_token == token, msg)
        business = await business_or_404(self.db, order.business_id, msg)
        lines = await fetch_lines(self.db, order.business_id, "order", order.id)
        doc_lines, taxes = await public_doc_lines(self.db, order, lines)
        client = await self.db.get(Client, order.client_id) if order.client_id else None
        staff_ids = list(dict.fromkeys(ln.staff_id for ln in lines if ln.staff_id))
        names = (
            await self.db.execute(
                scoped(Staff, order.business_id)
                .with_only_columns(Staff.id, Staff.name)
                .where(Staff.id.in_(staff_ids))
            )
            if staff_ids
            else None
        )
        by_id = dict(names.tuples().all()) if names is not None else {}
        payments = (
            await self.db.execute(
                scoped(Payment, order.business_id)
                .where(Payment.order_id == order.id, Payment.status == "succeeded")
                .order_by(Payment.paid_at)
            )
        ).scalars()
        status, _ = await ledger.order_state(self.db, order)
        rows = [
            PublicReceiptPayment(
                kind="refund" if p.kind == "refund" else "payment",
                method=p.method,
                amount_cents=p.amount_cents,
                tip_cents=p.tip_cents,
                at=p.paid_at,
            )
            for p in payments
        ]
        applied = await ledger.order_deposit_applied(self.db, order)
        if applied > 0:
            rows.insert(
                0,
                PublicReceiptPayment(kind="deposit", method=None, amount_cents=applied, at=None),
            )
        return PublicReceipt(
            number=order.number,
            business_name=business.name,
            brand=public_brand(business),
            gst_hst_number=business.gst_hst_number,
            qst_number=business.qst_number,
            client_name=client.name if client is not None else None,
            served_by=[n for sid in staff_ids if (n := by_id.get(sid))],
            status=status,
            currency=order.currency,
            timezone=business.timezone,
            created_at=order.created_at,
            lines=[line for line, _ in doc_lines],
            discount_cents=sum(ln.sale_discount_cents for ln in lines),
            discount_reason=order.discount_reason,
            subtotal_cents=order.subtotal_cents,
            taxes=taxes,
            tax_total_cents=order.tax_total_cents,
            total_cents=order.total_cents,
            tip_cents=sum(r.tip_cents for r in rows if r.kind == "payment"),
            payments=rows,
        )


class PublicReviewService:
    """Public reviews; the review token is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[Review, Business]:
        review = await resolve_by_token(
            self.db, Review, Review.token == token, "review link not found"
        )
        return review, await business_or_404(self.db, review.business_id, "review link not found")

    async def context(self, token: str) -> PublicReviewContext:
        review, business = await self._resolve(token)
        if review.status == "requested":
            review.status = "opened"
            await self.db.commit()
        return await self._context(review, business)

    async def submit(self, token: str, data: PublicReviewSubmit) -> PublicReviewContext:
        review, business = await self._resolve(token)
        # Lock the row so a second concurrent submit sees the first and gets a 409.
        review = (
            await self.db.execute(select(Review).where(Review.id == review.id).with_for_update())
        ).scalar_one()
        if review.status not in REVIEW_OPEN:
            raise Conflict("this review was already submitted")
        now = clock.now()
        review.rating = data.rating
        review.body = data.body
        review.submitted_at = now
        review.status = "submitted" if data.rating <= business.review_hold_at else "published"
        if review.requested_at is None:
            review.requested_at = now
        await self.db.commit()
        return await self._context(review, business)

    async def _context(self, review: Review, business: Business) -> PublicReviewContext:
        client = await self.db.get(Client, review.client_id)
        booking = await self.db.get(Booking, review.booking_id) if review.booking_id else None
        published = review.status == "published"
        return PublicReviewContext(
            business_name=business.name,
            brand=public_brand(business),
            completed=review.status not in REVIEW_OPEN,
            rating=review.rating,
            first_name=client.name.split(" ")[0] if client is not None else None,
            google_review_url=business.google_review_url if published else None,
            published=published,
            **(await self._visit(booking) if booking is not None else {}),
        )

    async def _visit(self, booking: Booking) -> dict[str, str | None]:
        slot = await self.db.get(Slot, booking.slot_id)
        item = await self.db.get(Item, slot.item_id) if slot is not None else None
        staff = await self.db.get(Staff, booking.staff_id) if booking.staff_id else None
        pet = await self.db.get(Subject, booking.subject_id) if booking.subject_id else None
        return {
            "service": item.name if item is not None else None,
            "staff": staff.name.split(" ")[0] if staff is not None and staff.name else None,
            "pet": pet.name if pet is not None else None,
        }


class PublicPreferencesService:
    """A client's own message preferences; the signed link is the only credential."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[Client, Business]:
        client_id = client_id_for_prefs(token)
        client = await self.db.get(Client, client_id) if client_id is not None else None
        if client is None or client.deleted_at is not None:
            raise NotFound("preferences link not found")
        return client, await business_or_404(
            self.db, client.business_id, "preferences link not found"
        )

    async def context(self, token: str) -> PublicPreferences:
        client, business = await self._resolve(token)
        return await self._out(client, business)

    async def save(self, token: str, data: PublicPreferencesUpdate) -> PublicPreferences:
        client, business = await self._resolve(token)
        await set_channel_consent(self.db, client, "email", agreed=data.email, source="preferences")
        await set_channel_consent(self.db, client, "sms", agreed=data.sms, source="preferences")
        await self.db.commit()
        return await self._out(client, business)

    async def unsubscribe(self, token: str, channel: Channel | None) -> PublicPreferences:
        client, business = await self._resolve(token)
        for each in (channel,) if channel is not None else get_args(Channel):
            await set_channel_consent(self.db, client, each, agreed=False, source="unsubscribe")
        await self.db.commit()
        return await self._out(client, business)

    async def _out(self, client: Client, business: Business) -> PublicPreferences:
        email = (await latest_consents(self.db, business.id, [client.id], "email")).get(client.id)
        sms = (await latest_consents(self.db, business.id, [client.id], "sms")).get(client.id)
        return PublicPreferences(
            business_name=business.name,
            brand=public_brand(business),
            first_name=client.name.split(" ")[0],
            email_hint=_email_hint(client.email),
            phone_hint=_phone_hint(client.phone),
            email=allows_marketing(email),
            sms=allows_marketing(sms),
        )


def _email_hint(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, _, domain = email.partition("@")
    return f"{local[:1]}•••@{domain}"


def _phone_hint(phone: str | None) -> str | None:
    digits = "".join(ch for ch in phone or "" if ch.isdigit())
    return f"•••{digits[-4:]}" if len(digits) >= 4 else None


_SCOPE = "shop.order"


def _stock_left(item: Item) -> int | None:
    return max(item.stock_on_hand or 0, 0) if item.track_stock else None


async def addon_items(db: AsyncSession, business_id: str) -> list[PublicAddon]:
    """Products the owner offers while booking, each with the services it goes with."""
    items = (
        (
            await db.execute(
                scoped(Item, business_id)
                .where(Item.addon.is_(True), Item.active.is_(True), Item.kind == "product")
                .order_by(Item.name)
            )
        )
        .scalars()
        .all()
    )
    images = await item_images(db, business_id, [i.id for i in items])
    return [
        PublicAddon(
            id=i.id,
            name=i.name,
            price_cents=i.price_cents,
            currency=i.currency,
            image_url=images.get(i.id),
            description=i.description,
            in_stock=_stock_left(i) != 0,
            addon_for=list(i.addon_for),
        )
        for i in items
    ]


async def offered_addons(
    db: AsyncSession, business_id: str, service_id: str, lines: list[PublicShopLine]
) -> list[tuple[Item, int]]:
    """Each requested add-on with its quantity, if offered with this service and in stock."""
    wanted: dict[str, int] = {}
    for line in lines:
        wanted[line.item_id] = wanted.get(line.item_id, 0) + line.quantity
    if not wanted:
        return []
    rows = (
        (
            await db.execute(
                scoped(Item, business_id).where(
                    Item.id.in_(wanted),
                    Item.addon.is_(True),
                    Item.active.is_(True),
                    Item.kind == "product",
                )
            )
        )
        .scalars()
        .all()
    )
    found = {i.id: i for i in rows if not i.addon_for or service_id in i.addon_for}
    if set(found) != set(wanted):
        raise NotFound("add-on not found")
    for item_id, qty in wanted.items():
        left = _stock_left(found[item_id])
        if left is not None and left < qty:
            raise Conflict(f"only {left} left of {found[item_id].name}")
    return [(found[item_id], qty) for item_id, qty in wanted.items()]


async def shop_items(db: AsyncSession, business_id: str) -> list[PublicShopItem]:
    """A business's products listed for sale online."""
    items = (
        (
            await db.execute(
                scoped(Item, business_id)
                .where(Item.sell_online.is_(True), Item.active.is_(True), Item.kind == "product")
                .order_by(Item.name)
            )
        )
        .scalars()
        .all()
    )
    images = await item_images(db, business_id, [i.id for i in items])
    return [
        PublicShopItem(
            variant_parent_id=i.variant_parent_id,
            variant_label=i.variant_label,
            id=i.id,
            name=i.name,
            description=i.description,
            price_cents=i.price_cents,
            currency=i.currency,
            image_url=images.get(i.id),
            in_stock=not i.track_stock or (i.stock_on_hand or 0) > 0,
            category=i.category,
            stock_left=_stock_left(i),
        )
        for i in items
        if i.variant_parent_id is None or i.variant_parent_id in {parent.id for parent in items}
    ]


async def online_items(
    db: AsyncSession, business_id: str, lines: list[PublicShopLine]
) -> list[tuple[Item, int]]:
    """Each requested product with its merged quantity, if sold online in this business."""
    wanted: dict[str, int] = {}
    for line in lines:
        wanted[line.item_id] = wanted.get(line.item_id, 0) + line.quantity
    rows = (
        (
            await db.execute(
                scoped(Item, business_id).where(
                    Item.id.in_(wanted),
                    Item.sell_online.is_(True),
                    Item.active.is_(True),
                    Item.kind == "product",
                )
            )
        )
        .scalars()
        .all()
    )
    for item in rows:
        if item.variant_parent_id is not None:
            parent = (
                await db.execute(
                    scoped(Item, business_id).where(
                        Item.id == item.variant_parent_id,
                        Item.active.is_(True),
                        Item.sell_online.is_(True),
                    )
                )
            ).scalar_one_or_none()
            if parent is None:
                raise NotFound("product not found")
        children = (
            (
                await db.execute(
                    scoped(Item, business_id).where(
                        Item.variant_parent_id == item.id,
                        Item.active.is_(True),
                        Item.sell_online.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        if children:
            raise Unprocessable("choose a product variant")
    found = {i.id: i for i in rows}
    if set(found) != set(wanted):
        raise NotFound("product not found")
    return [(found[item_id], qty) for item_id, qty in wanted.items()]


class PublicShopService:
    """The online shop, keyed by business slug; orders are paid online and picked up."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def shop(self, slug: str) -> PublicShop:
        business = await self._business(slug)
        return PublicShop(
            business_name=business.name,
            brand=public_brand(business),
            items=await shop_items(self.db, business.id),
            stripe_account_id=_account(business),
        )

    async def pickup_days(self, slug: str) -> PublicPickupDays:
        business = await self._business(slug)
        return PublicPickupDays(
            windows=await pickup_windows(self.db, business),
            hold_days=pickup_setting(business, "pickup_hold_days", 3),
            timezone=business.timezone,
        )

    async def order(
        self, slug: str, data: PublicShopOrderCreate, idempotency_key: str
    ) -> PublicShopOrderResult:
        business = await self._business(slug)
        account_id = _account(business)
        if account_id is None:
            raise Conflict("this shop isn't taking online payments yet", code="shop_not_ready")

        async def run(cmd: Command) -> PublicShopOrderResult:
            assert_serving(business, clock.now())
            if data.pickup_from is not None:
                await self.db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:scope))"),
                    {"scope": f"pickup:{business.id}"},
                )
                available = await pickup_windows(self.db, business)
                if not any(
                    window.starts_at == data.pickup_from and window.ends_at == data.pickup_to
                    for window in available
                ):
                    raise Conflict(
                        "that pickup window is no longer available", code="pickup_window_taken"
                    )
            wanted = await online_items(self.db, business.id, data.lines)
            for item, qty in wanted:
                if item.track_stock and (item.stock_on_hand or 0) < qty:
                    raise Conflict(
                        f"only {max(item.stock_on_hand or 0, 0)} left of {item.name}",
                        code="out_of_stock",
                    )
            if len({item.currency for item, _ in wanted}) > 1:
                raise Unprocessable("one order can't mix currencies", code="mixed_currencies")
            client = await find_or_create_by_contact(
                self.db,
                business.id,
                name=data.client.name,
                email=data.client.email,
                phone=data.client.phone,
                source="online_shop",
            )
            order = Order(
                id=new_id("order"),
                business_id=business.id,
                client_id=client.id,
                staff_id=await self._owner_staff(business.id),
                number=await next_order_number(self.db, business.id),
                status="open",
                currency=wanted[0][0].currency,
                source="online",
                receipt_token=secrets.token_urlsafe(32),
                status_token=secrets.token_urlsafe(32),
                pickup_from=data.pickup_from,
                pickup_to=data.pickup_to,
                note=data.note,
                notify_sms=data.notify_sms,
            )
            self.db.add(order)
            await self.db.flush()
            lines = await replace_lines(
                self.db,
                business.id,
                "order",
                order.id,
                [
                    LineInput(
                        description=item.name,
                        quantity=qty,
                        unit_amount_cents=item.price_cents,
                        item_id=item.id,
                    )
                    for item, qty in wanted
                ],
            )
            for line in lines:
                line.for_pickup = True
            apply_totals(order, await tax_for_lines(self.db, business.id, lines))
            await self.db.flush()
            _, client_secret = await open_order_card_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=business.id,
                order=order,
                client=client,
                amount=order.total_cents,
                idempotency_key=idempotency_key,
            )
            result = PublicShopOrderResult(
                subtotal_cents=order.subtotal_cents,
                tax_total_cents=order.tax_total_cents,
                order_id=order.id,
                order_token=order.status_token,
                total_cents=order.total_cents,
                currency=order.currency,
                client_secret=client_secret,
                stripe_account_id=account_id,
            )
            cmd.record(_SCOPE, entity_type="order", entity_id=order.id)
            return result

        return await run_command(
            self.db,
            PublicPrincipal(business.id),
            action=_SCOPE,
            run=run,
            response_model=PublicShopOrderResult,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def _owner_staff(self, business_id: str) -> str:
        return await owner_staff_id(self.db, business_id)

    async def _business(self, slug: str) -> Business:
        business = (
            await self.db.execute(select(Business).where(Business.slug == slug))
        ).scalar_one_or_none()
        if business is None:
            raise NotFound("shop not found")
        return business
