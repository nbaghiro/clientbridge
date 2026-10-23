from collections.abc import Awaitable, Callable
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import Base
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.locale import locale_for
from clientbridge.core.scoping import scoped
from clientbridge.integrations.expo import Push
from clientbridge.integrations.resend import Email
from clientbridge.integrations.twilio import Sms
from clientbridge.models.billing import Channel, Estimate, Invoice, Order
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, Form, Signature
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.previews import OutgoingEmail, OutgoingPreview, OutgoingText
from clientbridge.services.billing import peek_number
from clientbridge.services.notifications import (
    Notifier,
    contract_sent_message,
    form_sent_message,
)

# A link that is minted only when the message really goes out.
_UNMINTED = "…"


class _EmailOutbox:
    def __init__(self) -> None:
        self.sent: list[Email] = []

    async def send(self, email: Email) -> str | None:
        self.sent.append(email)
        return None


class _SmsOutbox:
    def __init__(self) -> None:
        self.sent: list[Sms] = []

    async def send(self, sms: Sms) -> str | None:
        self.sent.append(sms)
        return None


class _PushOutbox:
    async def send(self, push: Push) -> None:
        return None


class PreviewService:
    """Runs the real notice for a send against outboxes that keep it instead of delivering it."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self._email = _EmailOutbox()
        self._sms = _SmsOutbox()
        self.notifier = Notifier(self._email, self._sms, _PushOutbox(), raise_errors=True)

    async def invoice_send(self, invoice_id: str) -> OutgoingPreview:
        self._assert_admin()
        invoice = await self._owned(Invoice, invoice_id)
        if invoice.status == "void":
            raise Conflict("a void invoice can't be sent")

        async def run() -> None:
            if invoice.status == "draft":
                invoice.number = await peek_number(self.db, self.biz, Invoice)
                invoice.pay_token = _UNMINTED
            await self.notifier.on_invoice_sent(self.db, invoice.id)

        return await self._preview(invoice.client_id, run, (invoice,))

    async def invoice_remind(self, invoice_id: str) -> OutgoingPreview:
        self._assert_admin()
        invoice = await self._owned(Invoice, invoice_id)
        if invoice.status != "sent":
            raise Conflict(f"a {invoice.status} invoice can't be reminded")
        return await self._preview(
            invoice.client_id, lambda: self.notifier.on_invoice_reminder(self.db, invoice.id)
        )

    async def estimate_send(self, estimate_id: str) -> OutgoingPreview:
        self._assert_admin()
        estimate = await self._owned(Estimate, estimate_id)

        async def run() -> None:
            if estimate.status == "draft":
                estimate.number = await peek_number(self.db, self.biz, Estimate)
                estimate.view_token = _UNMINTED
            await self.notifier.on_estimate_sent(self.db, estimate.id)

        return await self._preview(estimate.client_id, run, (estimate,))

    async def order_receipt(self, order_id: str, channel: Channel, to: str) -> OutgoingPreview:
        order = await self._owned(Order, order_id)

        async def run() -> None:
            order.receipt_channel = channel
            order.receipt_email, order.receipt_phone = (
                (to, None) if channel == "email" else (None, to)
            )
            order.receipt_token = order.receipt_token or _UNMINTED
            await self.notifier.on_order_receipt(self.db, order.id)

        return await self._preview(order.client_id, run, (order,))

    async def order_ready(self, order_id: str) -> OutgoingPreview:
        order = await self._owned(Order, order_id)
        return await self._preview(
            order.client_id, lambda: self.notifier.on_order_ready(self.db, order.id)
        )

    async def booking_departed(self, booking_id: str) -> OutgoingPreview:
        booking = await self._owned(Booking, booking_id)
        return await self._preview(
            booking.client_id, lambda: self.notifier.on_booking_departed(self.db, booking.id)
        )

    async def booking_rescheduled(
        self, booking_id: str, starts_at: datetime, ends_at: datetime
    ) -> OutgoingPreview:
        booking = await self._owned(Booking, booking_id)
        slot = await self._owned(Slot, booking.slot_id)

        async def run() -> None:
            slot.starts_at, slot.ends_at = starts_at, ends_at
            await self.notifier.on_booking_rescheduled(self.db, booking.id)

        return await self._preview(booking.client_id, run, (slot,))

    async def signature_resend(self, signature_id: str) -> OutgoingPreview:
        self._assert_admin()
        signature = await self._owned(Signature, signature_id)
        return await self._preview(
            signature.client_id, lambda: self.notifier.on_contract_sent(self.db, signature.id)
        )

    async def form_send(self, form_id: str, client_id: str) -> OutgoingPreview:
        self._assert_admin()
        form = await self._owned(Form, form_id)
        await self._owned(Client, client_id)
        business = await self._business()
        notice = form_sent_message(
            locale_for(business=business),
            business.name,
            form.name,
            f"{get_settings().book_base_url}/form/{_UNMINTED}",
        )
        return await self._preview(
            client_id, lambda: self.notifier.deliver(self.db, client_id, notice)
        )

    async def contract_send(self, contract_id: str, client_id: str) -> OutgoingPreview:
        self._assert_admin()
        contract = await self._owned(Contract, contract_id)
        await self._owned(Client, client_id)
        business = await self._business()
        notice = contract_sent_message(
            locale_for(business=business),
            business.name,
            contract.name,
            f"{get_settings().book_base_url}/contract/{_UNMINTED}",
        )
        return await self._preview(
            client_id, lambda: self.notifier.deliver(self.db, client_id, notice)
        )

    async def review_request(self, client_id: str) -> OutgoingPreview:
        self._assert_admin()
        await self._owned(Client, client_id)
        business = await self._business()
        return await self._preview(
            client_id,
            lambda: self.notifier.invite_review(self.db, business, client_id, _UNMINTED),
        )

    async def _preview(
        self,
        client_id: str | None,
        run: Callable[[], Awaitable[object]],
        touched: tuple[Base, ...] = (),
    ) -> OutgoingPreview:
        client = await self.db.get(Client, client_id) if client_id is not None else None
        recipient = client.name if client is not None else None
        savepoint = await self.db.begin_nested()
        try:
            # nothing a preview changes on the rows it reads may reach the database
            with self.db.no_autoflush:
                await run()
        finally:
            await savepoint.rollback()
            for row in touched:
                self.db.expire(row)
        email = self._email.sent[0] if self._email.sent else None
        text = self._sms.sent[0] if self._sms.sent else None
        return OutgoingPreview(
            recipient=recipient,
            email=OutgoingEmail(to=email.to, subject=email.subject, body=email.body)
            if email is not None
            else None,
            text=OutgoingText(to=text.to, body=text.body) if text is not None else None,
        )

    async def _owned[ModelT: Base](self, model: type[ModelT], row_id: str) -> ModelT:
        row = await self.db.scalar(scoped(model, self.biz).filter_by(id=row_id))
        if row is None:
            raise NotFound(f"{model.__tablename__} not found")
        return row

    async def _business(self) -> Business:
        business = await self.db.get(Business, self.biz)
        if business is None:
            raise NotFound("business not found")
        return business

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can send this"
        )
