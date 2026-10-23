"""The demo engine: a demo business's rows from its spec, through the same paths the seed uses."""

import importlib
import random
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import ClassVar, Literal, get_args

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.models.base import TimestampMixin
from clientbridge.models.billing import Estimate, Invoice, Line, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import (
    GiftCard,
    Item,
    Package,
    StockMovement,
    Subscription,
    SubscriptionStatus,
)
from clientbridge.models.clients import Channel, Client, Consent, Note, NoteParent, Subject
from clientbridge.models.documents import Contract, Form, FormField, FormResponse, Signature
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.payments import Payment, PaymentMethod, SavedMethod
from clientbridge.models.platform import Audit, File
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import (
    Addon,
    Booking,
    BookingStatus,
    Hours,
    Recurrence,
    Slot,
    Weekday,
)
from clientbridge.schemas.business import BrandInput
from clientbridge.schemas.subjects import ATTRIBUTES
from clientbridge.services import ledger
from clientbridge.services.bookings import expand_occurrences
from clientbridge.services.catalog import deposit_cents
from clientbridge.services.consents import allows_marketing
from clientbridge.services.forms import form_definition
from clientbridge.services.tax import TaxResult
from scripts.demo_catalog import add_catalog_images
from scripts.demo_chronology import align_timestamps, chronology_errors
from scripts.demo_context import DEMO_BUSINESSES, DemoBusiness, DemoContext, demo_business
from scripts.demo_finance import (
    apply_deposit_at,
    charge_tax,
    post_invoices,
    post_payments,
    price_documents,
    seed_earnings,
    seed_payouts,
    seed_returns,
    tax_on,
)
from scripts.demo_identity import placeholder_identity
from scripts.demo_photos import add_photos
from scripts.demo_spec import BusinessSpec, ContractSpec, Offering, Pacing, Paid, Settle
from scripts.demo_validate import validate_graph

ASSETS = Path(__file__).parent / "demo_assets"
WEEKDAYS: tuple[Weekday, ...] = get_args(Weekday)
CARDS = (("Visa", "4242"), ("Mastercard", "4444"), ("Visa", "1881"), ("Amex", "8431"))

type Document = Literal["invoice", "estimate", "order"]
type Size = Literal["deposit", "balance", "total", "purchase"]
# item, quantity, description, unit price; an estimate's optional extras
type Extra = tuple[str | None, int, str, int]
type Busy = tuple[str, str | None, datetime, datetime, int, int]


@dataclass(frozen=True)
class Quote:
    """A visit's service and the products sold with it, as a document lists them."""

    service: str
    parts: tuple[tuple[str, int], ...] = ()


def add_months(day: date, months: int) -> date:
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    for last in (31, 30, 29, 28):
        try:
            return date(year, month, min(day.day, last))
        except ValueError:
            continue
    raise ValueError(f"no day in {year}-{month}")


