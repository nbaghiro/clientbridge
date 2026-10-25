import secrets
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for, message, plural
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Estimate, EstimateStatus, Invoice, Line, Order
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, TaxClass
from clientbridge.models.clients import Client
from clientbridge.models.payments import Payment
from clientbridge.models.scheduling import Addon, Booking, Slot
from clientbridge.schemas.billing import (
    EstimateCreate,
    EstimateOut,
    EstimateUpdate,
    InvoiceCreate,
    InvoiceOut,
    InvoiceUpdate,
    LineInput,
)
from clientbridge.schemas.orders import VisitReceipt
from clientbridge.services import ledger
from clientbridge.services.bookings import apply_deposit, hold_estimate, is_program, unapply_deposit
from clientbridge.services.business import business_tz, businesses_at_hour
from clientbridge.services.ledger import invoice_status_expr
from clientbridge.services.lines import (
    LineParent,
    apply_totals,
    discount_of,
    discount_total,
    fetch_lines,
    included,
    included_totals,
    line_out,
    price_lines,
    replace_lines,
    set_discount,
)
from clientbridge.services.notifications import Notifier, Outcome, queued_notifier
from clientbridge.services.payments import close_settled_visit, sync_invoice
from clientbridge.services.tax import tax_for_lines

_DUE_DAYS = 30
_VALID_DAYS = 14
_OVERDUE_HOUR = 7


