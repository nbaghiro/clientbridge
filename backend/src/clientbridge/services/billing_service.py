import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.billing import Estimate, Invoice, Line
from clientbridge.models.crm import Client
from clientbridge.schemas.billing import (
    EstimateCreate,
    EstimateOut,
    EstimateUpdate,
    InvoiceCreate,
    InvoiceOut,
    InvoiceUpdate,
    LineInput,
)
from clientbridge.services.lines import (
    apply_totals,
    fetch_lines,
    line_out,
    replace_lines,
    tax_for_lines,
)

_DUE_DAYS = 30


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
            self.db.add(invoice)
            await self.db.flush()
            lines = await self._replace_lines("invoice", invoice.id, data.lines)
            await self._apply_totals(invoice, lines)
            await self.db.flush()
            cmd.record("invoice.create", entity_type="invoice", entity_id=invoice.id)
            return _invoice_out(invoice, lines)

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
            lines = (
                await self._replace_lines("invoice", invoice.id, data.lines)
                if data.lines is not None
                else await self._lines("invoice", invoice.id)
            )
            await self._apply_totals(invoice, lines)
            await self.db.flush()
            cmd.record("invoice.update", entity_type="invoice", entity_id=invoice.id)
            return _invoice_out(invoice, lines)

        return await run_command(
            self.db, self.principal, action="invoice.update", run=run, response_model=InvoiceOut
        )

    async def send_invoice(self, invoice_id: str) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        if invoice.status == "void":
            raise Conflict("a void invoice can't be sent")

        async def run(cmd: Command) -> InvoiceOut:
            now = datetime.now(UTC)
            if invoice.status == "draft":
                invoice.number = await self._next_number(Invoice)
                invoice.status = "sent"
                invoice.issued_at = now
                invoice.pay_token = secrets.token_urlsafe(16)  # public pay-link key
                if invoice.due_at is None:
                    invoice.due_at = now + timedelta(days=_DUE_DAYS)
                cmd.record("invoice.send", entity_type="invoice", entity_id=invoice.id)
            else:
                cmd.record("invoice.resend", entity_type="invoice", entity_id=invoice.id)
            try:
                await (
                    self.db.flush()
                )  # the unique (business_id, number) backstops a concurrent send
            except IntegrityError as exc:
                raise Conflict("that number was just assigned — please retry") from exc
            return _invoice_out(invoice, await self._lines("invoice", invoice.id))

        return await run_command(
            self.db, self.principal, action="invoice.send", run=run, response_model=InvoiceOut
        )

    async def void_invoice(self, invoice_id: str) -> InvoiceOut:
        self._assert_admin()
        invoice = await self._invoice(invoice_id)
        if invoice.status in ("paid", "void"):
            raise Conflict(f"a {invoice.status} invoice can't be voided")

        async def run(cmd: Command) -> InvoiceOut:
            invoice.status = "void"
            invoice.voided_at = datetime.now(UTC)
            await self.db.flush()
            cmd.record("invoice.void", entity_type="invoice", entity_id=invoice.id)
            return _invoice_out(invoice, await self._lines("invoice", invoice.id))

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
            self.db.add(estimate)
            await self.db.flush()
            lines = await self._replace_lines("estimate", estimate.id, data.lines)
            await self._apply_totals(estimate, lines)
            await self.db.flush()
            cmd.record("estimate.create", entity_type="estimate", entity_id=estimate.id)
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
            lines = (
                await self._replace_lines("estimate", estimate.id, data.lines)
                if data.lines is not None
                else await self._lines("estimate", estimate.id)
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
        if estimate.status in ("accepted", "declined", "expired"):
            raise Conflict(f"a {estimate.status} estimate can't be sent")

        async def run(cmd: Command) -> EstimateOut:
            if estimate.status == "draft":
                estimate.number = await self._next_number(Estimate)
                estimate.status = "sent"
                cmd.record("estimate.send", entity_type="estimate", entity_id=estimate.id)
            else:
                cmd.record("estimate.resend", entity_type="estimate", entity_id=estimate.id)
            try:
                await (
                    self.db.flush()
                )  # the unique (business_id, number) backstops a concurrent send
            except IntegrityError as exc:
                raise Conflict("that number was just assigned — please retry") from exc
            return _estimate_out(estimate, await self._lines("estimate", estimate.id))

        return await run_command(
            self.db, self.principal, action="estimate.send", run=run, response_model=EstimateOut
        )

    async def accept_estimate(self, estimate_id: str) -> EstimateOut:
        return await self._set_estimate_status(estimate_id, "accepted")

    async def decline_estimate(self, estimate_id: str) -> EstimateOut:
        return await self._set_estimate_status(estimate_id, "declined")

    async def convert_estimate(self, estimate_id: str, idempotency_key: str | None) -> InvoiceOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        if estimate.converted_invoice_id is not None:
            raise Conflict("this estimate was already converted")
        if estimate.status not in ("sent", "accepted"):
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
                )
                for ln in await self._lines("estimate", estimate.id)
            ]
            lines = await self._replace_lines("invoice", invoice.id, inputs)
            await self._apply_totals(invoice, lines)
            estimate.converted_invoice_id = invoice.id
            await self.db.flush()
            cmd.record("estimate.convert", entity_type="estimate", entity_id=estimate.id)
            cmd.record("invoice.create", entity_type="invoice", entity_id=invoice.id)
            return _invoice_out(invoice, lines)

        return await run_command(
            self.db,
            self.principal,
            action="estimate.convert",
            run=run,
            response_model=InvoiceOut,
            idempotency_key=idempotency_key,
        )

    async def _set_estimate_status(self, estimate_id: str, status: str) -> EstimateOut:
        self._assert_admin()
        estimate = await self._estimate(estimate_id)
        if estimate.status not in ("sent", "accepted", "declined"):
            raise Conflict(f"a {estimate.status} estimate can't be {status}")

        async def run(cmd: Command) -> EstimateOut:
            estimate.status = status
            if status == "accepted":
                estimate.accepted_at = datetime.now(UTC)
            elif status == "declined":
                estimate.declined_at = datetime.now(UTC)
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

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage billing"
        )

    async def _apply_totals(self, parent: Invoice | Estimate, lines: list[Line]) -> None:
        apply_totals(parent, await tax_for_lines(self.db, self.biz, lines))

    async def _replace_lines(
        self, parent_type: str, parent_id: str, inputs: list[LineInput]
    ) -> list[Line]:
        return await replace_lines(self.db, self.biz, parent_type, parent_id, inputs)

    async def _lines(self, parent_type: str, parent_id: str) -> list[Line]:
        return await fetch_lines(self.db, self.biz, parent_type, parent_id)

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


