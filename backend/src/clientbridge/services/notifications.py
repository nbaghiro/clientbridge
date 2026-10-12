import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal
from clientbridge.core.ids import new_id
from clientbridge.core.locale import (
    currency_for,
    format_day_and_time,
    format_money,
    format_number,
    locale_for,
    message,
    plural,
)
from clientbridge.core.phones import e164
from clientbridge.core.scoping import scoped
from clientbridge.integrations.expo import Push, PushSender
from clientbridge.integrations.postmark import Email, EmailSender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.billing import Estimate, Invoice, Order
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import GiftCard, Subscription
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, Form, FormResponse, Signature
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Device, DevicePlatform
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.services import ledger
from clientbridge.services.consents import texts_stopped
from clientbridge.services.lines import LineParent, fetch_lines
from clientbridge.services.tax import tax_breakdown

_log = logging.getLogger(__name__)
_PREVIEW_CHARS = 120

SeriesNotice = Literal["booked", "moved", "canceled"]


def returning_code(locale: str, business_name: str, code: str, minutes: int) -> tuple[str, str]:
    return (
        message(locale, "returning_code.subject", business=business_name),
        plural(locale, "returning_code.body", minutes, code=code),
    )


def staff_invite(locale: str, link: str) -> tuple[str, str]:
    return (
        message(locale, "staff_invite.subject"),
        message(locale, "staff_invite.body", link=link),
    )


def _auth_email(locale: str, email: AuthEmailIn) -> tuple[str, str]:
    code, minutes = email.code or "", email.expires_in_minutes or 0
    match email.template_type:
        case "verification_code_valid":
            body = plural(locale, "verification_code.body", minutes, code=code)
            if email.link:
                body += "\n\n" + message(locale, "verification_code.link", link=email.link)
            return message(locale, "verification_code.subject"), body
        case "verification_code_invalid":
            return (
                message(locale, "verification_unknown.subject"),
                message(locale, "verification_unknown.body"),
            )
        case "recovery_code_valid":
            return (
                message(locale, "recovery_code.subject"),
                plural(locale, "recovery_code.body", minutes, code=code),
            )
        case "recovery_code_invalid":
            return (
                message(locale, "recovery_unknown.subject"),
                message(locale, "recovery_unknown.body"),
            )
        case "login_code_valid":
            return (
                message(locale, "login_code.subject"),
                plural(locale, "login_code.body", minutes, code=code),
            )
        case "registration_code_valid":
            return (
                message(locale, "registration_code.subject"),
                plural(locale, "registration_code.body", minutes, code=code),
            )


async def send_auth_email(email_sender: EmailSender, email: AuthEmailIn) -> None:
    """Words and sends an email the Kratos courier handed over; a failure lets Kratos retry."""
    subject, body = _auth_email(locale_for(), email)
    await email_sender.send(Email(to=email.to, subject=subject, body=body))


def invite_link(token: str) -> str:
    """Where an invitee signs up or in, then joins the team."""
    return f"{get_settings().web_base_url}/accept-invite?token={token}"


def pay_link(token: str) -> str:
    """The client's link to pay an invoice: one host for every business."""
    return f"{get_settings().pay_base_url}/i/{token}"


def estimate_link(token: str) -> str:
    """The client's link to read and answer an estimate, on the same host as pay links."""
    return f"{get_settings().pay_base_url}/e/{token}"


def receipt_link(token: str) -> str:
    """The client's itemised receipt for a desk sale, on the same host as pay links."""
    return f"{get_settings().pay_base_url}/r/{token}"


def _receipt(
    locale: str, business_name: str, amount: str, details: list[str]
) -> tuple[str, str, str]:
    """(subject, body, push) for a payment receipt with its itemised details."""
    body = message(locale, "receipt.body", amount=amount, business=business_name)
    if details:
        body += "\n\n" + "\n".join(details)
    return (
        message(locale, "receipt.subject", business=business_name),
        body,
        message(locale, "receipt.push", amount=amount),
    )


def _pickup_line(locale: str, business_name: str) -> str:
    return message(locale, "pickup.body", business=business_name)