class BillingService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def create_invoice(self, data: InvoiceCreate, idempotency_key: str | None) -> InvoiceOut:
        self._assert_admin()
        await self._client(data.client_id)

        async def run(cmd: Command) -> InvoiceOut:
            invoice = Invoice(
                id=new_id("invoice"),
                business_id=self.biz,
                client_id=data.client_id,
                status="draft",
                currency="CAD",
                notes=data.notes,
                due_at=data.due_at,
            )
            set_discount(invoice, data.discount)
            self.db.add(invoice)
            await self.db.flush()
            lines = await self._replace_lines("invoice", invoice, data.lines)
            await self._apply_totals(invoice, lines)
            await self.db.flush()
            cmd.record("invoice.create", entity_type="invoice", entity_id=invoice.id)
            if data.send:
                if not lines:
                    raise Unprocessable("add a line before sending the invoice")
                await issue_invoice(self.db, invoice, cmd)
                await self._queue_send(invoice.id)
            return await invoice_out(self.db, invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db,
            self.principal,
            action="invoice.create",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def update_invoice(self, invoice_id: str, data: InvoiceUpdate) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        if invoice.status != "draft":
            raise Conflict("only a draft invoice can be edited")

        async def run(cmd: Command) -> InvoiceOut:
            if data.notes is not None:
                invoice.notes = data.notes
            if data.due_at is not None:
                invoice.due_at = data.due_at
            if "discount" in data.model_fields_set:
                set_discount(invoice, data.discount)
            lines = (
                await self._replace_lines("invoice", invoice, data.lines)
                if data.lines is not None
                else await self._repriced("invoice", invoice)
            )
            await self._apply_totals(invoice, lines)
            await self.db.flush()
            cmd.record("invoice.update", entity_type="invoice", entity_id=invoice.id)
            return await invoice_out(self.db, invoice, lines)

        return await run_command(
            self.db, self.principal, action="invoice.update", run=run, response_model=InvoiceOut
        )

    async def _queue_send(self, invoice_id: str) -> None:
        """Each send is its own delivery, so a replay sends nothing new and a resend sends again."""
        scope = f"{sent_scope(invoice_id)}:{new_id('delivery')}"
        await queued_notifier(self.db, scope, self.biz).on_invoice_sent(self.db, invoice_id)

    async def send_invoice(self, invoice_id: str, idempotency_key: str | None) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        if invoice.status == "void":
            raise Conflict("a void invoice can't be sent")

        async def run(cmd: Command) -> InvoiceOut:
            if invoice.status == "draft":
                await issue_invoice(self.db, invoice, cmd)
            else:
                cmd.record("invoice.resend", entity_type="invoice", entity_id=invoice.id)
            await self._queue_send(invoice.id)
            return await invoice_out(self.db, invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db,
            self.principal,
            action="invoice.send",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
            request={"invoice_id": invoice_id},
        )

    async def remind_invoice(self, invoice_id: str, idempotency_key: str | None) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        if invoice.status != "sent":
            raise Conflict(f"a {invoice.status} invoice can't be reminded")
        if await ledger.invoice_balance(self.db, invoice) <= 0:
            raise Conflict("this invoice has nothing left to pay")

        async def run(cmd: Command) -> InvoiceOut:
            cmd.record("invoice.remind", entity_type="invoice", entity_id=invoice.id)
            scope = f"{reminder_scope(invoice.id)}:{new_id('delivery')}"
            await queued_notifier(self.db, scope, self.biz).on_invoice_reminder(self.db, invoice.id)
            return await invoice_out(self.db, invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db,
            self.principal,
            action="invoice.remind",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
            request={"invoice_id": invoice_id},
        )

    async def void_invoice(self, invoice_id: str) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        status, _ = await ledger.invoice_state(self.db, invoice)
        cash, _ = await ledger.collected(self.db, invoice.business_id, "invoice", invoice.id)
        if status in ("paid", "refunded", "void") or cash != 0:
            raise Conflict(f"a {status} invoice can't be voided")

        async def run(cmd: Command) -> InvoiceOut:
            if await payment_pending(self.db, invoice):
                raise Conflict("this invoice has a payment in progress")
            await void_issued(self.db, invoice, cmd)
            return await invoice_out(self.db, invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db, self.principal, action="invoice.void", run=run, response_model=InvoiceOut
        )

    async def create_estimate(
        self, data: EstimateCreate, idempotency_key: str | None
    ) -> EstimateOut:
        self._assert_admin()
        await self._client(data.client_id)

        async def run(cmd: Command) -> EstimateOut:
            estimate = Estimate(
                id=new_id("estimate"),
                business_id=self.biz,
                client_id=data.client_id,
                status="draft",
                notes=data.notes,
                valid_until=data.valid_until,
            )
            set_discount(estimate, data.discount)
            self.db.add(estimate)
            await self.db.flush()
            lines = await self._replace_lines("estimate", estimate, data.lines)
            await self._apply_totals(estimate, lines)
            await self.db.flush()
            cmd.record("estimate.create", entity_type="estimate", entity_id=estimate.id)
            if data.send:
                if not any(included(ln) for ln in lines):
                    raise Unprocessable("add a line before sending the estimate")
                await self._issue_estimate(estimate, cmd)
            return _estimate_out(estimate, lines, await self._today())

        return await run_command(
            self.db,
            self.principal,
            action="estimate.create",
            run=run,
            response_model=EstimateOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def update_estimate(self, estimate_id: str, data: EstimateUpdate) -> EstimateOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        if estimate.status not in ("draft", "sent"):
            raise Conflict("only a draft or sent estimate can be edited")

        async def run(cmd: Command) -> EstimateOut:
            if data.notes is not None:
                estimate.notes = data.notes
            if data.valid_until is not None:
                estimate.valid_until = data.valid_until
            if "discount" in data.model_fields_set:
                set_discount(estimate, data.discount)
            lines = (
                await self._replace_lines("estimate", estimate, data.lines)
                if data.lines is not None
                else await self._repriced("estimate", estimate)
            )
            await self._apply_totals(estimate, lines)
            await self.db.flush()
            cmd.record("estimate.update", entity_type="estimate", entity_id=estimate.id)
            return _estimate_out(estimate, lines, await self._today())

        return await run_command(
            self.db, self.principal, action="estimate.update", run=run, response_model=EstimateOut
        )

    async def send_estimate(self, estimate_id: str) -> EstimateOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        status = estimate_status(estimate, await self._today())
        if status in ("accepted", "declined", "expired"):
            raise Conflict(f"a {status} estimate can't be sent")

        async def run(cmd: Command) -> EstimateOut:
            if estimate.status == "draft":
                await self._issue_estimate(estimate, cmd)
            else:
                cmd.record("estimate.resend", entity_type="estimate", entity_id=estimate.id)
            return _estimate_out(
                estimate, await self._lines("estimate", estimate.id), await self._today()
            )

        return await run_command(
            self.db, self.principal, action="estimate.send", run=run, response_model=EstimateOut
        )

    async def _issue_estimate(self, estimate: Estimate, cmd: Command) -> None:
        estimate.number = await next_number(self.db, self.biz, Estimate)
        estimate.status = "sent"
        estimate.view_token = secrets.token_urlsafe(16)
        if estimate.valid_until is None:
            estimate.valid_until = await self._today() + timedelta(days=_VALID_DAYS)
        try:
            await self.db.flush()  # the unique (business_id, number) backstops a concurrent send
        except IntegrityError as exc:
            raise Conflict("that number was just assigned — please retry") from exc
        cmd.record("estimate.send", entity_type="estimate", entity_id=estimate.id)

    async def accept_estimate(self, estimate_id: str) -> EstimateOut:
        return await self._set_estimate_status(estimate_id, "accepted")

    async def decline_estimate(self, estimate_id: str, reason: str | None = None) -> EstimateOut:
        return await self._set_estimate_status(estimate_id, "declined", reason)

    async def convert_estimate(self, estimate_id: str, idempotency_key: str | None) -> InvoiceOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        if estimate_status(estimate, await self._today()) not in ("sent", "accepted"):
            raise Conflict("only a sent or accepted estimate can be converted")
        await self._client(estimate.client_id)

        async def run(cmd: Command) -> InvoiceOut:
            invoiced, booked = await hold_estimate(self.db, self.biz, estimate.id)
            if invoiced is not None:
                raise Conflict("this estimate was already converted")
            if booked is not None:
                raise Conflict(
                    "the estimate's products are billed on its booked visit; "
                    "cancel the visit to convert the estimate",
                    code="estimate_on_visit",
                )
            invoice = Invoice(
                id=new_id("invoice"),
                business_id=self.biz,
                client_id=estimate.client_id,
                status="draft",
                currency="CAD",
                notes=estimate.notes,
                discount_kind=estimate.discount_kind,
                discount_value=estimate.discount_value,
                discount_reason=estimate.discount_reason,
            )
            self.db.add(invoice)
            await self.db.flush()
            inputs = [
                LineInput(
                    description=ln.description,
                    quantity=float(ln.quantity),
                    unit_amount_cents=ln.unit_amount_cents,
                    item_id=ln.item_id,
                    booking_id=ln.booking_id,
                    tax_class=_tax_class(ln.tax_class),
                    staff_id=ln.staff_id,
                    discount=discount_of(ln),
                )
                for ln in await self._lines("estimate", estimate.id)
                if included(ln)
            ]
            lines = await self._replace_lines("invoice", invoice, inputs)
            await self._apply_totals(invoice, lines)
            estimate.converted_invoice_id = invoice.id
            await self.db.flush()
            cmd.record("estimate.convert", entity_type="estimate", entity_id=estimate.id)
            cmd.record("invoice.create", entity_type="invoice", entity_id=invoice.id)
            return await invoice_out(self.db, invoice, lines)

        return await run_command(
            self.db,
            self.principal,
            action="estimate.convert",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
            request={"estimate_id": estimate_id},
        )

    async def _set_estimate_status(
        self, estimate_id: str, status: EstimateStatus, reason: str | None = None
    ) -> EstimateOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        current = estimate_status(estimate, await self._today())
        if current not in ("sent", "accepted", "declined"):
            raise Conflict(f"a {current} estimate can't be {status}")

        async def run(cmd: Command) -> EstimateOut:
            estimate.status = status
            if status == "accepted":
                # accepted at today's prices and rates, as the client's own acceptance is
                await self._apply_totals(estimate, await self._repriced("estimate", estimate))
                estimate.accepted_at = clock.now()
            elif status == "declined":
                estimate.declined_at = clock.now()
                estimate.decline_reason = reason
            await self.db.flush()
            cmd.record(f"estimate.{status}", entity_type="estimate", entity_id=estimate.id)
            return _estimate_out(
                estimate, await self._lines("estimate", estimate.id), await self._today()
            )

        return await run_command(
            self.db,
            self.principal,
            action=f"estimate.{status}",
            run=run,
            response_model=EstimateOut,
        )

    async def create_invoice_for_booking(
        self, booking_id: str, idempotency_key: str | None
    ) -> InvoiceOut:
        """A draft invoice for one visit and its add-ons; a booking is invoiced once."""
        self._assert_admin()
        booking = await self._booking(booking_id)

        async def run(cmd: Command) -> InvoiceOut:
            invoice, lines = await draft_for_booking(self.db, booking)
            cmd.record("invoice.create", entity_type="invoice", entity_id=invoice.id)
            return await invoice_out(self.db, invoice, lines)

        return await run_command(
            self.db,
            self.principal,
            action="invoice.from_booking",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
            request={"booking_id": booking_id},
        )

    async def visit_receipt(self, booking_id: str) -> VisitReceipt:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can print receipts"
        )
        booking = await self._booking(booking_id)
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        from clientbridge.services.public import visit_receipt

        return await visit_receipt(self.db, booking, business)

    async def _booking(self, booking_id: str) -> Booking:
        row = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True).where(Booking.id == booking_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("booking not found")
        return row

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage billing"
        )

    async def _apply_totals(self, parent: Invoice | Estimate, lines: list[Line]) -> None:
        apply_totals(parent, included_totals(lines, await tax_for_lines(self.db, self.biz, lines)))

    async def _replace_lines(
        self, parent: LineParent, document: Invoice | Estimate, inputs: list[LineInput]
    ) -> list[Line]:
        return await replace_lines(self.db, self.biz, parent, document.id, inputs, document)

    async def _repriced(self, parent: LineParent, document: Invoice | Estimate) -> list[Line]:
        lines = await self._lines(parent, document.id)
        price_lines(lines, document)
        return lines

    async def _today(self) -> date:
        return clock.today(await business_tz(self.db, self.biz))

    async def _lines(self, parent: LineParent, parent_id: str) -> list[Line]:
        return await fetch_lines(self.db, self.biz, parent, parent_id)

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True)
                .where(Client.id == client_id)
                .with_for_update(read=True, key_share=True)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _invoice(self, invoice_id: str) -> Invoice:
        row = (
            await self.db.execute(scoped(Invoice, self.biz).where(Invoice.id == invoice_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("invoice not found")
        return row

    async def _estimate(self, estimate_id: str) -> Estimate:
        row = (
            await self.db.execute(scoped(Estimate, self.biz).where(Estimate.id == estimate_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("estimate not found")
        return row


async def next_number(
    db: AsyncSession, business_id: str, model: type[Invoice] | type[Estimate]
) -> int:
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"number:{business_id}:{model.__tablename__}", 0)
            )
        )
    )
    return await peek_number(db, business_id, model)


async def invoice_bookings(db: AsyncSession, invoice: Invoice) -> list[Booking]:
    rows = await db.execute(
        scoped(Booking, invoice.business_id)
        .join(Line, Line.booking_id == Booking.id)
        .where(Line.invoice_id == invoice.id)
        .distinct()
    )
    return list(rows.scalars().all())


async def booking_lines(db: AsyncSession, booking: Booking) -> tuple[list[LineInput], Item | None]:
    """A visit's lines: its service, named with its day count for a program, then its add-ons."""
    slot = await db.get(Slot, booking.slot_id)
    item = await db.get(Item, slot.item_id) if slot is not None else None
    addons = await db.scalars(
        scoped(Addon, booking.business_id)
        .where(Addon.booking_id == booking.id)
        .order_by(Addon.created_at, Addon.id)
    )
    locale = locale_for(
        business=await db.get(Business, booking.business_id),
        client=await db.get(Client, booking.client_id),
    )
    if item is None:
        description = message(locale, "invoice_line.visit")
    elif is_program(item) and item.session_count is not None:
        description = plural(locale, "invoice_line.program", item.session_count, program=item.name)
    else:
        description = item.name
    return [
        LineInput(
            description=description,
            quantity=1,
            unit_amount_cents=booking.price_cents,
            item_id=item.id if item is not None else None,
            booking_id=booking.id,
        ),
        *(
            LineInput(
                description=a.description,
                quantity=a.quantity,
                unit_amount_cents=a.unit_amount_cents,
                item_id=a.item_id,
                booking_id=booking.id,
                staff_id=a.staff_id or booking.staff_id,
            )
            for a in addons
        ),
    ], item


async def draft_for_booking(db: AsyncSession, booking: Booking) -> tuple[Invoice, list[Line]]:
    """The visit's draft invoice, refused while an earlier one stands."""
    if booking.invoice_id is not None:
        prior = await db.get(Invoice, booking.invoice_id)
        if prior is not None and prior.status != "void":
            raise Conflict("this visit already has an invoice")
    inputs, item = await booking_lines(db, booking)
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=booking.business_id,
        client_id=booking.client_id,
        status="draft",
        currency=item.currency if item is not None else "CAD",
    )
    db.add(invoice)
    await db.flush()
    lines = await replace_lines(db, booking.business_id, "invoice", invoice.id, inputs, invoice)
    apply_totals(
        invoice, included_totals(lines, await tax_for_lines(db, booking.business_id, lines))
    )
    booking.invoice_id = invoice.id
    await db.flush()
    return invoice, lines


async def issue_invoice(db: AsyncSession, invoice: Invoice, cmd: Command) -> None:
    """Number, date and post a draft invoice; its tax is fixed here and matches its journal."""
    biz = invoice.business_id
    now = clock.now()
    invoice.number = await next_number(db, biz, Invoice)
    invoice.status = "sent"
    invoice.issued_at = now
    invoice.pay_token = secrets.token_urlsafe(16)
    if invoice.due_at is None:
        invoice.due_at = now + timedelta(days=_DUE_DAYS)
    lines = await fetch_lines(db, biz, "invoice", invoice.id)
    tax = await tax_for_lines(db, biz, lines)
    apply_totals(invoice, tax)
    try:
        await db.flush()  # the unique (business_id, number) backstops a concurrent send
    except IntegrityError as exc:
        raise Conflict("that number was just assigned — please retry") from exc
    await ledger.post_invoice(db, invoice, tax)
    bookings = await invoice_bookings(db, invoice)
    applied = False
    for booking in bookings:
        applied = await apply_deposit(db, booking, invoice) or applied
    if applied:
        await sync_invoice(db, invoice.id)
    for booking in bookings:
        if booking.order_id is not None:
            sale = await db.get(Order, booking.order_id)
            if sale is not None and sale.status != "void":
                raise Conflict("this visit is already on a sale")
        booking.invoice_id = booking.invoice_id or invoice.id
        await close_settled_visit(db, booking, "booking.complete_on_invoice", invoice_id=invoice.id)
    cmd.record("invoice.send", entity_type="invoice", entity_id=invoice.id)


async def payment_pending(db: AsyncSession, invoice: Invoice) -> bool:
    pending = await db.scalar(
        scoped(Payment, invoice.business_id)
        .with_only_columns(Payment.id)
        .where(Payment.invoice_id == invoice.id, Payment.status == "pending")
        .limit(1)
    )
    return pending is not None


async def void_issued(db: AsyncSession, invoice: Invoice, cmd: Command) -> None:
    """Void an invoice and reverse its journal, handing any applied deposit back to its visit."""
    invoice.status = "void"
    invoice.voided_at = clock.now()
    await db.flush()
    await ledger.void_invoice(db, invoice)
    for booking in await invoice_bookings(db, invoice):
        await unapply_deposit(db, booking, invoice.id)
    cmd.record("invoice.void", entity_type="invoice", entity_id=invoice.id)


async def issue_enrolment_invoice(db: AsyncSession, first: Booking, cmd: Command) -> Invoice:
    """Bill a program enrolment on its first day, which carries the price, due when it starts."""
    invoice, _ = await draft_for_booking(db, first)
    invoice.due_at = first.starts_at
    cmd.record("invoice.create", entity_type="invoice", entity_id=invoice.id)
    await issue_invoice(db, invoice, cmd)
    return invoice


async def void_enrolment_invoice(db: AsyncSession, first: Booking, cmd: Command) -> bool:
    """Void a canceled enrolment's invoice; False once money was taken on it, for a refund."""
    invoice = await db.get(Invoice, first.invoice_id) if first.invoice_id is not None else None
    if invoice is None or invoice.status != "sent":
        return True
    cash, _ = await ledger.collected(db, invoice.business_id, "invoice", invoice.id)
    if cash != 0 or await payment_pending(db, invoice):
        return False
    await void_issued(db, invoice, cmd)
    return True


def _tax_class(value: str) -> TaxClass:
    return (
        "federal_only" if value == "federal_only" else "exempt" if value == "exempt" else "standard"
    )


def estimate_status(estimate: Estimate, today: date) -> str:
    """A sent estimate past its business-local `valid_until` reads as expired; nothing stores it."""
    if estimate.status == "sent" and estimate.valid_until is not None:
        return "expired" if estimate.valid_until < today else "sent"
    return estimate.status


async def invoice_out(db: AsyncSession, invoice: Invoice, lines: list[Line]) -> InvoiceOut:
    paid, _ = await ledger.collected(db, invoice.business_id, "invoice", invoice.id)
    status, paid_at = await ledger.invoice_state(db, invoice)
    return InvoiceOut(
        id=invoice.id,
        business_id=invoice.business_id,
        client_id=invoice.client_id,
        number=invoice.number,
        status=status,
        currency=invoice.currency,
        subtotal_cents=invoice.subtotal_cents,
        tax_total_cents=invoice.tax_total_cents,
        total_cents=invoice.total_cents,
        amount_paid_cents=paid,
        balance_cents=await ledger.invoice_balance(db, invoice),
        issued_at=invoice.issued_at,
        due_at=invoice.due_at,
        paid_at=paid_at,
        voided_at=invoice.voided_at,
        notes=invoice.notes,
        pay_token=invoice.pay_token,
        discount=discount_of(invoice),
        discount_cents=discount_total(lines),
        lines=[line_out(ln) for ln in lines],
    )


def _estimate_out(estimate: Estimate, lines: list[Line], today: date) -> EstimateOut:
    return EstimateOut(
        id=estimate.id,
        business_id=estimate.business_id,
        client_id=estimate.client_id,
        number=estimate.number,
        status=estimate_status(estimate, today),
        subtotal_cents=estimate.subtotal_cents,
        tax_total_cents=estimate.tax_total_cents,
        total_cents=estimate.total_cents,
        valid_until=estimate.valid_until,
        accepted_at=estimate.accepted_at,
        declined_at=estimate.declined_at,
        converted_invoice_id=estimate.converted_invoice_id,
        notes=estimate.notes,
        decline_reason=estimate.decline_reason,
        view_token=estimate.view_token,
        discount=discount_of(estimate),
        discount_cents=discount_total(lines),
        lines=[line_out(ln) for ln in lines],
    )


def sent_scope(invoice_id: str) -> str:
    return f"invoice-sent:{invoice_id}"


def reminder_scope(invoice_id: str) -> str:
    return f"invoice-reminder:{invoice_id}"


async def run_overdue_sweep(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Notify the client once for each sent, unpaid invoice past due, at 7 a.m. business time."""
    swept = 0
    for business in await businesses_at_hour(db, now, _OVERDUE_HOUR):
        invoices = (
            (
                await db.execute(
                    scoped(Invoice, business.id).where(
                        Invoice.due_at < now,
                        Invoice.overdue_notified_at.is_(None),
                        invoice_status_expr() == "sent",
                    )
                )
            )
            .scalars()
            .all()
        )
        for invoice in invoices:
            if await notifier.on_invoice_overdue(db, invoice.id) is Outcome.FAILED:
                continue
            invoice.overdue_notified_at = now
            await db.commit()
            swept += 1
    return swept


async def peek_number(
    db: AsyncSession, business_id: str, model: type[Invoice] | type[Estimate]
) -> int:
    sub = scoped(model, business_id).subquery()
    current = (await db.execute(select(func.max(sub.c.number)))).scalar_one_or_none()
    return (current or 0) + 1
