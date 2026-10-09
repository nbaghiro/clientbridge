import secrets
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Estimate, EstimateStatus, Invoice, Line
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
from clientbridge.services import ledger
from clientbridge.services.bookings import apply_deposit, unapply_deposit
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
from clientbridge.services.notifications import Notifier
from clientbridge.services.payments import sync_invoice
from clientbridge.services.tax import tax_for_lines

_DUE_DAYS = 30
_VALID_DAYS = 14


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
                await self._issue_invoice(invoice, cmd)
            return await _invoice_out(self.db, invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db,
            self.principal,
            action="invoice.create",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
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
            return await _invoice_out(self.db, invoice, lines)

        return await run_command(
            self.db, self.principal, action="invoice.update", run=run, response_model=InvoiceOut
        )

    async def send_invoice(self, invoice_id: str) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        if invoice.status == "void":
            raise Conflict("a void invoice can't be sent")

        async def run(cmd: Command) -> InvoiceOut:
            if invoice.status == "draft":
                await self._issue_invoice(invoice, cmd)
            else:
                cmd.record("invoice.resend", entity_type="invoice", entity_id=invoice.id)
            return await _invoice_out(self.db, invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db, self.principal, action="invoice.send", run=run, response_model=InvoiceOut
        )

    async def _issue_invoice(self, invoice: Invoice, cmd: Command) -> None:
        """Number, date and post a draft invoice; its tax is fixed here and matches its journal."""
        now = datetime.now(UTC)
        invoice.number = await self._next_number(Invoice)
        invoice.status = "sent"
        invoice.issued_at = now
        invoice.pay_token = secrets.token_urlsafe(16)
        if invoice.due_at is None:
            invoice.due_at = now + timedelta(days=_DUE_DAYS)
        lines = await self._lines("invoice", invoice.id)
        tax = await tax_for_lines(self.db, self.biz, lines)
        apply_totals(invoice, tax)
        try:
            await self.db.flush()  # the unique (business_id, number) backstops a concurrent send
        except IntegrityError as exc:
            raise Conflict("that number was just assigned — please retry") from exc
        await ledger.post_invoice(self.db, invoice, tax)
        await self._apply_deposits(invoice)
        cmd.record("invoice.send", entity_type="invoice", entity_id=invoice.id)

    async def void_invoice(self, invoice_id: str) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        status, _ = await ledger.invoice_state(self.db, invoice)
        if status in ("paid", "partial", "refunded", "void"):
            raise Conflict(f"a {status} invoice can't be voided")

        async def run(cmd: Command) -> InvoiceOut:
            pending = await self.db.execute(
                scoped(Payment, self.biz)
                .with_only_columns(Payment.id)
                .where(Payment.invoice_id == invoice.id, Payment.status == "pending")
                .limit(1)
            )
            if pending.scalar_one_or_none() is not None:
                raise Conflict("this invoice has a payment in progress")
            invoice.status = "void"
            invoice.voided_at = datetime.now(UTC)
            await self.db.flush()
            await ledger.void_invoice(self.db, invoice)
            for booking in await self._bookings(invoice):
                await unapply_deposit(self.db, booking, invoice.id)
            cmd.record("invoice.void", entity_type="invoice", entity_id=invoice.id)
            return await _invoice_out(self.db, invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db, self.principal, action="invoice.void", run=run, response_model=InvoiceOut
        )

    async def _bookings(self, invoice: Invoice) -> list[Booking]:
        rows = await self.db.execute(
            scoped(Booking, self.biz)
            .join(Line, Line.booking_id == Booking.id)
            .where(Line.invoice_id == invoice.id)
            .distinct()
        )
        return list(rows.scalars().all())

    async def _apply_deposits(self, invoice: Invoice) -> None:
        applied = False
        for booking in await self._bookings(invoice):
            applied = await apply_deposit(self.db, booking, invoice) or applied
        if applied:
            await sync_invoice(self.db, invoice.id)

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
            return _estimate_out(estimate, lines)

        return await run_command(
            self.db,
            self.principal,
            action="estimate.create",
            run=run,
            response_model=EstimateOut,
            idempotency_key=idempotency_key,
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
            return _estimate_out(estimate, lines)

        return await run_command(
            self.db, self.principal, action="estimate.update", run=run, response_model=EstimateOut
        )

    async def send_estimate(self, estimate_id: str) -> EstimateOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        status = estimate_status(estimate)
        if status in ("accepted", "declined", "expired"):
            raise Conflict(f"a {status} estimate can't be sent")

        async def run(cmd: Command) -> EstimateOut:
            if estimate.status == "draft":
                await self._issue_estimate(estimate, cmd)
            else:
                cmd.record("estimate.resend", entity_type="estimate", entity_id=estimate.id)
            return _estimate_out(estimate, await self._lines("estimate", estimate.id))

        return await run_command(
            self.db, self.principal, action="estimate.send", run=run, response_model=EstimateOut
        )

    async def _issue_estimate(self, estimate: Estimate, cmd: Command) -> None:
        estimate.number = await self._next_number(Estimate)
        estimate.status = "sent"
        estimate.view_token = secrets.token_urlsafe(16)
        if estimate.valid_until is None:
            estimate.valid_until = datetime.now(UTC).date() + timedelta(days=_VALID_DAYS)
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
        if estimate.converted_invoice_id is not None:
            raise Conflict("this estimate was already converted")
        if estimate_status(estimate) not in ("sent", "accepted"):
            raise Conflict("only a sent or accepted estimate can be converted")
        await self._client(estimate.client_id)

        async def run(cmd: Command) -> InvoiceOut:
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
            return await _invoice_out(self.db, invoice, lines)

        return await run_command(
            self.db,
            self.principal,
            action="estimate.convert",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
        )

    async def _set_estimate_status(
        self, estimate_id: str, status: EstimateStatus, reason: str | None = None
    ) -> EstimateOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        current = estimate_status(estimate)
        if current not in ("sent", "accepted", "declined"):
            raise Conflict(f"a {current} estimate can't be {status}")

        async def run(cmd: Command) -> EstimateOut:
            estimate.status = status
            if status == "accepted":
                estimate.accepted_at = datetime.now(UTC)
            elif status == "declined":
                estimate.declined_at = datetime.now(UTC)
                estimate.decline_reason = reason
            await self.db.flush()
            cmd.record(f"estimate.{status}", entity_type="estimate", entity_id=estimate.id)
            return _estimate_out(estimate, await self._lines("estimate", estimate.id))

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
        slot = await self.db.get(Slot, booking.slot_id)
        item = await self.db.get(Item, slot.item_id) if slot is not None else None
        addons = (
            (
                await self.db.execute(
                    scoped(Addon, self.biz)
                    .where(Addon.booking_id == booking.id)
                    .order_by(Addon.created_at, Addon.id)
                )
            )
            .scalars()
            .all()
        )
        inputs = [
            LineInput(
                description=item.name if item is not None else "Visit",
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
                )
                for a in addons
            ),
        ]

        async def run(cmd: Command) -> InvoiceOut:
            if booking.invoice_id is not None:
                prior = await self.db.get(Invoice, booking.invoice_id)
                if prior is not None and prior.status != "void":
                    raise Conflict("this visit already has an invoice")
            invoice = Invoice(
                id=new_id("invoice"),
                business_id=self.biz,
                client_id=booking.client_id,
                status="draft",
                currency=item.currency if item is not None else "CAD",
            )
            self.db.add(invoice)
            await self.db.flush()
            lines = await self._replace_lines("invoice", invoice, inputs)
            await self._apply_totals(invoice, lines)
            booking.invoice_id = invoice.id
            await self.db.flush()
            cmd.record("invoice.create", entity_type="invoice", entity_id=invoice.id)
            return await _invoice_out(self.db, invoice, lines)

        return await run_command(
            self.db,
            self.principal,
            action="invoice.from_booking",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
        )

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

    async def _lines(self, parent: LineParent, parent_id: str) -> list[Line]:
        return await fetch_lines(self.db, self.biz, parent, parent_id)

    async def _next_number(self, model: type[Invoice] | type[Estimate]) -> int:
        sub = scoped(model, self.biz).subquery()
        current = (await self.db.execute(select(func.max(sub.c.number)))).scalar_one_or_none()
        return (current or 0) + 1

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
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


def _tax_class(value: str) -> TaxClass:
    return (
        "federal_only" if value == "federal_only" else "exempt" if value == "exempt" else "standard"
    )


def estimate_status(estimate: Estimate, today: date | None = None) -> str:
    """A sent estimate past its `valid_until` (a UTC date) reads as expired; nothing stores that."""
    today = today or datetime.now(UTC).date()
    if estimate.status == "sent" and estimate.valid_until is not None:
        return "expired" if estimate.valid_until < today else "sent"
    return estimate.status


async def _invoice_out(db: AsyncSession, invoice: Invoice, lines: list[Line]) -> InvoiceOut:
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


def _estimate_out(estimate: Estimate, lines: list[Line]) -> EstimateOut:
    return EstimateOut(
        id=estimate.id,
        business_id=estimate.business_id,
        client_id=estimate.client_id,
        number=estimate.number,
        status=estimate_status(estimate),
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


async def run_overdue_sweep(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Notify the client once for each sent, unpaid invoice past due."""
    invoices = (
        (
            await db.execute(
                select(Invoice).where(
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
        invoice.overdue_notified_at = now
        await notifier.on_invoice_overdue(db, invoice.id)
    await db.commit()
    return len(invoices)