def _online_order_alert(locale: str, amount: str) -> tuple[str, str]:
    """(owner email subject + push body, email body) for a paid online order."""
    return (
        message(locale, "online_order.subject", amount=amount),
        message(locale, "online_order.body", amount=amount),
    )


def _sale_receipt(
    locale: str, business_name: str, number: int | None, link: str
) -> tuple[str, str]:
    subject = message(locale, "sale_receipt.subject", business=business_name)
    if number is None:
        return subject, message(locale, "sale_receipt.body", business=business_name, link=link)
    body = message(
        locale, "sale_receipt.body_numbered", business=business_name, number=number, link=link
    )
    return subject, body


def _order_ready(locale: str, business_name: str) -> tuple[str, str]:
    return (
        message(locale, "order_ready.subject", business=business_name),
        message(locale, "order_ready.body", business=business_name),
    )


def _order_reminder(locale: str, business_name: str) -> tuple[str, str]:
    return (
        message(locale, "order_reminder.subject", business=business_name),
        message(locale, "order_reminder.body", business=business_name),
    )


def _receipt_details(
    locale: str,
    lines: list[tuple[str, str, str]],
    subtotal: str,
    taxes: list[tuple[str, str]],
    total: str,
) -> list[str]:
    rows = [
        message(locale, "receipt.line", item=name, quantity=quantity, amount=amount)
        for name, quantity, amount in lines
    ]
    rows.append(message(locale, "receipt.subtotal", amount=subtotal))
    rows.extend(message(locale, "receipt.tax", tax=code, amount=amount) for code, amount in taxes)
    rows.append(message(locale, "receipt.total", amount=total))
    return rows


def _inbound_message_alert(locale: str, client_name: str, body: str) -> str:
    return message(locale, "inbound_message.push", client=client_name, body=body)


def _dispute_alert(locale: str, amount: str) -> str:
    """Staff push body when a charge is disputed: the owner must respond in Stripe."""
    return message(locale, "dispute.push", amount=amount)