class Demo:
    """One demo business; a vertical subclasses it with its spec and a `story`."""

    spec: ClassVar[BusinessSpec]

    def __init__(self, now: datetime) -> None:
        spec = self.spec
        self.ctx = DemoContext(now, spec.id, spec.owner, zone=spec.listing.zone)
        self.code = spec.code
        self.rng = random.Random(spec.seed)
        self.busy: list[Busy] = []
        self.invoice_number = spec.invoice_start
        self.estimate_number = spec.estimate_start
        self.order_number = 0
        self.payment_number = 0
        self.sized: list[tuple[Payment, Size]] = []
        self.purchases: list[tuple[Payment, Package | GiftCard]] = []
        self.redemptions: list[tuple[str, int, datetime]] = []
        self.items: dict[str, Item] = {}
        self.renewals: dict[str, TaxResult] = {}
        self.offerings = {offering.id: offering for offering in spec.items}
        self.hours = {person.staff_id: person.hours for person in spec.people}
        self.assets = spec.assets or spec.code

    def at(self, days: float, hour: int = 9, minute: int = 0) -> datetime:
        return self.ctx.at(days, hour, minute)

    @property
    def now(self) -> datetime:
        return self.ctx.now

    def local(self, when: datetime) -> datetime:
        return when.astimezone(self.ctx.zone)

    def client_id(self, key: str) -> str:
        return f"cl_{self.code}_{key}"

    def subject_id(self, key: str) -> str | None:
        return f"sj_{self.code}_{key}" if self.spec.subject is not None else None

    def build(self) -> None:
        self.identity()
        self.catalog()
        self.documents()
        self.story()
        self.finish()

    def story(self) -> None:
        raise NotImplementedError

    def identity(self) -> None:
        spec, ctx, listing = self.spec, self.ctx, self.spec.listing
        founded = self.at(spec.founded_day)
        logo = f"fl_{self.code}_logo"
        brand = BrandInput.model_validate(
            {
                "logo_file_id": logo,
                "primary": listing.primary_color,
                **spec.brand,
                "public_staff_ids": [p.staff_id for p in spec.people if p.bookable_online],
            }
        )
        ctx.add(
            Business(
                id=spec.id,
                name=listing.name,
                slug=spec.slug,
                timezone=listing.timezone,
                **asdict(listing.legal),
                gst_hst_number=spec.gst_hst_number,
                pst_number=spec.pst_number,
                tax_registered=spec.gst_hst_number is not None,
                brand=brand.model_dump(exclude_none=True),
                booking_policy=dict(spec.booking_policy),
                billing_email=listing.email,
                sms_number=spec.sms_number,
                # a fixture account, fully onboarded so its status agrees with the seeded payments
                stripe_account_id=spec.stripe_account_id,
                stripe_charges_enabled=True,
                stripe_payouts_enabled=True,
                stripe_requirements={
                    "currently_due": [],
                    "eventually_due": [],
                    "past_due": [],
                    "disabled_reason": None,
                    "card_status": "active",
                    "current_deadline": None,
                },
                status="active",
                plan=spec.plan,
                plan_status="active" if spec.trial_days is None else "trialing",
                trial_ends_at=founded + timedelta(days=14)
                if spec.trial_days is None
                else self.now + timedelta(days=spec.trial_days),
                subject=spec.subject,
                created_at=founded,
                updated_at=founded,
            ),
            File(
                id=logo,
                business_id=spec.id,
                parent_type="business",
                parent_id=spec.id,
                purpose="logo",
                s3_key=f"{spec.id}/demo/{self.assets}_logo.png",
                content_type="image/png",
                size=(ASSETS / f"{self.assets}_logo.png").stat().st_size,
                created_at=founded,
                updated_at=founded,
            ),
        )
        for person in spec.people:
            email = f"{person.login}@{spec.login_domain}"
            ctx.add(
                User(
                    id=person.user_id,
                    identity_id=placeholder_identity(email),
                    email=email,
                    name=person.name,
                    phone=person.phone,
                    created_at=founded,
                    updated_at=founded,
                )
            )
        for person in spec.people:
            rates = {
                key: value
                for key, value in (
                    ("rate_type", person.rate_type),
                    ("rate_bps", person.rate_bps),
                    ("rate_cents", person.rate_cents),
                    ("retail_rate_bps", person.retail_rate_bps),
                )
                if value is not None
            }
            ctx.add(
                Staff(
                    id=person.staff_id,
                    business_id=spec.id,
                    user_id=person.user_id,
                    role=person.role,
                    payee=person.payee,
                    **rates,
                    title=person.title,
                    color=person.color,
                    status="active",
                    bookable_online=person.bookable_online,
                )
            )
        for person in spec.people:
            for weekday, (start, end) in person.hours.items():
                ctx.add(
                    Hours(
                        id=f"av_{person.staff_id}_{weekday}",
                        business_id=spec.id,
                        staff_id=person.staff_id,
                        basis="recurring",
                        weekday=weekday,
                        start_time=start,
                        end_time=end,
                        available=True,
                    )
                )
        for row in ctx.rows:
            if isinstance(row, TimestampMixin):
                row.created_at = row.created_at or founded
                row.updated_at = row.updated_at or founded

    def catalog(self) -> None:
        spec = self.spec
        opened = self.at(spec.catalog_day)
        for offering in spec.items:
            stock = offering.stock
            item = Item(
                id=offering.id,
                business_id=spec.id,
                created_by=spec.owner,
                kind=offering.kind,
                name=offering.name,
                description=offering.description,
                price_cents=offering.price_cents,
                currency="CAD",
                tax_class=offering.tax_class,
                duration_min=offering.minutes,
                capacity=offering.capacity
                if offering.capacity is not None
                else 1
                if offering.kind == "service"
                else None,
                category=offering.category,
                color=offering.color,
                online_bookable=offering.online_bookable,
                sell_online=offering.sell_online,
                addon=bool(offering.addon_for),
                addon_for=list(offering.addon_for),
                staff_ids=sorted(offering.staff),
                buffer_before_min=0,
                buffer_after_min=offering.buffer_after_min,
                deposit_type=offering.deposit_type,
                deposit_value=offering.deposit_value,
                interval=1 if offering.kind == "subscription" else None,
                frequency=offering.frequency,
                session_count=offering.sessions,
                validity_days=offering.validity_days,
                covers_item_id=offering.covers,
                visits_per_period=offering.visits_per_period,
                member_discount_bps=offering.member_discount_bps,
                sku=offering.sku,
                cost_cents=offering.cost_cents,
                track_stock=stock is not None,
                stock_on_hand=stock.on_hand if stock else None,
                low_stock_at=stock.low_at if stock else None,
                active=True,
                created_at=opened,
                updated_at=opened,
            )
            self.items[offering.id] = item
            self.ctx.add(item)
        prefix = f"it_{self.code}_"
        add_catalog_images(
            self.ctx, lambda item_id: f"{self.assets}_it_{item_id.removeprefix(prefix)}"
        )
        for image in self.ctx.all(File):
            if image.parent_type == "item":
                image.created_at = image.updated_at = opened

    def documents(self) -> None:
        spec, ctx = self.spec, self.ctx
        created = self.at(spec.documents_day)
        for form in spec.forms:
            ctx.add(
                Form(
                    id=form.id,
                    business_id=spec.id,
                    name=form.name,
                    require_signature=form.require_signature,
                    active=True,
                    send_on=form.send_on,
                    created_at=created,
                    updated_at=created,
                )
            )
        for contract in spec.contracts:
            since = created if contract.created_day is None else self.at(contract.created_day)
            ctx.add(
                Contract(
                    id=contract.id,
                    business_id=spec.id,
                    name=contract.name,
                    version=contract.version,
                    active=True,
                    body=contract.body,
                    created_at=since,
                    updated_at=since
                    if contract.revised_day is None
                    else self.at(contract.revised_day, 9),
                )
            )
        for form in spec.forms:
            for position, (name, kind, label, hint, required, options) in enumerate(form.fields):
                ctx.add(
                    FormField(
                        id=f"{form.field_prefix}{name}",
                        business_id=spec.id,
                        form_id=form.id,
                        name=name,
                        input=kind,
                        label=label,
                        help=hint,
                        required=required,
                        options=list(options),
                        position=position,
                        created_at=created,
                        updated_at=created,
                    )
                )

    def client(
        self,
        key: str,
        name: str,
        email: str | None,
        phone: str | None,
        *,
        tags: list[str] | None = None,
        channel: Channel = "sms",
        fields: dict[str, object] | None = None,
        subject: str | None = None,
        attributes: dict[str, object] | None = None,
        since: datetime | None = None,
    ) -> Client:
        """A client, dated `since` or from their first booking, with their subject if any."""
        client = Client(
            id=self.client_id(key),
            business_id=self.spec.id,
            created_by=self.spec.owner,
            name=name,
            email=email,
            phone=phone,
            tags=tags or [],
            status="active",
            preferred_channel=channel,
            custom_fields=fields or {},
        )
        if since is not None:
            client.created_at = client.updated_at = since
        self.ctx.add(client)
        if subject is not None:
            self.subject(key, key, subject, attributes or {})
        return client

    def subject(self, key: str, client_key: str, name: str, attributes: dict[str, object]) -> None:
        kind = self.spec.subject
        if kind is None:
            raise ValueError(f"{self.spec.id} has no subject kind for {key}")
        ATTRIBUTES[kind].model_validate(attributes)
        self.ctx.add(
            Subject(
                id=f"sj_{self.code}_{key}",
                business_id=self.spec.id,
                client_id=self.client_id(client_key),
                name=name,
                attributes=attributes,
            )
        )

    def photos(self) -> None:
        add_photos(
            self.ctx,
            self.spec.id,
            [p.user_id for p in self.spec.people if p.photo],
            [self.client_id(key) for key in self.spec.photo_clients],
        )

    def joined(self, key: str, when: datetime) -> None:
        """Clients and their subjects date from their first contact."""
        client = self.ctx.get(Client, self.client_id(key))
        client.created_at = min(client.created_at or when, when)
        client.updated_at = max(client.updated_at or when, when)
        for subject in self.ctx.all(Subject):
            if subject.client_id == client.id:
                subject.created_at = min(subject.created_at or when, when)
                subject.updated_at = max(subject.updated_at or when, when)

    def hours_on(self, staff: str, day: date) -> tuple[time, time] | None:
        return self.hours.get(staff, {}).get(day.weekday())

    def within_hours(self, staff: str, start: datetime, end: datetime) -> bool:
        window = self.hours_on(staff, self.local(start).date())
        return (
            window is not None
            and window[0] <= self.local(start).time()
            and self.local(end).time() <= window[1]
            and self.local(end).date() == self.local(start).date()
        )

    def free(
        self,
        staff: str,
        subject: str | None,
        start: datetime,
        end: datetime,
        before: int = 0,
        after: int = 0,
    ) -> bool:
        return not any(
            (other == staff or (subject is not None and other_subject == subject))
            and start - timedelta(minutes=before) < other_end + timedelta(minutes=other_after)
            and other_start - timedelta(minutes=other_before) < end + timedelta(minutes=after)
            for other, other_subject, other_start, other_end, other_before, other_after in self.busy
        )

    def place(
        self,
        staff: str,
        item_id: str,
        day: int,
        subject: str | None,
        *,
        past: bool,
        not_before: datetime | None = None,
        forward: bool = False,
    ) -> datetime | None:
        """The first free half hour in the member's hours, searching from `day` away from today."""
        item = self.items[item_id]
        minutes = item.duration_min or 60
        step = -1 if past and not forward else 1
        for offset in range(60):
            current = day + step * offset
            if (past and current >= 0) or (not past and current <= 0):
                continue
            local = self.local(self.at(current))
            window = self.hours_on(staff, local.date())
            if window is None:
                continue
            starts = [
                local.replace(hour=h, minute=m)
                for h in range(window[0].hour, window[1].hour)
                for m in (0, 30)
            ]
            for start_local in starts:
                start = start_local.astimezone(UTC)
                end = start + timedelta(minutes=minutes)
                if self.local(end).time() > window[1] or self.local(end).date() != local.date():
                    break
                if start_local.time() < window[0]:
                    continue
                if not_before is not None and start < not_before:
                    continue
                if past and end >= self.now - timedelta(hours=1):
                    continue
                if not past and start <= self.now + timedelta(hours=1):
                    continue
                if self.free(
                    staff, subject, start, end, item.buffer_before_min, item.buffer_after_min
                ):
                    return start
        return None

    def time_off(self, key: str, staff: str, start: datetime, end: datetime, reason: str) -> None:
        self.ctx.add(
            Hours(
                id=f"av_{self.code}_{key}",
                business_id=self.spec.id,
                staff_id=staff,
                basis="exception",
                starts_at=start,
                ends_at=end,
                available=False,
                reason=reason,
                created_at=min(start - timedelta(days=7), self.now - timedelta(days=1)),
            )
        )
        self.busy.append((staff, None, start, end, 0, 0))

    def book(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        start: datetime,
        status: BookingStatus,
        created: datetime,
        *,
        subject: str | None = None,
        source: Literal["online", "manual"] = "manual",
        price: int | None = None,
        package_id: str | None = None,
        slot: Slot | None = None,
    ) -> Booking:
        """A visit in its own slot, or a seat in a class session's `slot`."""
        item = self.items[item_id]
        end = start + timedelta(minutes=item.duration_min or 60)
        subject_id = subject or self.subject_id(client_key)
        if slot is None:
            slot = Slot(
                id=f"ses_{self.code}_{key}",
                business_id=self.spec.id,
                item_id=item_id,
                staff_id=staff,
                starts_at=start,
                ends_at=end,
                capacity=1,
                status="completed"
                if status in {"completed", "no_show"}
                else "canceled"
                if status == "canceled"
                else "scheduled",
                created_at=created,
                updated_at=min(end, self.now),
            )
            self.ctx.add(slot)
            if status != "canceled":
                self.busy.append(
                    (staff, subject_id, start, end, item.buffer_before_min, item.buffer_after_min)
                )
        deposit = deposit_cents(item) if price is None and package_id is None else 0
        booking = Booking(
            id=f"bk_{self.code}_{key}",
            business_id=self.spec.id,
            slot_id=slot.id,
            starts_at=start,
            staff_id=staff,
            client_id=self.client_id(client_key),
            subject_id=subject_id,
            package_id=package_id,
            status=status,
            source=source,
            manage_token=f"manage_bk_{self.code}_{key}" if source == "online" else None,
            price_cents=item.price_cents if price is None else price,
            deposit_amount_cents=deposit,
            deposit_status="pending" if deposit and status in {"pending", "confirmed"} else "none",
            confirmed_at=created + timedelta(hours=1)
            if status in {"confirmed", "completed", "no_show"}
            else None,
            completed_at=end if status == "completed" else None,
            canceled_at=min(start - timedelta(days=1), self.now - timedelta(hours=3))
            if status == "canceled"
            else None,
            checked_in_at=start - timedelta(minutes=5)
            if status == "completed" and slot.capacity > 1
            else None,
            created_at=created,
            updated_at=min(end, self.now),
        )
        self.ctx.add(booking)
        self.joined(client_key, created - timedelta(hours=2))
        return booking

    def session(self, key: str, item_id: str, staff: str, start: datetime) -> Slot:
        """A class session; seat clients on it with `book(..., slot=session)`."""
        item = self.items[item_id]
        end = start + timedelta(minutes=item.duration_min or 60)
        if not self.within_hours(staff, start, end):
            raise ValueError(f"{key}: the class is outside {staff}'s hours")
        if not self.free(staff, None, start, end, item.buffer_before_min, item.buffer_after_min):
            raise ValueError(f"{key}: the class overlaps another visit of {staff}'s")
        slot = Slot(
            id=f"ses_{self.code}_{key}",
            business_id=self.spec.id,
            item_id=item_id,
            staff_id=staff,
            starts_at=start,
            ends_at=end,
            capacity=item.capacity or 1,
            status="completed" if end < self.now else "scheduled",
            created_at=min(start - timedelta(days=21), self.now - timedelta(days=1)),
            updated_at=min(end, self.now),
        )
        self.ctx.add(slot)
        self.busy.append((staff, None, start, end, item.buffer_before_min, item.buffer_after_min))
        return slot

    def series(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        *,
        weekday: int,
        at: time,
        every: int,
        visits: int,
        before: int,
        settle: Settle = "card",
        subject: str | None = None,
        price: int | None = None,
        package_id: str | None = None,
        canceled: tuple[int, ...] = (),
    ) -> Recurrence:
        """A weekly series with `before` visits already done; `canceled` visits are called off."""
        item = self.items[item_id]
        subject = subject or self.subject_id(client_key)
        today = self.local(self.now).date()
        first = today + timedelta(days=(weekday - today.weekday() - 1) % 7 + 1)
        days = expand_occurrences(
            start_date=first - timedelta(weeks=every * before),
            frequency="week",
            interval=every,
            byday=[WEEKDAYS[weekday]],
            count=visits,
            until=None,
        )
        recurrence = Recurrence(
            id=f"sch_{self.code}_{key}",
            business_id=self.spec.id,
            item_id=item_id,
            staff_id=staff,
            client_id=self.client_id(client_key),
            frequency="week",
            interval=every,
            byday=[WEEKDAYS[weekday]],
            count=visits,
            status="active",
        )
        self.ctx.add(recurrence)
        opened = datetime.combine(days[0], at, self.ctx.zone).astimezone(UTC)
        recurrence.created_at = recurrence.updated_at = min(
            opened - timedelta(days=14), self.now - timedelta(days=1)
        )
        for index, day in enumerate(days):
            start = datetime.combine(day, at, self.ctx.zone).astimezone(UTC)
            end = start + timedelta(minutes=item.duration_min or 60)
            if not self.within_hours(staff, start, end):
                raise ValueError(f"{recurrence.id}: visit {index} is outside {staff}'s hours")
            if not self.free(
                staff, subject, start, end, item.buffer_before_min, item.buffer_after_min
            ):
                raise ValueError(f"{recurrence.id}: visit {index} overlaps another visit")
            done = end <= self.now
            status: BookingStatus = (
                "canceled" if index in canceled else "completed" if done else "confirmed"
            )
            booking = self.book(
                f"{key}_{index}",
                client_key,
                item_id,
                staff,
                start,
                status,
                recurrence.created_at,
                subject=subject,
                price=price,
                package_id=package_id,
            )
            self.ctx.get(Slot, booking.slot_id).recurrence_id = recurrence.id
            if status == "completed":
                self.bill(booking, settle)
        return recurrence

    def payment(
        self,
        client_key: str,
        paid_at: datetime,
        method: Paid,
        *,
        kind: Literal["payment", "deposit"] = "payment",
        invoice_id: str | None = None,
        booking_id: str | None = None,
        order_id: str | None = None,
        size: Size = "total",
        tip: tuple[str, int] | None = None,
    ) -> Payment:
        """A settled payment, sized once its document is priced; `tip` is (staff, cents)."""
        self.payment_number += 1
        number = self.payment_number
        payment = Payment(
            id=f"pay_{self.code}_{number:04}",
            business_id=self.spec.id,
            client_id=self.client_id(client_key),
            kind=kind,
            invoice_id=invoice_id,
            booking_id=booking_id,
            order_id=order_id,
            amount_cents=0,
            currency="CAD",
            method=method,
            provider="stripe" if method in {"card", "bank_eft"} else "manual",
            provider_ref=f"pi_demo_{self.code}_{number:04}"
            if method in {"card", "bank_eft"}
            else None,
            reference=f"CA{number:04}{self.code.upper()}ET"
            if method == "etransfer"
            else f"Cheque {self.spec.cheque_start + number}"
            if method == "cheque"
            else None,
            status="succeeded",
            paid_at=paid_at,
            created_at=paid_at - timedelta(minutes=5),
            updated_at=paid_at,
        )
        if tip is not None:
            payment.tip_cents = tip[1]
            payment.tip_split = [{"staff_id": tip[0], "cents": tip[1]}]
        self.ctx.add(payment)
        self.sized.append((payment, size))
        return payment

    def deposit(self, booking: Booking, paid_at: datetime) -> Payment:
        payment = self.payment(
            booking.client_id.removeprefix(f"cl_{self.code}_"),
            paid_at,
            "card",
            kind="deposit",
            booking_id=booking.id,
            size="deposit",
        )
        booking.deposit_status = "collected"
        return payment

    def forfeit(self, booking: Booking) -> None:
        """A no-show keeps its collected deposit; the ledger moves it to revenue after the visit."""
        if booking.status != "no_show" or booking.deposit_status != "collected":
            raise ValueError(f"{booking.id}: only a no-show's collected deposit is forfeited")
        booking.deposit_status = "forfeited"

    def refund(self, payment: Payment, cents: int, when: datetime, reason: str) -> Payment:
        document = (
            str(self.ctx.get(Invoice, payment.invoice_id).number)
            if payment.invoice_id
            else f"S-{self.ctx.get(Order, payment.order_id or '').number}"
        )
        count = len([p for p in self.ctx.all(Payment) if p.parent_payment_id == payment.id])
        refund = Payment(
            id=f"{payment.id}_refund_{count}",
            business_id=self.spec.id,
            client_id=payment.client_id,
            parent_payment_id=payment.id,
            kind="refund",
            amount_cents=cents,
            currency="CAD",
            method=payment.method,
            provider=payment.provider,
            status="succeeded",
            reason=reason,
            credit_note=f"CN-{document}-{count + 1}",
            paid_at=when,
            created_at=when - timedelta(minutes=5),
            updated_at=when,
        )
        self.ctx.add(refund)
        return refund

    def lines(
        self,
        parent: Document,
        parent_id: str,
        quote: Quote,
        created: datetime,
        *,
        booking: Booking | None = None,
        optional: tuple[Extra, ...] = (),
    ) -> None:
        service = self.items[quote.service]
        specs: list[tuple[str | None, int, str, int, bool]] = [
            (
                service.id,
                1,
                service.name,
                booking.price_cents if booking else service.price_cents,
                False,
            ),
            *(
                (part, qty, self.items[part].name, self.items[part].price_cents, False)
                for part, qty in quote.parts
            ),
            *((item_id, qty, name, price, True) for item_id, qty, name, price in optional),
        ]
        for position, (item_id, qty, name, price, extra) in enumerate(specs):
            self.ctx.add(
                Line(
                    id=f"ln_{parent_id}_{position}",
                    business_id=self.spec.id,
                    invoice_id=parent_id if parent == "invoice" else None,
                    estimate_id=parent_id if parent == "estimate" else None,
                    order_id=parent_id if parent == "order" else None,
                    item_id=item_id,
                    booking_id=booking.id if booking is not None and position == 0 else None,
                    staff_id=booking.staff_id if booking is not None and position == 0 else None,
                    description=name,
                    quantity=qty,
                    unit_amount_cents=price,
                    amount_cents=price * qty,
                    tax_class=self.items[item_id].tax_class if item_id else "standard",
                    optional=extra,
                    selected=False,
                    position=position,
                    created_at=created,
                    updated_at=created,
                )
            )

    def line(
        self,
        invoice_id: str,
        item_id: str,
        created: datetime,
        position: int = 0,
        *,
        booking: Booking | None = None,
        quantity: int = 1,
        price: int | None = None,
    ) -> None:
        item = self.items[item_id]
        if price is None:
            price = booking.price_cents if booking is not None else item.price_cents
        self.ctx.add(
            Line(
                id=f"ln_{invoice_id}_{position}",
                business_id=self.spec.id,
                invoice_id=invoice_id,
                item_id=item.id,
                booking_id=booking.id if booking is not None else None,
                staff_id=booking.staff_id if booking is not None else None,
                description=item.name,
                quantity=quantity,
                unit_amount_cents=price,
                amount_cents=price * quantity,
                tax_class=item.tax_class,
                position=position,
                created_at=created,
                updated_at=created,
            )
        )

    def estimate(
        self,
        key: str,
        client_key: str,
        quote: Quote,
        created: datetime,
        *,
        status: Literal["draft", "sent", "accepted", "declined"],
        decided: datetime | None = None,
        note: str | None = None,
        optional: tuple[Extra, ...] = (),
    ) -> Estimate:
        self.estimate_number += 1
        estimate = Estimate(
            id=f"est_{self.code}_{key}",
            business_id=self.spec.id,
            client_id=self.client_id(client_key),
            number=self.estimate_number,
            status=status,
            valid_until=self.local(created + timedelta(days=30)).date(),
            accepted_at=decided if status == "accepted" else None,
            declined_at=decided if status == "declined" else None,
            notes=note,
            view_token=None if status == "draft" else f"demo_estimate_est_{self.code}_{key}",
            created_at=created,
            updated_at=decided or created,
        )
        self.ctx.add(estimate)
        self.lines("estimate", estimate.id, quote, created, optional=optional)
        return estimate

    def addons(self, booking: Booking, estimate: Estimate, quote: Quote) -> None:
        """Book the estimate: its products ride on the booking until checkout bills them."""
        booking.estimate_id = estimate.id
        for index, (part, qty) in enumerate(quote.parts):
            item = self.items[part]
            self.ctx.add(
                Addon(
                    id=f"bka_{booking.id}_{index}",
                    business_id=self.spec.id,
                    booking_id=booking.id,
                    staff_id=booking.staff_id,
                    item_id=item.id,
                    description=item.name,
                    quantity=qty,
                    unit_amount_cents=item.price_cents,
                    created_at=booking.created_at,
                    updated_at=booking.created_at,
                )
            )

    def contract(self, contract_id: str) -> ContractSpec:
        return next(c for c in self.spec.contracts if c.id == contract_id)

    def sign(
        self,
        key: str,
        client_key: str,
        contract_id: str,
        signed: datetime,
        subject: str | None,
        *,
        status: Literal["signed", "pending", "declined"] = "signed",
    ) -> None:
        client = self.ctx.get(Client, self.client_id(client_key))
        contract = self.contract(contract_id)
        earlier = contract.revised_day is not None and signed < self.at(contract.revised_day, 9)
        done = status == "signed"
        self.ctx.add(
            Signature(
                id=f"sig_{self.code}_{key}",
                business_id=self.spec.id,
                contract_id=contract_id,
                client_id=client.id,
                parent_type="client" if subject is None else "subject",
                parent_id=client.id if subject is None else subject,
                token=f"demo_signature_{self.code}_{key}",
                status=status,
                signed_at=signed if done else None,
                signed_body=(contract.earlier_body if earlier else contract.body) if done else None,
                contract_version=1 if earlier else contract.version,
                signer_name=client.name if done else None,
                method="typed" if done else None,
                ip=f"192.0.2.{10 + len(key) * 3 % 200}" if done else None,
                opened_at=signed - timedelta(minutes=12),
                created_at=signed - timedelta(minutes=30),
                updated_at=signed,
            )
        )

    def invoice(
        self, key: str, client_key: str, issued: datetime, created: datetime, note: str
    ) -> Invoice:
        self.invoice_number += 1
        invoice = Invoice(
            id=f"inv_{self.code}_{key}",
            business_id=self.spec.id,
            client_id=self.client_id(client_key),
            number=self.invoice_number,
            status="sent",
            currency="CAD",
            issued_at=issued,
            due_at=issued + timedelta(days=14),
            notes=note,
            pay_token=f"demo_pay_inv_{self.code}_{key}",
            created_at=created,
            updated_at=issued,
        )
        self.ctx.add(invoice)
        return invoice

    def settle(
        self,
        invoice: Invoice,
        client_key: str,
        settle: Settle,
        *,
        tip: tuple[str, int] | None = None,
    ) -> Payment | None:
        """Pay the invoice the way the client usually does, or leave it open or overdue."""
        issued = invoice.issued_at or self.now
        paid: dict[str, datetime] = {
            "card": issued + timedelta(hours=3),
            "etransfer": (issued + timedelta(days=1)).replace(minute=12),
            "cheque": issued + timedelta(days=4),
            "cash": issued + timedelta(minutes=10),
        }
        if settle in paid and paid[settle] < self.now - timedelta(hours=1):
            method: Paid = (
                "card"
                if settle == "card"
                else "etransfer"
                if settle == "etransfer"
                else "cash"
                if settle == "cash"
                else "cheque"
            )
            return self.payment(
                client_key, paid[method], method, invoice_id=invoice.id, size="balance", tip=tip
            )
        due = invoice.due_at or issued
        if settle == "overdue" and due + timedelta(days=1) < self.now:
            invoice.overdue_notified_at = due + timedelta(days=1)
        return None

    def visit_note(self, item: Item, booking: Booking) -> str:
        return f"{item.name}."

    def bill(
        self, booking: Booking, settle: Settle, *, tip: tuple[str, int] | None = None
    ) -> Invoice | None:
        if booking.completed_at is None or not booking.price_cents or booking.package_id:
            return None
        key = booking.id.removeprefix(f"bk_{self.code}_")
        client_key = booking.client_id.removeprefix(f"cl_{self.code}_")
        item = self.items[self.ctx.get(Slot, booking.slot_id).item_id]
        invoice = self.invoice(
            key, client_key, booking.completed_at + timedelta(minutes=20), booking.created_at, ""
        )
        invoice.notes = self.visit_note(item, booking)
        booking.invoice_id = invoice.id
        self.line(invoice.id, item.id, booking.created_at, booking=booking)
        self.settle(invoice, client_key, settle, tip=tip)
        return invoice

    def visit(
        self,
        key: str,
        client_key: str,
        item_id: str,
        staff: str,
        day: int,
        *,
        settle: Settle | None = "card",
        subject: str | None = None,
        price: int | None = None,
        note: str | None = None,
        status: BookingStatus | None = None,
        package_id: str | None = None,
        tip: tuple[str, int] | None = None,
    ) -> Booking | None:
        """A one-off visit placed near `day`, invoiced and settled once it is done."""
        past = day < 0
        subject_id = subject or self.subject_id(client_key)
        start = self.place(staff, item_id, day, subject_id, past=past)
        if start is None:
            return None
        created = min(start - timedelta(days=5), self.now - timedelta(hours=5))
        booking = self.book(
            key,
            client_key,
            item_id,
            staff,
            start,
            status or ("completed" if past else "confirmed"),
            created,
            subject=subject_id,
            price=price,
            package_id=package_id,
        )
        if note:
            self.note(booking.id, "booking", note, created)
        if past and settle is not None:
            self.bill(booking, settle, tip=tip)
        return booking

    def sale(
        self,
        key: str,
        client_key: str,
        staff: str,
        quote: Quote,
        booking: Booking,
        created: datetime,
        paid: datetime,
        *,
        tip: tuple[str, int] | None = None,
    ) -> Order:
        """Checkout by Tap to Pay: a point-of-sale order for the visit, paid by card present."""
        self.order_number += 1
        order = Order(
            id=f"ord_{self.code}_{key}",
            business_id=self.spec.id,
            number=self.order_number,
            client_id=self.client_id(client_key),
            staff_id=staff,
            status="open",
            currency="CAD",
            source="pos",
            paid_at=paid,
            receipt_token=f"demo_receipt_ord_{self.code}_{key}",
            receipt_channel="email",
            receipt_sent_at=paid + timedelta(minutes=1),
            created_at=created,
            updated_at=paid,
        )
        self.ctx.add(order)
        self.lines("order", order.id, quote, created, booking=booking)
        booking.order_id, booking.charged_at = order.id, paid
        if booking.deposit_status == "collected":
            booking.deposit_status = "applied"
        self.payment(client_key, paid, "card", order_id=order.id, size="balance", tip=tip)
        return order

    def note(self, parent_id: str, parent: NoteParent, body: str, when: datetime) -> None:
        count = len([n for n in self.ctx.all(Note) if n.parent_id == parent_id])
        self.ctx.add(
            Note(
                id=f"nt_{parent_id}_{count}",
                business_id=self.spec.id,
                created_by=self.spec.owner,
                parent_type=parent,
                parent_id=parent_id,
                body=body,
                created_at=when,
                updated_at=when,
            )
        )

    def card(
        self,
        client_key: str,
        when: datetime,
        brand: str,
        last4: str,
        *,
        saved: SavedMethod = "card",
    ) -> PaymentMethod:
        """A saved card, or with `saved="bank_eft"` a bank account under a pre-authorized debit."""
        method_id = f"pm_{self.code}_{client_key}"
        found = next((m for m in self.ctx.all(PaymentMethod) if m.id == method_id), None)
        if found is not None:
            return found
        card = saved == "card"
        method = PaymentMethod(
            id=method_id,
            business_id=self.spec.id,
            client_id=self.client_id(client_key),
            method=saved,
            brand=brand,
            last4=last4,
            exp_month=1 + len(client_key) % 12 if card else None,
            exp_year=2028 + len(client_key) % 3 if card else None,
            holder_name=self.ctx.get(Client, self.client_id(client_key)).name,
            bank_name=None if card else brand,
            provider_ref=f"pm_demo_{self.code}_{client_key}",
            preferred=True,
            mandate_status="none" if card else "active",
            created_at=when,
            updated_at=when,
        )
        self.ctx.add(method)
        return method

    def ref(self, offering: Offering) -> str:
        return offering.ref or offering.id.removeprefix(f"it_{self.code}_")

    def subscribe(
        self,
        client_key: str,
        item_id: str,
        start: datetime,
        *,
        status: SubscriptionStatus = "active",
        ended: datetime | None = None,
        bank: tuple[str, str] | None = None,
    ) -> Subscription:
        """A plan charged by card, or by debit from `bank`; past due leaves its renewal unpaid."""
        offering = self.offerings[item_id]
        ref = self.ref(offering)
        brand, last4 = bank or CARDS[len(client_key) % len(CARDS)]
        saved: SavedMethod = "card" if bank is None else "bank_eft"
        method = self.card(client_key, start - timedelta(minutes=30), brand, last4, saved=saved)
        if offering.contract is not None:
            self.sign(
                f"{client_key}_{ref}",
                client_key,
                offering.contract,
                start - timedelta(hours=1),
                None,
            )
        months = 12 if offering.frequency == "year" else 1
        first = self.local(start).date()
        # the Stripe price is the item's price with tax at signup; each renewal backs its tax out
        charged = charge_tax(self.ctx, offering.price_cents, offering.tax_class, first).total_cents

        def period_start(n: int) -> date:
            if offering.frequency == "week":
                return first + timedelta(weeks=n)
            return add_months(first, months * n)

        period = 0
        while True:
            day = period_start(period)
            issued = datetime.combine(day, time(10, 0), self.ctx.zone).astimezone(UTC)
            if issued >= self.now - timedelta(hours=1) or (ended is not None and issued >= ended):
                break
            renewal = datetime.combine(period_start(period + 1), time(10, 0), self.ctx.zone)
            if status == "past_due" and period > 0 and renewal >= self.now - timedelta(hours=1):
                period += 1
                break
            if period == 0 and issued < start:
                issued = start + timedelta(minutes=5)
            following = period_start(period + 1)
            key = f"{ref}_{client_key}_{period:02}"
            invoice = self.invoice(
                key,
                client_key,
                issued,
                issued,
                f"{offering.name}, {day.isoformat()} to {following.isoformat()}.",
            )
            renewal = charge_tax(self.ctx, charged, offering.tax_class, day, included=True)
            self.renewals[invoice.id] = renewal
            self.line(invoice.id, item_id, issued, price=renewal.subtotal_cents)
            self.payment(client_key, issued + timedelta(minutes=2), saved, invoice_id=invoice.id)
            period += 1
        end = period_start(period)
        subscription = Subscription(
            id=f"sub_{self.code}_{ref}_{client_key}",
            business_id=self.spec.id,
            client_id=self.client_id(client_key),
            item_id=item_id,
            status=status,
            current_period_end=datetime.combine(end, time(10, 0), self.ctx.zone).astimezone(UTC),
            payment_method_id=method.id,
            provider_ref=f"sub_demo_{self.code}_{ref}_{client_key}",
            created_at=start,
            updated_at=ended or start,
        )
        self.ctx.add(subscription)
        return subscription

    def package(
        self, client_key: str, item_id: str, bought: datetime, *, key: str | None = None
    ) -> Package:
        """A prepaid bundle bought by card; `key` names a client's second or later one."""
        offering = self.offerings[item_id]
        if offering.sessions is None or offering.covers is None:
            raise ValueError(f"{item_id} is not a package")
        package = Package(
            id=f"pkg_{self.code}_{self.ref(offering)}_{key or client_key}",
            business_id=self.spec.id,
            client_id=self.client_id(client_key),
            item_id=item_id,
            sessions_total=offering.sessions,
            expires_at=bought + timedelta(days=offering.validity_days or 365),
            status="active",
            created_at=bought,
            updated_at=bought,
        )
        self.ctx.add(package)
        payment = self.payment(client_key, bought + timedelta(minutes=5), "card", size="purchase")
        self.purchases.append((payment, package))
        return package

    def gift_card(
        self,
        key: str,
        purchaser_key: str,
        item_id: str,
        cents: int,
        bought: datetime,
        recipient: str | None = None,
    ) -> GiftCard:
        card = GiftCard(
            id=f"gc_{self.code}_{key}",
            business_id=self.spec.id,
            code=f"{self.code.upper()}-GIFT-{key.upper()}",
            item_id=item_id,
            initial_cents=cents,
            purchaser_client_id=self.client_id(purchaser_key),
            recipient=recipient,
            status="active",
            created_at=bought,
            updated_at=bought,
        )
        self.ctx.add(card)
        payment = self.payment(
            purchaser_key, bought + timedelta(minutes=5), "card", size="purchase"
        )
        self.purchases.append((payment, card))
        return card

    def redeem(self, card: GiftCard, cents: int, when: datetime) -> None:
        self.redemptions.append((card.id, cents, when))
        card.updated_at = max(card.updated_at, when)

    def consents(self) -> None:
        ctx = self.ctx
        for index, client in enumerate(sorted(ctx.all(Client), key=lambda c: c.id)):
            online = any(b.source == "online" for b in ctx.all(Booking) if b.client_id == client.id)
            for channel, wanted in (("email", index % 5 != 4), ("sms", index % 3 != 2)):
                if not wanted:
                    continue
                ctx.add(
                    Consent(
                        id=f"cns_{client.id}_{channel}",
                        business_id=self.spec.id,
                        client_id=client.id,
                        channel=channel,
                        status="granted",
                        source="online_booking" if online else "in_person",
                        recorded_by=None if online else self.spec.owner,
                        created_at=client.created_at,
                        updated_at=client.created_at,
                    )
                )

    def withdraw(self, client_key: str, channel: Channel, when: datetime) -> None:
        client_id = self.client_id(client_key)
        self.ctx.add(
            Consent(
                id=f"cns_{client_id}_{channel}_withdrawn",
                business_id=self.spec.id,
                client_id=client_id,
                channel=channel,
                status="withdrawn",
                source="unsubscribe",
                created_at=when,
                updated_at=when,
            )
        )

    def thread(self, client_key: str, channel: Channel, when: datetime) -> Thread:
        thread_id = f"th_{self.code}_{client_key}_{channel}"
        found = next((t for t in self.ctx.all(Thread) if t.id == thread_id), None)
        if found is None:
            found = Thread(
                id=thread_id,
                business_id=self.spec.id,
                client_id=self.client_id(client_key),
                channel=channel,
                status="open",
                created_at=when,
                updated_at=when,
            )
            self.ctx.add(found)
        found.created_at = min(found.created_at, when)
        found.updated_at = max(found.updated_at, when)
        return found

    def say(
        self,
        thread: Thread,
        body: str,
        when: datetime,
        *,
        sender: str | None | Literal["inbox"] = "inbox",
        broadcast_id: str | None = None,
    ) -> None:
        """A message in a thread; the inbox user sends by default and None is the client."""
        if sender == "inbox":
            sender = self.spec.inbox_user or self.spec.owner
        index = len([m for m in self.ctx.all(Message) if m.thread_id == thread.id])
        incoming = sender is None
        self.ctx.add(
            Message(
                id=f"msg_{thread.id}_{index}",
                business_id=self.spec.id,
                thread_id=thread.id,
                direction="in" if incoming else "out",
                channel=thread.channel,
                sent_by=sender,
                body=body,
                status="read" if incoming else "delivered",
                broadcast_id=broadcast_id,
                created_at=when,
                updated_at=when,
            )
        )
        thread.created_at = min(thread.created_at, when)
        thread.updated_at = max(thread.updated_at, when)

    def broadcast(self, key: str, name: str, body: str, when: datetime) -> Broadcast:
        """An email to every client whose consent allowed marketing at the time."""
        ctx = self.ctx
        opened = self.at(self.spec.catalog_day)
        candidates = [c for c in ctx.all(Client) if (c.created_at or opened) <= when and c.email]
        recipients: list[Client] = []
        for client in candidates:
            history = [
                c
                for c in ctx.all(Consent)
                if c.client_id == client.id and c.channel == "email" and c.created_at <= when
            ]
            consent = max(history, key=lambda c: (c.created_at, c.id), default=None)
            if allows_marketing(consent, when):
                recipients.append(client)
        broadcast = Broadcast(
            id=f"bro_{self.code}_{key}",
            business_id=self.spec.id,
            created_by=self.spec.owner,
            name=name,
            channel="email",
            body=body,
            audience={"all": True},
            status="sent",
            scheduled_at=when,
            recipient_count=len(recipients),
            excluded_count=len(candidates) - len(recipients),
            created_at=when - timedelta(days=1),
            updated_at=when,
        )
        ctx.add(broadcast)
        for index, client in enumerate(sorted(recipients, key=lambda c: c.id)):
            thread = self.thread(client.id.removeprefix(f"cl_{self.code}_"), "email", when)
            self.say(
                thread,
                body,
                when + timedelta(seconds=index),
                sender=self.spec.owner,
                broadcast_id=broadcast.id,
            )
        return broadcast

    def review(self, key: str) -> None:
        booking = self.ctx.get(Booking, f"bk_{self.code}_{key}")
        if booking.completed_at is None:
            return
        requested = booking.completed_at + timedelta(hours=2)
        self.ctx.add(
            ReviewRequest(
                id=f"rr_{self.code}_{key}",
                business_id=self.spec.id,
                client_id=booking.client_id,
                booking_id=booking.id,
                requested_at=requested,
                created_at=requested,
                updated_at=requested,
            )
        )

    def response(
        self,
        form_ref: str,
        key: str,
        form_id: str,
        booking: Booking,
        answers: dict[str, object],
        submitted: datetime | None,
        *,
        opened: datetime | None = None,
        created: datetime | None = None,
        signature: dict[str, object] | None = None,
    ) -> FormResponse:
        """A form sent with a booking: a draft, or answers submitted at `submitted`."""
        sent = created or booking.created_at + timedelta(minutes=5)
        response = FormResponse(
            id=f"fr_{self.code}_{form_ref}_{key}",
            business_id=self.spec.id,
            form_id=form_id,
            client_id=booking.client_id,
            parent_type="booking",
            parent_id=booking.id,
            status="draft" if submitted is None else "submitted",
            token=f"demo_{form_ref}_{self.code}_{key}",
            answers=answers,
            created_at=sent,
            updated_at=submitted or sent,
        )
        if submitted is not None:
            response.opened_at = opened or submitted - timedelta(minutes=15)
            response.submitted_at = submitted
        if signature is not None:
            response.signature = signature
        self.ctx.add(response)
        return response

    def fill(
        self,
        clients: Sequence[str],
        pacing: Pacing | None = None,
        *,
        by_staff: Mapping[str, Sequence[str]] | None = None,
    ) -> list[Booking]:
        """Routine visits paced by the spec or `pacing`; `by_staff` gives a member their clients."""
        pacing = pacing or self.spec.pacing
        if pacing is None:
            return []
        made: list[Booking] = []
        turn = 0
        for week in range(-pacing.weeks, pacing.ahead_weeks):
            month = self.local(self.at(week * 7)).month
            seasonal = pacing.services_by_month.get(month, pacing.services)
            for staff, usual in pacing.visits_per_week.items():
                count = round(usual * pacing.seasonality.get(month, 1.0))
                pool = (by_staff or {}).get(staff, clients)
                services = pacing.staff_services.get(staff, seasonal)
                for index in range(count if pool else 0):
                    turn += 1
                    client_key = pool[turn % len(pool)]
                    item_id = services[turn % len(services)]
                    day = week * 7 + index * 5 // max(count, 1) + (1 if week >= 0 else 0)
                    past = day < 0
                    start = self.place(
                        staff, item_id, day, self.subject_id(client_key), past=past, forward=True
                    )
                    if start is None:
                        continue
                    status: BookingStatus = "completed" if past else "confirmed"
                    if past and pacing.no_show_every and turn % pacing.no_show_every == 0:
                        status = "no_show"
                    elif pacing.cancel_every and turn % pacing.cancel_every == 0:
                        status = "canceled"
                    created = min(start - timedelta(days=4), self.now - timedelta(hours=5))
                    booking = self.book(
                        f"fill_{staff.removeprefix(f'st_{self.code}_')}_{turn:04}",
                        client_key,
                        item_id,
                        staff,
                        start,
                        status,
                        created,
                        source="online" if turn % 3 == 0 else "manual",
                    )
                    if booking.deposit_amount_cents and status != "canceled":
                        self.deposit(booking, created + timedelta(minutes=10))
                        if status == "no_show":
                            self.forfeit(booking)
                    if status == "completed":
                        self.bill(booking, pacing.settlements[turn % len(pacing.settlements)])
                    made.append(booking)
        return made

    def finish(self) -> None:
        ctx = self.ctx
        price_documents(ctx)
        for invoice_id, renewal in self.renewals.items():
            invoice = ctx.get(Invoice, invoice_id)
            ctx.get(Line, f"ln_{invoice_id}_0").tax_amount_cents = renewal.tax_total_cents
            invoice.subtotal_cents, invoice.tax_total_cents, invoice.total_cents = (
                renewal.subtotal_cents,
                renewal.tax_total_cents,
                renewal.total_cents,
            )
        parents: dict[str, Invoice | Order] = {
            **{i.id: i for i in ctx.all(Invoice)},
            **{o.id: o for o in ctx.all(Order)},
        }
        purchased = {payment.id: target for payment, target in self.purchases}
        deposits: dict[str, int] = {}
        for booking in ctx.all(Booking):
            if booking.deposit_status not in {"collected", "applied"}:
                continue
            for parent_id in {booking.invoice_id, booking.order_id} - {None}:
                assert parent_id is not None
                deposits[parent_id] = deposits.get(parent_id, 0) + booking.deposit_amount_cents
        for payment, size in self.sized:
            if size == "deposit":
                payment.amount_cents = ctx.get(
                    Booking, payment.booking_id or ""
                ).deposit_amount_cents
                continue
            if size == "purchase":
                target = purchased[payment.id]
                if isinstance(target, GiftCard):
                    payment.amount_cents = target.initial_cents
                else:
                    item = self.items[target.item_id]
                    payment.amount_cents = tax_on(
                        ctx, [Line(amount_cents=item.price_cents, tax_class=item.tax_class)]
                    ).total_cents
                continue
            parent = parents[payment.invoice_id or payment.order_id or ""]
            held = deposits.get(parent.id, 0)
            payment.amount_cents = (
                parent.total_cents - (held if size == "balance" else 0) + (payment.tip_cents or 0)
            )
        for refund in ctx.all(Payment):
            if refund.kind == "refund":
                original = ctx.get(Payment, refund.parent_payment_id or "")
                refund.amount_cents = min(refund.amount_cents, original.amount_cents)
        self.stock(parents)
        forms = {form.id: form for form in ctx.all(Form)}
        for response in ctx.all(FormResponse):
            response.definition = form_definition(
                forms[response.form_id],
                [f for f in ctx.all(FormField) if f.form_id == response.form_id],
                "reconstructed",
            )
        for file in ctx.all(File):
            file.uploaded_at = file.updated_at or file.created_at
        for row in ctx.rows:
            if isinstance(row, TimestampMixin):
                row.created_at = row.created_at or self.at(self.spec.catalog_day)
                row.updated_at = row.updated_at or row.created_at
        align_timestamps(ctx)
        ctx.add(
            Audit(
                id=f"aud_{self.code}_demo_seed",
                business_id=self.spec.id,
                performed_by=self.spec.owner,
                action="demo.seed",
                entity_type="business",
                entity_id=self.spec.id,
                changes={"as_of": self.now.isoformat()},
                created_at=self.now,
            )
        )

    def stock(self, parents: dict[str, Invoice | Order]) -> None:
        """Sales take stock from paid documents; deliveries through the year make up the count."""
        ctx = self.ctx
        stocked = {o.id: o for o in self.spec.items if o.stock is not None}
        paid = {
            p.invoice_id or p.order_id: p.paid_at
            for p in ctx.all(Payment)
            if p.kind == "payment" and (p.invoice_id or p.order_id) and p.paid_at
        }
        sold: dict[str, int] = {}
        for line in ctx.all(Line):
            parent_id = line.invoice_id or line.order_id
            if parent_id is None or parent_id not in paid or line.item_id not in stocked:
                continue
            when = paid[parent_id]
            assert when is not None and parent_id in parents
            sold[line.item_id] = sold.get(line.item_id, 0) + int(line.quantity)
            ctx.add(
                StockMovement(
                    id=f"sm_sale_{line.id}",
                    business_id=self.spec.id,
                    item_id=line.item_id,
                    line_id=line.id,
                    reason="sale",
                    quantity=-int(line.quantity),
                    created_by=self.spec.owner,
                    created_at=when,
                    updated_at=when,
                )
            )
        deliveries = self.spec.restock_days
        for item_id, offering in stocked.items():
            assert offering.stock is not None
            needed = offering.stock.on_hand + sold.get(item_id, 0)
            share = needed // len(deliveries)
            for index, day in enumerate(deliveries):
                quantity = share if index < len(deliveries) - 1 else needed - share * index
                if quantity <= 0:
                    continue
                when = self.at(day, 8)
                ctx.add(
                    StockMovement(
                        id=f"mv_{item_id}_{index}",
                        business_id=self.spec.id,
                        item_id=item_id,
                        reason="restock",
                        quantity=quantity,
                        unit_cost_cents=offering.cost_cents,
                        note="Opening count" if index == 0 else "Supplier delivery",
                        created_by=self.spec.owner,
                        created_at=when,
                        updated_at=when,
                    )
                )
            self.items[item_id].stock_on_hand = offering.stock.on_hand

    def errors(self) -> list[str]:
        """Graph, chronology and storyline problems; the seed writes nothing while any remain."""
        ids = {getattr(row, "id", None) for row in self.ctx.rows}
        stages = [
            f"{stage.name}: {missing} is missing"
            for stage in self.spec.storyline
            for missing in (self.client_id(stage.client), *stage.rows)
            if missing not in ids
        ]
        return validate_graph(self.ctx) + chronology_errors(self.ctx) + stages