def _invoice_out(invoice: Invoice, lines: list[Line]) -> InvoiceOut:
    return InvoiceOut(
        id=invoice.id,
        business_id=invoice.business_id,
        client_id=invoice.client_id,
        number=invoice.number,
        status=invoice.status,
        currency=invoice.currency,
        subtotal_cents=invoice.subtotal_cents,
        tax_total_cents=invoice.tax_total_cents,
        total_cents=invoice.total_cents,
        amount_paid_cents=invoice.amount_paid_cents,
        balance_cents=invoice.balance_cents,
        issued_at=invoice.issued_at,
        due_at=invoice.due_at,
        paid_at=invoice.paid_at,
        voided_at=invoice.voided_at,
        notes=invoice.notes,
        pay_token=invoice.pay_token,
        lines=[line_out(ln) for ln in lines],
    )


def _estimate_out(estimate: Estimate, lines: list[Line]) -> EstimateOut:
    return EstimateOut(
        id=estimate.id,
        business_id=estimate.business_id,
        client_id=estimate.client_id,
        number=estimate.number,
        status=estimate.status,
        subtotal_cents=estimate.subtotal_cents,
        tax_total_cents=estimate.tax_total_cents,
        total_cents=estimate.total_cents,
        valid_until=estimate.valid_until,
        accepted_at=estimate.accepted_at,
        declined_at=estimate.declined_at,
        converted_invoice_id=estimate.converted_invoice_id,
        notes=estimate.notes,
        lines=[line_out(ln) for ln in lines],
    )