def _invoice_sent(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> tuple[str, str]:
    values = {"number": str(number), "amount": amount, "business": business_name}
    body = (
        message(locale, "invoice_sent.body_link", link=link, **values)
        if link
        else message(locale, "invoice_sent.body", **values)
    )
    return message(locale, "invoice_sent.subject", **values), body


def _invoice_overdue(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> tuple[str, str]:
    values = {"number": str(number), "amount": amount, "business": business_name}
    body = (
        message(locale, "invoice_overdue.body_link", link=link, **values)
        if link
        else message(locale, "invoice_overdue.body", **values)
    )
    return message(locale, "invoice_overdue.subject", **values), body


def _estimate_sent(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> tuple[str, str]:
    values = {"number": str(number), "amount": amount, "business": business_name}
    body = (
        message(locale, "estimate_sent.body_link", link=link, **values)
        if link
        else message(locale, "estimate_sent.body", **values)
    )
    return message(locale, "estimate_sent.subject", **values), body


def _estimate_accepted(locale: str, number: int | None) -> tuple[str, str]:
    return (
        message(locale, "estimate_accepted.subject", number=str(number)),
        message(locale, "estimate_accepted.body", number=str(number)),
    )


def _estimate_declined(locale: str, number: int | None, reason: str | None) -> tuple[str, str]:
    body = (
        message(locale, "estimate_declined.body_reason", number=str(number), reason=reason)
        if reason
        else message(locale, "estimate_declined.body", number=str(number))
    )
    return message(locale, "estimate_declined.subject", number=str(number)), body


def _payment_failed(locale: str, amount: str, business_name: str) -> tuple[str, str]:
    return (
        message(locale, "payment_failed.subject", business=business_name),
        message(locale, "payment_failed.body", amount=amount, business=business_name),
    )


def _refund(
    locale: str, amount: str, business_name: str, credit_note: str | None
) -> tuple[str, str]:
    body = (
        message(
            locale,
            "refund.body_credit_note",
            amount=amount,
            business=business_name,
            credit_note=credit_note,
        )
        if credit_note
        else message(locale, "refund.body", amount=amount, business=business_name)
    )
    return message(locale, "refund.subject", business=business_name), body


def _subscription_past_due(locale: str, business_name: str) -> tuple[str, str]:
    return (
        message(locale, "subscription_past_due.subject", business=business_name),
        message(locale, "subscription_past_due.body", business=business_name),
    )


def _subscription_canceled(locale: str, business_name: str) -> tuple[str, str]:
    return (
        message(locale, "subscription_canceled.subject", business=business_name),
        message(locale, "subscription_canceled.body", business=business_name),
    )


def _gift_card_issued(locale: str, business_name: str, amount: str, code: str) -> tuple[str, str]:
    return (
        message(locale, "gift_card_issued.subject", business=business_name),
        message(locale, "gift_card_issued.body", amount=amount, business=business_name, code=code),
    )


def _booking_reminder(
    locale: str, business_name: str, when: str, link: str | None
) -> tuple[str, str]:
    body = (
        message(locale, "booking_reminder.body_link", business=business_name, when=when, link=link)
        if link
        else message(locale, "booking_reminder.body", business=business_name, when=when)
    )
    return message(locale, "booking_reminder.subject", business=business_name), body


def _booking_confirmed(
    locale: str, business_name: str, when: str, link: str | None
) -> tuple[str, str]:
    body = (
        message(locale, "booking_confirmed.body_link", business=business_name, when=when, link=link)
        if link
        else message(locale, "booking_confirmed.body", business=business_name, when=when)
    )
    return message(locale, "booking_confirmed.subject", business=business_name), body


def _booking_rescheduled(locale: str, business_name: str, when: str) -> tuple[str, str]:
    return (
        message(locale, "booking_rescheduled.subject", business=business_name),
        message(locale, "booking_rescheduled.body", business=business_name, when=when),
    )


def _booking_canceled(locale: str, business_name: str, when: str) -> tuple[str, str]:
    return (
        message(locale, "booking_canceled.subject", business=business_name),
        message(locale, "booking_canceled.body", business=business_name, when=when),
    )


def _booking_reassigned(
    locale: str, business_name: str, whens: list[str], member: str
) -> tuple[str, str]:
    if len(whens) == 1:
        return (
            message(locale, "booking_reassigned.subject", business=business_name),
            message(
                locale,
                "booking_reassigned.body",
                business=business_name,
                when=whens[0],
                member=member,
            ),
        )
    return (
        message(locale, "visits_reassigned.subject", business=business_name),
        message(
            locale,
            "visits_reassigned.body",
            business=business_name,
            whens=message(locale, "series.separator").join(whens),
            member=member,
        ),
    )


def _booking_requested(locale: str, business_name: str, when: str) -> tuple[str, str]:
    return (
        message(locale, "booking_requested.subject", business=business_name),
        message(locale, "booking_requested.body", business=business_name, when=when),
    )


def _booking_released(locale: str, business_name: str, when: str) -> tuple[str, str]:
    return (
        message(locale, "booking_released.subject", business=business_name),
        message(locale, "booking_released.body", business=business_name, when=when),
    )


def _series_booked(locale: str, business_name: str, whens: str) -> tuple[str, str]:
    return (
        message(locale, "series_booked.subject", business=business_name),
        message(locale, "series_booked.body", business=business_name, whens=whens),
    )


def _series_moved(locale: str, business_name: str, whens: str) -> tuple[str, str]:
    return (
        message(locale, "series_moved.subject", business=business_name),
        message(locale, "series_moved.body", business=business_name, whens=whens),
    )


def _series_canceled(locale: str, business_name: str, whens: str) -> tuple[str, str]:
    return (
        message(locale, "series_canceled.subject", business=business_name),
        message(locale, "series_canceled.body", business=business_name, whens=whens),
    )


def _form_sent(locale: str, business_name: str, form_name: str, link: str) -> tuple[str, str]:
    return (
        message(locale, "form_sent.subject", business=business_name, form=form_name),
        message(locale, "form_sent.body", business=business_name, form=form_name, link=link),
    )


def _contract_sent(
    locale: str, business_name: str, contract_name: str, link: str
) -> tuple[str, str]:
    values = {"business": business_name, "contract": contract_name}
    return (
        message(locale, "contract_sent.subject", **values),
        message(locale, "contract_sent.body", link=link, **values),
    )


def _review_requested(locale: str, business_name: str, link: str) -> tuple[str, str]:
    return (
        message(locale, "review_requested.subject", business=business_name),
        message(locale, "review_requested.body", business=business_name, link=link),
    )


def broadcast_text(
    locale: str,
    business_name: str,
    channel: str,
    body: str,
    prefs_link: str,
    address: str,
    contact: str,
) -> str:
    """A broadcast as the client receives it, with the identification and opt-out CASL requires."""
    if channel == "sms":
        return message(locale, "broadcast.sms", business=business_name, body=body, keyword="STOP")
    return message(
        locale,
        "broadcast.email",
        body=body,
        business=business_name,
        address=address,
        contact=contact,
        link=prefs_link,
    )


def _when(locale: str, business: Business, slot: Slot) -> str:
    return format_day_and_time(locale, slot.starts_at, business.timezone)


async def reminder_message(db: AsyncSession, booking: Booking) -> tuple[str, str] | None:
    """The reminder a visit gets, word for word, as the job would send it."""
    slot = await db.get(Slot, booking.slot_id)
    business = await db.get(Business, booking.business_id)
    if slot is None or business is None:
        return None
    locale = locale_for(business=business)
    when = _when(locale, business, slot)
    return _booking_reminder(locale, business.name, when, _manage_link(business, booking))


def _manage_link(business: Business, booking: Booking) -> str | None:
    """The client's manage link, when the business lets clients change bookings online."""
    if booking.manage_token is None or business.booking_policy.get("self_service") is False:
        return None
    return f"{get_settings().connect_base_url}/m/{booking.manage_token}"


async def _visits_by_client(
    db: AsyncSession, booking_ids: list[str], *, by_member: bool = True
) -> list[tuple[str, str, list[tuple[Booking, Slot]]]]:
    """Visits grouped by client (and member), each group in time order."""
    if not booking_ids:
        return []
    rows = await db.execute(
        select(Booking, Slot)
        .join(Slot, Slot.id == Booking.slot_id)
        .where(Booking.id.in_(booking_ids))
        .order_by(Slot.starts_at, Booking.id)
    )
    groups: dict[tuple[str, str], list[tuple[Booking, Slot]]] = {}
    for booking, slot in rows.tuples():
        key = (booking.client_id, slot.staff_id if by_member else "")
        groups.setdefault(key, []).append((booking, slot))
    return [(client, member, visits) for (client, member), visits in groups.items()]


class Notifier:
    """Sends every event to its channels; one channel failing never blocks the others."""

    def __init__(self, email: EmailSender, sms: SmsSender, push: PushSender) -> None:
        self.email = email
        self.sms = sms
        self.push = push

    async def on_payment_succeeded(self, db: AsyncSession, payment_id: str) -> None:
        """Receipt to the client (email + SMS) + a push alert to the provider's staff devices."""
        payment = await db.get(Payment, payment_id)
        if payment is None or payment.kind == "refund":
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, payment.amount_cents, payment.currency)
        details = await self._itemised(db, locale, payment)
        order = await db.get(Order, payment.order_id) if payment.order_id else None
        online = order is not None and order.source == "online"
        if online:
            details.append(_pickup_line(locale, business.name))
            if order is not None and order.status_token:
                details.append(f"{get_settings().pay_base_url}/order/{order.status_token}")
        subject, body, push_body = _receipt(locale, business.name, amount, details)
        if online:
            push_body, owner_body = _online_order_alert(locale, amount)
            if business.billing_email:
                await self._to_contact(business.billing_email, None, push_body, owner_body)
        if payment.client_id is not None:
            await self._to_client(db, payment.client_id, subject, body)
        elif order is not None:
            await self._to_contact(order.receipt_email, order.receipt_phone, subject, body)
        await self._alert_staff(
            db, business, push_body, {"type": "payment", "payment_id": payment_id}
        )

    async def on_order_ready(self, db: AsyncSession, order_id: str) -> None:
        order = await db.get(Order, order_id)
        if order is None or order.client_id is None:
            return
        business = await db.get(Business, order.business_id)
        if business is None:
            return
        subject, body = _order_ready(locale_for(business=business), business.name)
        if order.status_token:
            body += f"\n{get_settings().pay_base_url}/order/{order.status_token}"
        await self._to_client(
            db, order.client_id, subject, body, channel=None if order.notify_sms else "email"
        )

    async def on_order_reminder(self, db: AsyncSession, order_id: str) -> None:
        order = await db.get(Order, order_id)
        if order is None or order.client_id is None:
            return
        business = await db.get(Business, order.business_id)
        if business is None:
            return
        subject, body = _order_reminder(locale_for(business=business), business.name)
        if order.status_token:
            body += f"\n{get_settings().pay_base_url}/order/{order.status_token}"
        await self._to_client(
            db, order.client_id, subject, body, channel=None if order.notify_sms else "email"
        )

    async def on_order_receipt(self, db: AsyncSession, order_id: str) -> None:
        """The receipt link, by the one channel the desk chose."""
        order = await db.get(Order, order_id)
        if order is None or order.receipt_token is None:
            return
        business = await db.get(Business, order.business_id)
        if business is None:
            return
        subject, body = _sale_receipt(
            locale_for(business=business),
            business.name,
            order.number,
            receipt_link(order.receipt_token),
        )
        if order.receipt_channel == "email":
            await self._to_contact(order.receipt_email, None, subject, body)
        elif order.receipt_channel == "sms":
            await self._to_contact(None, order.receipt_phone, subject, body)

    async def on_invoice_sent(self, db: AsyncSession, invoice_id: str) -> None:
        invoice = await db.get(Invoice, invoice_id)
        if invoice is None:
            return
        business = await db.get(Business, invoice.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, invoice.total_cents, invoice.currency)
        link = pay_link(invoice.pay_token) if invoice.pay_token else ""
        subject, body = _invoice_sent(locale, invoice.number, amount, business.name, link)
        await self._to_client(db, invoice.client_id, subject, body)

    async def on_invoice_overdue(self, db: AsyncSession, invoice_id: str) -> None:
        invoice = await db.get(Invoice, invoice_id)
        if invoice is None:
            return
        business = await db.get(Business, invoice.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, await ledger.invoice_balance(db, invoice), invoice.currency)
        link = pay_link(invoice.pay_token) if invoice.pay_token else ""
        subject, body = _invoice_overdue(locale, invoice.number, amount, business.name, link)
        await self._to_client(db, invoice.client_id, subject, body)

    async def on_estimate_sent(self, db: AsyncSession, estimate_id: str) -> None:
        estimate = await db.get(Estimate, estimate_id)
        if estimate is None:
            return
        business = await db.get(Business, estimate.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, estimate.total_cents, currency_for(business))
        link = estimate_link(estimate.view_token) if estimate.view_token else ""
        subject, body = _estimate_sent(locale, estimate.number, amount, business.name, link)
        await self._to_client(db, estimate.client_id, subject, body)

    async def on_estimate_accepted(self, db: AsyncSession, estimate_id: str) -> None:
        """Alert the provider (their billing email) that a client accepted an estimate."""
        estimate = await db.get(Estimate, estimate_id)
        if estimate is None:
            return
        business = await db.get(Business, estimate.business_id)
        if business is None or not business.billing_email:
            return
        subject, body = _estimate_accepted(locale_for(business=business), estimate.number)
        await self._safe(
            self.email.send(Email(to=business.billing_email, subject=subject, body=body))
        )

    async def on_estimate_declined(self, db: AsyncSession, estimate_id: str) -> None:
        """Alert the provider (their billing email) that a client declined an estimate."""
        estimate = await db.get(Estimate, estimate_id)
        if estimate is None:
            return
        business = await db.get(Business, estimate.business_id)
        if business is None or not business.billing_email:
            return
        subject, body = _estimate_declined(
            locale_for(business=business), estimate.number, estimate.decline_reason
        )
        await self._safe(
            self.email.send(Email(to=business.billing_email, subject=subject, body=body))
        )

    async def on_estimate_answered(self, db: AsyncSession, view_token: str) -> None:
        """Tell the provider a client accepted or declined an estimate from its public link."""
        estimate = (
            await db.execute(select(Estimate).where(Estimate.view_token == view_token))
        ).scalar_one_or_none()
        if estimate is None:
            return
        if estimate.status == "accepted":
            await self.on_estimate_accepted(db, estimate.id)
        elif estimate.status == "declined":
            await self.on_estimate_declined(db, estimate.id)

    async def on_refund(self, db: AsyncSession, refund_payment_id: str) -> None:
        payment = await db.get(Payment, refund_payment_id)
        if payment is None or not payment.refund_notify or payment.status != "succeeded":
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, payment.amount_cents, payment.currency)
        subject, body = _refund(locale, amount, business.name, payment.credit_note)
        await self._to_client(db, payment.client_id, subject, body)

    async def on_payment_failed(self, db: AsyncSession, payment_id: str) -> None:
        """Tell the client a one-off charge failed."""
        payment = await db.get(Payment, payment_id)
        if payment is None:
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, payment.amount_cents, payment.currency)
        subject, body = _payment_failed(locale, amount, business.name)
        await self._to_client(db, payment.client_id, subject, body)

    async def on_payment_disputed(self, db: AsyncSession, payment_id: str) -> None:
        """Alert the provider's staff that a charge was disputed — they must respond in Stripe."""
        payment = await db.get(Payment, payment_id)
        if payment is None:
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, payment.amount_cents, payment.currency)
        await self._alert_staff(db, business, _dispute_alert(locale, amount), {"type": "dispute"})

    async def on_inbound_message(self, db: AsyncSession, message_id: str) -> None:
        """Alert the business's staff devices to a client's text or Connect message."""
        received = await db.get(Message, message_id)
        if received is None or received.direction != "in":
            return
        thread = await db.get(Thread, received.thread_id)
        business = await db.get(Business, received.business_id)
        if thread is None or business is None:
            return
        client = await db.get(Client, thread.client_id)
        preview = " ".join((received.body or "").split())
        if len(preview) > _PREVIEW_CHARS:
            preview = preview[: _PREVIEW_CHARS - 1].rstrip() + "…"
        body = _inbound_message_alert(
            locale_for(business=business), client.name if client is not None else "", preview
        )
        data = {"type": "message", "thread_id": thread.id, "client_id": thread.client_id}
        await self._alert_staff(db, business, body, data)

    async def on_subscription_past_due(self, db: AsyncSession, subscription_id: str) -> None:
        sub = await db.get(Subscription, subscription_id)
        if sub is None:
            return
        business = await db.get(Business, sub.business_id)
        if business is None:
            return
        subject, body = _subscription_past_due(locale_for(business=business), business.name)
        await self._to_client(db, sub.client_id, subject, body)

    async def on_subscription_canceled(self, db: AsyncSession, subscription_id: str) -> None:
        sub = await db.get(Subscription, subscription_id)
        if sub is None:
            return
        business = await db.get(Business, sub.business_id)
        if business is None:
            return
        subject, body = _subscription_canceled(locale_for(business=business), business.name)
        await self._to_client(db, sub.client_id, subject, body)

    async def on_gift_card_issued(self, db: AsyncSession, gift_card_id: str) -> None:
        """Send a gift card's code to its recipient once the purchase settles."""
        card = await db.get(GiftCard, gift_card_id)
        if card is None or not card.recipient:
            return
        business = await db.get(Business, card.business_id)
        payment = await db.get(Payment, card.payment_id) if card.payment_id else None
        if business is None or payment is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, card.initial_cents, payment.currency)
        subject, body = _gift_card_issued(locale, business.name, amount, card.code)
        if "@" in card.recipient:
            await self._safe(self.email.send(Email(to=card.recipient, subject=subject, body=body)))
        else:
            await self._safe(self.sms.send(Sms(to=card.recipient, body=body)))

    async def on_booking_reminder(self, db: AsyncSession, booking_id: str) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        message = await reminder_message(db, booking)
        if message is not None:
            await self._to_client(db, booking.client_id, *message)

    async def on_booking_confirmed(self, db: AsyncSession, booking_id: str) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        slot = await db.get(Slot, booking.slot_id)
        business = await db.get(Business, booking.business_id)
        if slot is None or business is None:
            return
        locale = locale_for(business=business)
        when = _when(locale, business, slot)
        subject, body = _booking_confirmed(
            locale, business.name, when, _manage_link(business, booking)
        )
        await self._to_client(db, booking.client_id, subject, body)

    async def on_booking_rescheduled(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, _booking_rescheduled)

    async def on_booking_canceled(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, _booking_canceled)

    async def on_booking_requested(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, _booking_requested)

    async def on_booking_released(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, _booking_released)

    async def _visit_notice(
        self, db: AsyncSession, booking_id: str, build: Callable[[str, str, str], tuple[str, str]]
    ) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        slot = await db.get(Slot, booking.slot_id)
        business = await db.get(Business, booking.business_id)
        if slot is None or business is None:
            return
        locale = locale_for(business=business)
        subject, body = build(locale, business.name, _when(locale, business, slot))
        await self._to_client(db, booking.client_id, subject, body)

    async def on_series_booked(
        self, db: AsyncSession, booking_ids: list[str], kind: SeriesNotice
    ) -> None:
        """One message for many visits of a series, listing each date."""
        if not booking_ids:
            return
        rows = (
            await db.execute(
                select(Booking, Slot)
                .join(Slot, Slot.id == Booking.slot_id)
                .where(Booking.id.in_(booking_ids))
                .order_by(Slot.starts_at)
            )
        ).all()
        if not rows:
            return
        first = rows[0][0]
        business = await db.get(Business, first.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        whens = message(locale, "series.separator").join(
            _when(locale, business, slot) for _, slot in rows
        )
        build = {
            "booked": _series_booked,
            "moved": _series_moved,
            "canceled": _series_canceled,
        }[kind]
        subject, body = build(locale, business.name, whens)
        await self._to_client(db, first.client_id, subject, body)

    async def on_visits_reassigned(self, db: AsyncSession, booking_ids: list[str]) -> None:
        """One message per client and new member, naming who now does the visits."""
        for client_id, staff_id, rows in await _visits_by_client(db, booking_ids):
            business = await db.get(Business, rows[0][0].business_id)
            member = await db.get(Staff, staff_id)
            if business is None or member is None:
                continue
            locale = locale_for(business=business)
            subject, body = _booking_reassigned(
                locale,
                business.name,
                [_when(locale, business, slot) for _, slot in rows],
                member.name or member.title or message(locale, "staff.someone"),
            )
            await self._to_client(db, client_id, subject, body)

    async def on_visits_canceled(self, db: AsyncSession, booking_ids: list[str]) -> None:
        """One notice per client: the single-visit notice, or a list when they had several."""
        for _, _, rows in await _visits_by_client(db, booking_ids, by_member=False):
            if len(rows) == 1:
                await self.on_booking_canceled(db, rows[0][0].id)
            else:
                await self.on_series_booked(db, [b.id for b, _ in rows], "canceled")

    async def on_review_requested(self, db: AsyncSession, review_id: str) -> None:
        review = await db.get(Review, review_id)
        if review is None or review.token is None:
            return
        business = await db.get(Business, review.business_id)
        if business is None:
            return
        link = f"{get_settings().connect_base_url}/review/{review.token}"
        subject, body = _review_requested(locale_for(business=business), business.name, link)
        await self._to_client(db, review.client_id, subject, body)

    async def on_form_sent(self, db: AsyncSession, form_response_id: str) -> None:
        response = await db.get(FormResponse, form_response_id)
        if response is None:
            return
        form = await db.get(Form, response.form_id)
        business = await db.get(Business, response.business_id)
        if form is None or business is None:
            return
        link = f"{get_settings().connect_base_url}/form/{response.token}"
        subject, body = _form_sent(locale_for(business=business), business.name, form.name, link)
        await self._to_client(db, response.client_id, subject, body)

    async def on_contract_sent(self, db: AsyncSession, signature_id: str) -> None:
        signature = await db.get(Signature, signature_id)
        if signature is None:
            return
        contract = await db.get(Contract, signature.contract_id)
        business = await db.get(Business, signature.business_id)
        if contract is None or business is None:
            return
        link = f"{get_settings().connect_base_url}/contract/{signature.token}"
        subject, body = _contract_sent(
            locale_for(business=business), business.name, contract.name, link
        )
        await self._to_client(db, signature.client_id, subject, body)

    async def _itemised(self, db: AsyncSession, locale: str, payment: Payment) -> list[str]:
        parent: tuple[LineParent, str] | None = (
            ("order", payment.order_id)
            if payment.order_id
            else ("invoice", payment.invoice_id)
            if payment.invoice_id
            else None
        )
        if parent is None:
            return []
        lines = await fetch_lines(db, payment.business_id, *parent)
        if not lines:
            return []
        tax = await tax_breakdown(db, payment.business_id, lines)
        cur = payment.currency
        return _receipt_details(
            locale,
            [
                (
                    ln.description,
                    format_number(locale, ln.quantity),
                    format_money(locale, ln.amount_cents, cur),
                )
                for ln in lines
            ],
            format_money(locale, tax.subtotal_cents, cur),
            [
                (code, format_money(locale, cents, cur))
                for code, cents in sorted(tax.by_jurisdiction.items())
            ],
            format_money(locale, tax.total_cents, cur),
        )

    async def _to_contact(
        self, email: str | None, phone: str | None, subject: str, body: str
    ) -> None:
        if email:
            await self._safe(self.email.send(Email(to=email, subject=subject, body=body)))
        number = e164(phone) if phone else None
        if number:
            await self._safe(self.sms.send(Sms(to=number, body=body)))

    async def _to_client(
        self,
        db: AsyncSession,
        client_id: str | None,
        subject: str,
        body: str,
        *,
        channel: str | None = None,
    ) -> None:
        """Email + SMS to a client (or only the channel asked for), each isolated from the other."""
        if client_id is None:
            return
        client = await db.get(Client, client_id)
        if client is None:
            return
        if client.email and channel != "sms":
            await self._safe(self.email.send(Email(to=client.email, subject=subject, body=body)))
        number = e164(client.phone) if client.phone else None
        if (
            number
            and channel != "email"
            and not await texts_stopped(db, client.business_id, client.id)
        ):
            await self._safe(self.sms.send(Sms(to=number, body=body)))

    async def _alert_staff(
        self, db: AsyncSession, business: Business, body: str, data: dict[str, str]
    ) -> None:
        members = (
            scoped(Staff, business.id)
            .with_only_columns(Staff.user_id)
            .where(Staff.status == "active")
        )
        rows = (
            (await db.execute(scoped(Device, business.id).where(Device.user_id.in_(members))))
            .scalars()
            .all()
        )
        tokens = [r.token for r in rows]
        if tokens:
            await self._safe(
                self.push.send(Push(tokens=list(tokens), title=business.name, body=body, data=data))
            )

    async def _safe(self, awaitable: Awaitable[None]) -> None:
        try:
            await awaitable
        except Exception:
            _log.exception("outreach channel send failed")


class DeviceService:
    """Registers the caller's push token, upserted by token."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal

    async def register(self, token: str, platform: DevicePlatform) -> None:
        existing = (
            await self.db.execute(select(Device).where(Device.token == token))
        ).scalar_one_or_none()
        if existing is not None:
            existing.user_id = self.principal.user_id
            existing.business_id = self.principal.business_id
            existing.platform = platform
            existing.updated_at = datetime.now(UTC)
        else:
            self.db.add(
                Device(
                    id=new_id("device"),
                    business_id=self.principal.business_id,
                    user_id=self.principal.user_id,
                    token=token,
                    platform=platform,
                )
            )
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()  # a concurrent register of the same token won — already done

    async def unregister(self, token: str) -> None:
        """Forget the caller's push token, as on sign-out; another user's token is left alone."""
        device = (
            await self.db.execute(
                select(Device).where(
                    Device.token == token, Device.user_id == self.principal.user_id
                )
            )
        ).scalar_one_or_none()
        if device is not None:
            await self.db.delete(device)
            await self.db.commit()


_DEVICE_TTL = timedelta(days=60)


async def run_prune_devices(db: AsyncSession, now: datetime) -> int:
    """Drop push tokens not seen in 60 days."""
    devices = (
        (await db.execute(select(Device).where(Device.updated_at < now - _DEVICE_TTL)))
        .scalars()
        .all()
    )
    for device in devices:
        await db.delete(device)
    await db.commit()
    return len(devices)