def editions(*, core: bool = False) -> list[type[Demo]]:
    return [
        _edition(listing)
        for listing in DEMO_BUSINESSES
        if listing.edition is not None and (listing.core or not core)
    ]


def edition_of(business_id: str) -> type[Demo]:
    return _edition(demo_business(business_id))


def _edition(listing: DemoBusiness) -> type[Demo]:
    assert listing.edition is not None
    edition: object = importlib.import_module(listing.edition).EDITION
    if not (isinstance(edition, type) and issubclass(edition, Demo)):
        raise TypeError(f"{listing.edition}.EDITION is not a demo engine edition")
    return edition


def build_edition(edition: type[Demo], now: datetime) -> Demo:
    demo = edition(now)
    demo.build()
    errors = demo.errors()
    if errors:
        raise ValueError(f"Invalid {demo.spec.listing.name} demo graph: " + "; ".join(errors[:20]))
    return demo


async def seed_ledger(db: AsyncSession, demo: Demo) -> None:
    ctx = demo.ctx
    await post_invoices(db, ctx)
    for payment, target in demo.purchases:
        target.payment_id = payment.id
    await db.flush()
    await post_payments(db, ctx)
    for booking in sorted(ctx.all(Booking), key=lambda b: b.completed_at or ctx.now):
        if booking.deposit_status == "collected" and booking.invoice_id:
            await apply_deposit_at(db, booking, ctx.get(Invoice, booking.invoice_id))
    for booking in sorted(ctx.all(Booking), key=lambda b: b.completed_at or ctx.now):
        if booking.package_id and booking.status == "completed":
            await ledger.post_consumption(
                db,
                ctx.get(Package, booking.package_id),
                occurred_at=booking.completed_at,
                booking_id=booking.id,
            )
    resume = clock.now()
    try:
        for card_id, cents, when in demo.redemptions:
            clock.freeze(when)
            await ledger.post_redemption(db, ctx.get(GiftCard, card_id), cents)
        for booking in sorted(ctx.all(Booking), key=lambda b: b.starts_at):
            if booking.deposit_status == "forfeited":
                clock.freeze(ctx.get(Slot, booking.slot_id).ends_at + timedelta(hours=2))
                await ledger.post_forfeit(db, booking)
    finally:
        clock.travel(resume)
    await seed_earnings(db, ctx)
    await seed_payouts(
        db, ctx, first_day=demo.spec.payouts_from_day, failed_day=demo.spec.failed_payout_day
    )
    await seed_returns(db, ctx)
