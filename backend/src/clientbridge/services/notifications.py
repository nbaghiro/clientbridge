import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import Enum
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal
from clientbridge.core.email_layout import (
    ACCENT,
    Action,
    Brand,
    EmailView,
    Row,
    inline_images,
    render_html,
)
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
from clientbridge.integrations.resend import Email, EmailSender
from clientbridge.integrations.twilio import Sms, SmsSender
from clientbridge.models.billing import Estimate, Invoice, Order
from clientbridge.models.business import Business, Staff, User
from clientbridge.models.catalog import GiftCard, Subscription
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, FormResponse, Signature
from clientbridge.models.messaging import Message, Thread
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Device, DevicePlatform, File
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.auth import AuthEmailIn
from clientbridge.schemas.forms import FormDefinition
from clientbridge.services import ledger
from clientbridge.services.business import reply_address, staff_names
from clientbridge.services.consents import texts_stopped
from clientbridge.services.files import media_url
from clientbridge.services.lines import LineParent, fetch_lines, issued_at
from clientbridge.services.tax import issued_tax

_log = logging.getLogger(__name__)
_PREVIEW_CHARS = 120

_HEX = re.compile(r"#[0-9A-Fa-f]{6}")
# the image types every major mail app shows; an SVG or WebP logo falls back to the name
_EMAIL_IMAGES = frozenset({"image/png", "image/jpeg", "image/gif"})

SeriesNotice = Literal["booked", "moved", "canceled"]


class Outcome(Enum):
    """Whether a notice reached the client; a job retries only a failed one."""

    DELIVERED = "delivered"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass(frozen=True)
class Notice:
    """A message to one person: its subject, the text SMS and plain email send, and its design."""

    subject: str
    body: str
    view: EmailView


@dataclass(frozen=True)
class Itemised:
    """A receipt's lines, as the plain text lists them and as the email's table shows them."""

    lines: tuple[str, ...]
    rows: tuple[Row, ...]


def _view(
    eyebrow: str,
    heading: str,
    *paragraphs: str,
    action: Action | None = None,
    code: str | None = None,
    rows: tuple[Row, ...] = (),
    note: str | None = None,
) -> EmailView:
    return EmailView(
        eyebrow=eyebrow,
        heading=heading,
        paragraphs=paragraphs,
        action=action,
        code=code,
        rows=rows,
        note=note,
    )


def _action(label: str, link: str | None) -> Action | None:
    return Action(label=label, url=link) if link else None


def _lang(locale: str) -> str:
    return locale.replace("_", "-")


def _paragraphs(text: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in text.split("\n\n") if part.strip())


def platform_brand() -> Brand:
    return Brand(
        name="Clientbridge",
        header_url="cid:clientbridge-header",
        art_url="cid:clientbridge-contours",
    )


async def business_brand(db: AsyncSession, business: Business) -> Brand:
    """A business's look in its emails: its brand colour, and its logo when mail apps show it."""
    brand = business.brand or {}
    primary = brand.get("primary")
    accent = primary if isinstance(primary, str) and _HEX.fullmatch(primary) else ACCENT
    logo_id = brand.get("logo_file_id")
    logo = await db.get(File, logo_id) if isinstance(logo_id, str) else None
    shown = (
        logo is not None
        and logo.uploaded_at is not None
        and logo.business_id == business.id
        and logo.content_type in _EMAIL_IMAGES
    )
    return Brand(
        name=business.name,
        accent=accent,
        logo_url=media_url(logo.id) if shown and logo is not None else None,
        art_url="cid:clientbridge-contours",
        sent_with=message(locale_for(business=business), "email.sent_with"),
    )


def _business_line(locale: str, business: Business) -> str:
    brand = business.brand or {}
    extra = (brand.get("address"), brand.get("phone"), reply_address(business))
    parts = [business.name, *(value for value in extra if isinstance(value, str) and value)]
    return message(locale, "email.footer.separator").join(parts)


def _client_footer(locale: str, business: Business) -> tuple[str, ...]:
    reason = message(locale, "email.footer.client", business=business.name)
    return (_business_line(locale, business), reason)


def email_html(brand: Brand, view: EmailView, locale: str) -> str:
    preheader = view.paragraphs[0] if view.paragraphs else view.heading
    return render_html(brand, view, preheader=preheader, lang=_lang(locale))


def client_email(
    business: Business,
    brand: Brand,
    to: str,
    notice: Notice,
    *,
    client: Client | None = None,
    message: Message | None = None,
) -> Email:
    """Mail to a client for a business: replies go to the business, tags name who it concerns."""
    tags = {"business": business.id}
    if client is not None:
        tags["client"] = client.id
    if message is not None:
        tags["message"] = message.id
    locale = locale_for(business=business, client=client)
    view = (
        notice.view
        if notice.view.footer
        else replace(notice.view, footer=_client_footer(locale, business))
    )
    html = email_html(brand, view, locale)
    return Email(
        to=to,
        subject=notice.subject,
        body=notice.body,
        html=html,
        images=inline_images(html),
        reply_to=reply_address(business),
        idempotency_key=message.id if message is not None else None,
        tags=tags,
    )


def business_email(business: Business, to: str, notice: Notice) -> Email:
    """Mail to a business's own people (alerts, invites): tagged with the tenant, no reply-to."""
    locale = locale_for(business=business)
    footer = (
        message(locale, "email.footer.team", business=business.name),
        message(locale, "email.footer.company"),
    )
    html = email_html(platform_brand(), replace(notice.view, footer=footer), locale)
    return Email(
        to=to,
        subject=notice.subject,
        body=notice.body,
        html=html,
        images=inline_images(html),
        tags={"business": business.id},
    )


def account_email(to: str, notice: Notice, *, locale: str) -> Email:
    """Mail from Clientbridge itself to an address, before or outside any business."""
    footer = (
        message(locale, "email.footer.account"),
        message(locale, "email.footer.company"),
    )
    html = email_html(platform_brand(), replace(notice.view, footer=footer), locale)
    return Email(
        to=to,
        subject=notice.subject,
        body=notice.body,
        html=html,
        images=inline_images(html),
    )


def returning_code(locale: str, business_name: str, code: str, minutes: int) -> Notice:
    return Notice(
        message(locale, "returning_code.subject", business=business_name),
        plural(locale, "returning_code.body", minutes, code=code),
        _view(
            message(locale, "email.kind.verification"),
            message(locale, "returning_code.heading"),
            plural(locale, "returning_code.lead", minutes, business=business_name),
            code=code,
            note=message(locale, "returning_code.note"),
        ),
    )


def staff_invite(locale: str, business_name: str, link: str) -> Notice:
    return Notice(
        message(locale, "staff_invite.subject"),
        message(locale, "staff_invite.body", link=link),
        _view(
            message(locale, "email.kind.team"),
            message(locale, "staff_invite.heading", business=business_name),
            message(locale, "staff_invite.lead", business=business_name),
            action=Action(message(locale, "staff_invite.action"), link),
        ),
    )


def waitlist_message(locale: str, link: str, *, already: bool = False) -> Notice:
    """The email a waitlist sign-up gets from the site's server: welcome, or already on the list."""
    if already:
        subject = message(locale, "waitlist_again.subject")
        heading = message(locale, "waitlist_again.heading")
        body = message(locale, "waitlist_again.body")
    else:
        subject = message(locale, "waitlist.subject")
        heading = message(locale, "waitlist.heading")
        body = message(locale, "waitlist.body")
    more = message(locale, "waitlist.more")
    return Notice(
        subject,
        message(locale, "waitlist.text", body=body, more=more, link=link),
        EmailView(
            eyebrow=message(locale, "email.kind.waitlist"),
            heading=heading,
            paragraphs=(body, more),
            action=Action(message(locale, "waitlist.action"), link),
            footer=(message(locale, "waitlist.footer"), message(locale, "email.footer.company")),
        ),
    )


def _code_notice(
    locale: str, kind: str, subject: str, body: str, heading: str, lead: str, note: str, code: str
) -> Notice:
    return Notice(subject, body, _view(kind, heading, lead, code=code, note=note))


def auth_email_message(locale: str, email: AuthEmailIn) -> Notice:
    code, minutes = email.code or "", email.expires_in_minutes or 0
    account = message(locale, "email.kind.account")
    match email.template_type:
        case "verification_code_valid":
            body = plural(locale, "verification_code.body", minutes, code=code)
            if email.link:
                body += "\n\n" + message(locale, "verification_code.link", link=email.link)
            return Notice(
                message(locale, "verification_code.subject"),
                body,
                _view(
                    account,
                    message(locale, "verification_code.heading"),
                    plural(locale, "verification_code.lead", minutes),
                    code=code,
                    action=_action(message(locale, "verification_code.action"), email.link),
                    note=message(locale, "verification_code.note"),
                ),
            )
        case "verification_code_invalid":
            body = message(locale, "verification_unknown.body")
            return Notice(
                message(locale, "verification_unknown.subject"),
                body,
                _view(account, message(locale, "verification_unknown.heading"), body),
            )
        case "recovery_code_valid":
            return _code_notice(
                locale,
                account,
                message(locale, "recovery_code.subject"),
                plural(locale, "recovery_code.body", minutes, code=code),
                message(locale, "recovery_code.heading"),
                plural(locale, "recovery_code.lead", minutes),
                message(locale, "recovery_code.note"),
                code,
            )
        case "recovery_code_invalid":
            body = message(locale, "recovery_unknown.body")
            return Notice(
                message(locale, "recovery_unknown.subject"),
                body,
                _view(account, message(locale, "recovery_unknown.heading"), body),
            )
        case "login_code_valid":
            return _code_notice(
                locale,
                account,
                message(locale, "login_code.subject"),
                plural(locale, "login_code.body", minutes, code=code),
                message(locale, "login_code.heading"),
                plural(locale, "login_code.lead", minutes),
                message(locale, "login_code.note"),
                code,
            )
        case "registration_code_valid":
            return _code_notice(
                locale,
                account,
                message(locale, "registration_code.subject"),
                plural(locale, "registration_code.body", minutes, code=code),
                message(locale, "registration_code.heading"),
                plural(locale, "registration_code.lead", minutes),
                message(locale, "registration_code.note"),
                code,
            )


async def send_auth_email(email_sender: EmailSender, email: AuthEmailIn) -> None:
    """Words and sends an email the auth service handed over; a failure lets it retry."""
    locale = locale_for()
    await email_sender.send(
        account_email(email.to, auth_email_message(locale, email), locale=locale)
    )


def invite_link(token: str) -> str:
    """Where an invitee signs up or in, then joins the team."""
    return f"{get_settings().web_base_url}/accept-invite?token={token}"


def plan_link() -> str:
    """The owner's plan page in the web app."""
    return f"{get_settings().web_base_url}/setup/plan"


def pay_link(token: str) -> str:
    """The client's link to pay an invoice: one host for every business."""
    return f"{get_settings().pay_base_url}/i/{token}"


def estimate_link(token: str) -> str:
    """The client's link to read and answer an estimate, on the same host as pay links."""
    return f"{get_settings().pay_base_url}/e/{token}"


def receipt_link(token: str) -> str:
    """The client's itemised receipt for a desk sale, on the same host as pay links."""
    return f"{get_settings().pay_base_url}/r/{token}"


def order_link(token: str) -> str:
    """The client's page for an online order's status, on the same host as pay links."""
    return f"{get_settings().pay_base_url}/order/{token}"


def receipt_message(
    locale: str,
    business_name: str,
    amount: str,
    itemised: Itemised,
    *,
    pickup: bool = False,
    order: str | None = None,
) -> tuple[Notice, str]:
    """(notice, push) for a payment receipt with its itemised details."""
    lead = message(locale, "receipt.body", amount=amount, business=business_name)
    pickup_line = receipt_pickup_line(locale, business_name) if pickup else None
    extra = [line for line in (pickup_line, order) if line]
    lines = [*itemised.lines, *extra]
    body = lead + ("\n\n" + "\n".join(lines) if lines else "")
    view = _view(
        message(locale, "email.kind.receipt"),
        message(locale, "receipt.heading"),
        lead,
        *([pickup_line] if pickup_line else []),
        rows=itemised.rows,
        action=_action(message(locale, "receipt.order_action"), order),
    )
    return (
        Notice(message(locale, "receipt.subject", business=business_name), body, view),
        message(locale, "receipt.push", amount=amount),
    )


def receipt_pickup_line(locale: str, business_name: str) -> str:
    return message(locale, "pickup.body", business=business_name)


def online_order_alert_message(locale: str, amount: str) -> Notice:
    """The owner's email (its subject is also the push body) for a paid online order."""
    subject = message(locale, "online_order.subject", amount=amount)
    body = message(locale, "online_order.body", amount=amount)
    return Notice(
        subject,
        body,
        _view(message(locale, "email.kind.order"), message(locale, "online_order.heading"), body),
    )


def sale_receipt_message(locale: str, business_name: str, number: int | None, link: str) -> Notice:
    subject = message(locale, "sale_receipt.subject", business=business_name)
    if number is None:
        body = message(locale, "sale_receipt.body", business=business_name, link=link)
        lead = message(locale, "sale_receipt.lead", business=business_name)
    else:
        body = message(
            locale, "sale_receipt.body_numbered", business=business_name, number=number, link=link
        )
        lead = message(locale, "sale_receipt.lead_numbered", business=business_name, number=number)
    return Notice(
        subject,
        body,
        _view(
            message(locale, "email.kind.receipt"),
            message(locale, "sale_receipt.heading"),
            lead,
            action=Action(message(locale, "sale_receipt.action"), link),
        ),
    )


def _order_notice(locale: str, subject: str, body: str, heading: str, link: str | None) -> Notice:
    return Notice(
        subject,
        body + (f"\n{link}" if link else ""),
        _view(
            message(locale, "email.kind.order"),
            heading,
            body,
            action=_action(message(locale, "order.action"), link),
        ),
    )


def order_ready_message(locale: str, business_name: str, link: str | None = None) -> Notice:
    return _order_notice(
        locale,
        message(locale, "order_ready.subject", business=business_name),
        message(locale, "order_ready.body", business=business_name),
        message(locale, "order_ready.heading"),
        link,
    )


def order_reminder_message(locale: str, business_name: str, link: str | None = None) -> Notice:
    return _order_notice(
        locale,
        message(locale, "order_reminder.subject", business=business_name),
        message(locale, "order_reminder.body", business=business_name),
        message(locale, "order_reminder.heading"),
        link,
    )


def receipt_detail_lines(
    locale: str,
    lines: list[tuple[str, str, str]],
    subtotal: str,
    taxes: list[tuple[str, str]],
    total: str,
    tip: str | None = None,
) -> Itemised:
    text = [
        message(locale, "receipt.line", item=name, quantity=quantity, amount=amount)
        for name, quantity, amount in lines
    ]
    rows = [
        Row(message(locale, "receipt.item", item=name, quantity=quantity), amount)
        for name, quantity, amount in lines
    ]
    text.append(message(locale, "receipt.subtotal", amount=subtotal))
    rows.append(Row(message(locale, "receipt.subtotal_label"), subtotal))
    text.extend(message(locale, "receipt.tax", tax=code, amount=amount) for code, amount in taxes)
    rows.extend(Row(code, amount) for code, amount in taxes)
    if tip is not None:
        text.append(message(locale, "receipt.tip", amount=tip))
        rows.append(Row(message(locale, "receipt.tip_label"), tip))
    text.append(message(locale, "receipt.total", amount=total))
    rows.append(Row(message(locale, "receipt.total_label"), total, total=True))
    return Itemised(tuple(text), tuple(rows))


def inbound_message_alert_text(locale: str, client_name: str, body: str) -> str:
    return message(locale, "inbound_message.push", client=client_name, body=body)


def dispute_alert_text(locale: str, amount: str) -> str:
    """Staff push body when a charge is disputed: the owner must respond in Stripe."""
    return message(locale, "dispute.push", amount=amount)


def invoice_sent_message(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> Notice:
    values = {"number": str(number), "amount": amount, "business": business_name}
    body = (
        message(locale, "invoice_sent.body_link", link=link, **values)
        if link
        else message(locale, "invoice_sent.body", **values)
    )
    return Notice(
        message(locale, "invoice_sent.subject", **values),
        body,
        _view(
            message(locale, "email.kind.invoice"),
            message(locale, "invoice_sent.heading", **values),
            message(locale, "invoice_sent.lead", **values),
            action=_action(message(locale, "invoice.action"), link),
        ),
    )


def invoice_overdue_message(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> Notice:
    values = {"number": str(number), "amount": amount, "business": business_name}
    body = (
        message(locale, "invoice_overdue.body_link", link=link, **values)
        if link
        else message(locale, "invoice_overdue.body", **values)
    )
    return Notice(
        message(locale, "invoice_overdue.subject", **values),
        body,
        _view(
            message(locale, "email.kind.invoice"),
            message(locale, "invoice_overdue.heading", **values),
            message(locale, "invoice_overdue.lead", **values),
            action=_action(message(locale, "invoice.action"), link),
        ),
    )


def estimate_sent_message(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> Notice:
    values = {"number": str(number), "amount": amount, "business": business_name}
    body = (
        message(locale, "estimate_sent.body_link", link=link, **values)
        if link
        else message(locale, "estimate_sent.body", **values)
    )
    return Notice(
        message(locale, "estimate_sent.subject", **values),
        body,
        _view(
            message(locale, "email.kind.estimate"),
            message(locale, "estimate_sent.heading", **values),
            message(locale, "estimate_sent.lead", **values),
            action=_action(message(locale, "estimate.action"), link),
        ),
    )


def estimate_accepted_message(locale: str, number: int | None) -> Notice:
    subject = message(locale, "estimate_accepted.subject", number=str(number))
    body = message(locale, "estimate_accepted.body", number=str(number))
    return Notice(subject, body, _view(message(locale, "email.kind.estimate"), subject, body))


def estimate_declined_message(locale: str, number: int | None, reason: str | None) -> Notice:
    body = (
        message(locale, "estimate_declined.body_reason", number=str(number), reason=reason)
        if reason
        else message(locale, "estimate_declined.body", number=str(number))
    )
    subject = message(locale, "estimate_declined.subject", number=str(number))
    return Notice(subject, body, _view(message(locale, "email.kind.estimate"), subject, body))


def _simple(locale: str, eyebrow: str, subject: str, body: str, heading: str) -> Notice:
    return Notice(subject, body, _view(eyebrow, heading, body))


def payment_failed_message(locale: str, amount: str, business_name: str) -> Notice:
    return _simple(
        locale,
        message(locale, "email.kind.payment"),
        message(locale, "payment_failed.subject", business=business_name),
        message(locale, "payment_failed.body", amount=amount, business=business_name),
        message(locale, "payment_failed.heading"),
    )


def refund_message(locale: str, amount: str, business_name: str, credit_note: str | None) -> Notice:
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
    return _simple(
        locale,
        message(locale, "email.kind.refund"),
        message(locale, "refund.subject", business=business_name),
        body,
        message(locale, "refund.heading"),
    )


def refund_failed_message(locale: str, amount: str, business_name: str) -> Notice:
    return _simple(
        locale,
        message(locale, "email.kind.refund"),
        message(locale, "refund_failed.subject", business=business_name),
        message(locale, "refund_failed.body", amount=amount, business=business_name),
        message(locale, "refund_failed.heading"),
    )


def subscription_past_due_message(locale: str, business_name: str) -> Notice:
    return _simple(
        locale,
        message(locale, "email.kind.subscription"),
        message(locale, "subscription_past_due.subject", business=business_name),
        message(locale, "subscription_past_due.body", business=business_name),
        message(locale, "subscription_past_due.heading"),
    )


def subscription_canceled_message(locale: str, business_name: str) -> Notice:
    return _simple(
        locale,
        message(locale, "email.kind.subscription"),
        message(locale, "subscription_canceled.subject", business=business_name),
        message(locale, "subscription_canceled.body", business=business_name),
        message(locale, "subscription_canceled.heading"),
    )


def trial_ending_message(
    locale: str, business_name: str, when: str, link: str, *, last_day: bool
) -> Notice:
    values = {"business": business_name, "when": when, "link": link}
    plan = message(locale, "email.kind.plan")
    action = Action(message(locale, "trial.action"), link)
    if last_day:
        return Notice(
            message(locale, "trial_last_day.subject"),
            message(locale, "trial_last_day.body", **values),
            _view(
                plan,
                message(locale, "trial_last_day.heading"),
                message(locale, "trial_last_day.lead", business=business_name, when=when),
                action=action,
            ),
        )
    return Notice(
        message(locale, "trial_ending.subject"),
        message(locale, "trial_ending.body", **values),
        _view(
            plan,
            message(locale, "trial_ending.heading"),
            message(locale, "trial_ending.lead", business=business_name, when=when),
            action=action,
        ),
    )


def gift_card_issued_message(locale: str, business_name: str, amount: str, code: str) -> Notice:
    return Notice(
        message(locale, "gift_card_issued.subject", business=business_name),
        message(locale, "gift_card_issued.body", amount=amount, business=business_name, code=code),
        _view(
            message(locale, "email.kind.gift_card"),
            message(locale, "gift_card_issued.heading", amount=amount),
            message(locale, "gift_card_issued.lead", business=business_name),
            code=code,
        ),
    )


def _visit(
    locale: str, subject: str, body: str, heading: str, lead: str, link: str | None = None
) -> Notice:
    return Notice(
        subject,
        body,
        _view(
            message(locale, "email.kind.booking"),
            heading,
            lead,
            action=_action(message(locale, "booking.action"), link),
        ),
    )


def booking_reminder_message(
    locale: str, business_name: str, when: str, link: str | None
) -> Notice:
    lead = message(locale, "booking_reminder.body", business=business_name, when=when)
    body = (
        message(locale, "booking_reminder.body_link", business=business_name, when=when, link=link)
        if link
        else lead
    )
    return _visit(
        locale,
        message(locale, "booking_reminder.subject", business=business_name),
        body,
        message(locale, "booking_reminder.heading"),
        lead,
        link,
    )


def booking_confirmed_message(
    locale: str, business_name: str, when: str, link: str | None
) -> Notice:
    lead = message(locale, "booking_confirmed.body", business=business_name, when=when)
    body = (
        message(locale, "booking_confirmed.body_link", business=business_name, when=when, link=link)
        if link
        else lead
    )
    return _visit(
        locale,
        message(locale, "booking_confirmed.subject", business=business_name),
        body,
        message(locale, "booking_confirmed.heading"),
        lead,
        link,
    )


def _visit_plain(locale: str, subject: str, body: str, heading: str) -> Notice:
    return _visit(locale, subject, body, heading, body)


def booking_rescheduled_message(locale: str, business_name: str, when: str) -> Notice:
    return _visit_plain(
        locale,
        message(locale, "booking_rescheduled.subject", business=business_name),
        message(locale, "booking_rescheduled.body", business=business_name, when=when),
        message(locale, "booking_rescheduled.heading"),
    )


def booking_canceled_message(locale: str, business_name: str, when: str) -> Notice:
    return _visit_plain(
        locale,
        message(locale, "booking_canceled.subject", business=business_name),
        message(locale, "booking_canceled.body", business=business_name, when=when),
        message(locale, "booking_canceled.heading"),
    )


def booking_reassigned_message(
    locale: str, business_name: str, whens: list[str], member: str
) -> Notice:
    if len(whens) == 1:
        return _visit_plain(
            locale,
            message(locale, "booking_reassigned.subject", business=business_name),
            message(
                locale,
                "booking_reassigned.body",
                business=business_name,
                when=whens[0],
                member=member,
            ),
            message(locale, "booking_reassigned.heading"),
        )
    return _visit_plain(
        locale,
        message(locale, "visits_reassigned.subject", business=business_name),
        message(
            locale,
            "visits_reassigned.body",
            business=business_name,
            whens=message(locale, "series.separator").join(whens),
            member=member,
        ),
        message(locale, "visits_reassigned.heading"),
    )


def booking_requested_message(locale: str, business_name: str, when: str) -> Notice:
    return _visit_plain(
        locale,
        message(locale, "booking_requested.subject", business=business_name),
        message(locale, "booking_requested.body", business=business_name, when=when),
        message(locale, "booking_requested.heading"),
    )


def booking_released_message(locale: str, business_name: str, when: str) -> Notice:
    return _visit_plain(
        locale,
        message(locale, "booking_released.subject", business=business_name),
        message(locale, "booking_released.body", business=business_name, when=when),
        message(locale, "booking_released.heading"),
    )


def series_booked_message(locale: str, business_name: str, whens: str) -> Notice:
    return _visit_plain(
        locale,
        message(locale, "series_booked.subject", business=business_name),
        message(locale, "series_booked.body", business=business_name, whens=whens),
        message(locale, "series_booked.heading"),
    )


def series_moved_message(locale: str, business_name: str, whens: str) -> Notice:
    return _visit_plain(
        locale,
        message(locale, "series_moved.subject", business=business_name),
        message(locale, "series_moved.body", business=business_name, whens=whens),
        message(locale, "series_moved.heading"),
    )


def series_canceled_message(locale: str, business_name: str, whens: str) -> Notice:
    return _visit_plain(
        locale,
        message(locale, "series_canceled.subject", business=business_name),
        message(locale, "series_canceled.body", business=business_name, whens=whens),
        message(locale, "series_canceled.heading"),
    )


def form_sent_message(locale: str, business_name: str, form_name: str, link: str) -> Notice:
    values = {"business": business_name, "form": form_name}
    return Notice(
        message(locale, "form_sent.subject", **values),
        message(locale, "form_sent.body", link=link, **values),
        _view(
            message(locale, "email.kind.form"),
            message(locale, "form_sent.heading", **values),
            message(locale, "form_sent.lead", **values),
            action=Action(message(locale, "form.action"), link),
        ),
    )


def contract_sent_message(locale: str, business_name: str, contract_name: str, link: str) -> Notice:
    values = {"business": business_name, "contract": contract_name}
    return Notice(
        message(locale, "contract_sent.subject", **values),
        message(locale, "contract_sent.body", link=link, **values),
        _view(
            message(locale, "email.kind.contract"),
            message(locale, "contract_sent.heading", **values),
            message(locale, "contract_sent.lead", **values),
            action=Action(message(locale, "contract.action"), link),
        ),
    )


def review_requested_message(locale: str, business_name: str, link: str) -> Notice:
    return Notice(
        message(locale, "review_requested.subject", business=business_name),
        message(locale, "review_requested.body", business=business_name, link=link),
        _view(
            message(locale, "email.kind.review"),
            message(locale, "review_requested.heading"),
            message(locale, "review_requested.lead", business=business_name),
            action=Action(message(locale, "review.action"), link),
        ),
    )


def message_notice(locale: str, business_name: str, body: str) -> Notice:
    """A message the business's staff wrote to a client; the subject is the business's name."""
    return Notice(
        business_name,
        body,
        EmailView(
            eyebrow=message(locale, "email.kind.message"),
            heading=message(locale, "message.heading", business=business_name),
            paragraphs=_paragraphs(body),
        ),
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


def broadcast_notice(
    locale: str,
    business_name: str,
    name: str,
    body: str,
    prefs_link: str,
    address: str,
    contact: str,
) -> Notice:
    """A broadcast email: the business's identification and the opt-out sit in its footer."""
    text = broadcast_text(locale, business_name, "email", body, prefs_link, address, contact)
    contact_line = message(locale, "broadcast.contact", contact=contact)
    return Notice(
        name,
        text,
        EmailView(
            eyebrow=message(locale, "email.kind.news"),
            heading=name,
            paragraphs=_paragraphs(body),
            footer=tuple(line for line in (business_name, address, contact_line) if line),
            footer_link=Action(message(locale, "email.unsubscribe"), prefs_link),
        ),
    )


def _when(locale: str, business: Business, slot: Slot) -> str:
    return format_day_and_time(locale, slot.starts_at, business.timezone)


async def reminder_message(db: AsyncSession, booking: Booking) -> Notice | None:
    """The reminder a visit gets, word for word, as the job would send it."""
    slot = await db.get(Slot, booking.slot_id)
    business = await db.get(Business, booking.business_id)
    if slot is None or business is None:
        return None
    locale = locale_for(business=business)
    when = _when(locale, business, slot)
    return booking_reminder_message(locale, business.name, when, _manage_link(business, booking))


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

    def __init__(
        self, email: EmailSender, sms: SmsSender, push: PushSender, *, raise_errors: bool = False
    ) -> None:
        self.raise_errors = raise_errors
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
        itemised = await self._itemised(db, locale, payment)
        order = await db.get(Order, payment.order_id) if payment.order_id else None
        online = order is not None and order.source == "online"
        status = order_link(order.status_token) if online and order and order.status_token else None
        notice, push_body = receipt_message(
            locale, business.name, amount, itemised, pickup=online, order=status
        )
        if online:
            alert = online_order_alert_message(locale, amount)
            push_body = alert.subject
            if business.billing_email:
                await self._safe(
                    self.email.send(business_email(business, business.billing_email, alert))
                )
        if payment.client_id is not None:
            await self._to_client(db, payment.client_id, notice)
        elif order is not None:
            await self._to_contact(
                db, order.receipt_email, order.receipt_phone, notice, business=business
            )
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
        notice = order_ready_message(
            locale_for(business=business),
            business.name,
            order_link(order.status_token) if order.status_token else None,
        )
        await self._to_client(
            db, order.client_id, notice, channel=None if order.notify_sms else "email"
        )

    async def on_order_reminder(self, db: AsyncSession, order_id: str) -> None:
        order = await db.get(Order, order_id)
        if order is None or order.client_id is None:
            return
        business = await db.get(Business, order.business_id)
        if business is None:
            return
        notice = order_reminder_message(
            locale_for(business=business),
            business.name,
            order_link(order.status_token) if order.status_token else None,
        )
        await self._to_client(
            db, order.client_id, notice, channel=None if order.notify_sms else "email"
        )

    async def on_order_receipt(self, db: AsyncSession, order_id: str) -> None:
        """The receipt link, by the one channel the desk chose."""
        order = await db.get(Order, order_id)
        if order is None or order.receipt_token is None:
            return
        business = await db.get(Business, order.business_id)
        if business is None:
            return
        notice = sale_receipt_message(
            locale_for(business=business),
            business.name,
            order.number,
            receipt_link(order.receipt_token),
        )
        if order.receipt_channel == "email":
            await self._to_contact(db, order.receipt_email, None, notice, business=business)
        elif order.receipt_channel == "sms":
            await self._to_contact(db, None, order.receipt_phone, notice, business=business)

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
        notice = invoice_sent_message(locale, invoice.number, amount, business.name, link)
        await self._to_client(db, invoice.client_id, notice)

    async def on_invoice_overdue(self, db: AsyncSession, invoice_id: str) -> Outcome:
        invoice = await db.get(Invoice, invoice_id)
        if invoice is None:
            return Outcome.SKIPPED
        business = await db.get(Business, invoice.business_id)
        if business is None:
            return Outcome.SKIPPED
        locale = locale_for(business=business)
        amount = format_money(locale, await ledger.invoice_balance(db, invoice), invoice.currency)
        link = pay_link(invoice.pay_token) if invoice.pay_token else ""
        notice = invoice_overdue_message(locale, invoice.number, amount, business.name, link)
        return await self._to_client(db, invoice.client_id, notice)

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
        notice = estimate_sent_message(locale, estimate.number, amount, business.name, link)
        await self._to_client(db, estimate.client_id, notice)

    async def on_estimate_accepted(self, db: AsyncSession, estimate_id: str) -> None:
        """Alert the provider (their billing email) that a client accepted an estimate."""
        estimate = await db.get(Estimate, estimate_id)
        if estimate is None:
            return
        business = await db.get(Business, estimate.business_id)
        if business is None or not business.billing_email:
            return
        notice = estimate_accepted_message(locale_for(business=business), estimate.number)
        await self._safe(self.email.send(business_email(business, business.billing_email, notice)))

    async def on_estimate_declined(self, db: AsyncSession, estimate_id: str) -> None:
        """Alert the provider (their billing email) that a client declined an estimate."""
        estimate = await db.get(Estimate, estimate_id)
        if estimate is None:
            return
        business = await db.get(Business, estimate.business_id)
        if business is None or not business.billing_email:
            return
        notice = estimate_declined_message(
            locale_for(business=business), estimate.number, estimate.decline_reason
        )
        await self._safe(self.email.send(business_email(business, business.billing_email, notice)))

    async def on_trial_ending(self, db: AsyncSession, business_id: str, *, last_day: bool) -> None:
        """Remind the owner (their billing email, else their sign-in) that the trial is ending."""
        business = await db.get(Business, business_id)
        if business is None:
            return
        to = business.billing_email
        if not to:
            owner = await db.scalar(
                scoped(Staff, business.id)
                .with_only_columns(Staff.user_id)
                .where(Staff.role == "owner", Staff.status == "active")
                .order_by(Staff.created_at)
                .limit(1)
            )
            user = await db.get(User, owner) if owner is not None else None
            to = user.email if user is not None else None
        if not to:
            return
        locale = locale_for(business=business)
        when = format_day_and_time(locale, business.trial_ends_at, business.timezone)
        notice = trial_ending_message(locale, business.name, when, plan_link(), last_day=last_day)
        await self._safe(self.email.send(business_email(business, to, notice)))

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
        notice = refund_message(locale, amount, business.name, payment.credit_note)
        await self._to_client(db, payment.client_id, notice)

    async def on_refund_failed(self, db: AsyncSession, refund_payment_id: str) -> None:
        """Tell the client a refund they were told about bounced at their bank."""
        payment = await db.get(Payment, refund_payment_id)
        if payment is None or not payment.refund_notify or payment.status == "succeeded":
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        locale = locale_for(business=business)
        amount = format_money(locale, payment.amount_cents, payment.currency)
        notice = refund_failed_message(locale, amount, business.name)
        await self._to_client(db, payment.client_id, notice)

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
        notice = payment_failed_message(locale, amount, business.name)
        await self._to_client(db, payment.client_id, notice)

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
        await self._alert_staff(
            db, business, dispute_alert_text(locale, amount), {"type": "dispute"}
        )

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
        body = inbound_message_alert_text(
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
        notice = subscription_past_due_message(locale_for(business=business), business.name)
        await self._to_client(db, sub.client_id, notice)

    async def on_subscription_canceled(self, db: AsyncSession, subscription_id: str) -> None:
        sub = await db.get(Subscription, subscription_id)
        if sub is None:
            return
        business = await db.get(Business, sub.business_id)
        if business is None:
            return
        notice = subscription_canceled_message(locale_for(business=business), business.name)
        await self._to_client(db, sub.client_id, notice)

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
        notice = gift_card_issued_message(locale, business.name, amount, card.code)
        if "@" in card.recipient:
            brand = await business_brand(db, business)
            await self._safe(self.email.send(client_email(business, brand, card.recipient, notice)))
        else:
            await self._safe(
                self.sms.send(
                    Sms(to=card.recipient, body=notice.body, from_number=business.sms_number)
                )
            )

    async def on_booking_reminder(self, db: AsyncSession, booking_id: str) -> Outcome:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return Outcome.SKIPPED
        notice = await reminder_message(db, booking)
        if notice is None:
            return Outcome.SKIPPED
        return await self._to_client(db, booking.client_id, notice)

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
        notice = booking_confirmed_message(
            locale, business.name, when, _manage_link(business, booking)
        )
        await self._to_client(db, booking.client_id, notice)

    async def on_booking_rescheduled(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, booking_rescheduled_message)

    async def on_booking_canceled(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, booking_canceled_message)

    async def on_booking_requested(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, booking_requested_message)

    async def on_booking_released(self, db: AsyncSession, booking_id: str) -> None:
        await self._visit_notice(db, booking_id, booking_released_message)

    async def _visit_notice(
        self, db: AsyncSession, booking_id: str, build: Callable[[str, str, str], Notice]
    ) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        slot = await db.get(Slot, booking.slot_id)
        business = await db.get(Business, booking.business_id)
        if slot is None or business is None:
            return
        locale = locale_for(business=business)
        notice = build(locale, business.name, _when(locale, business, slot))
        await self._to_client(db, booking.client_id, notice)

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
            "booked": series_booked_message,
            "moved": series_moved_message,
            "canceled": series_canceled_message,
        }[kind]
        notice = build(locale, business.name, whens)
        await self._to_client(db, first.client_id, notice)

    async def on_visits_reassigned(self, db: AsyncSession, booking_ids: list[str]) -> None:
        """One message per client and new member, naming who now does the visits."""
        for client_id, staff_id, rows in await _visits_by_client(db, booking_ids):
            business = await db.get(Business, rows[0][0].business_id)
            member = await db.get(Staff, staff_id)
            if business is None or member is None:
                continue
            name = (await staff_names(db, business.id, [member.id])).get(member.id)
            locale = locale_for(business=business)
            notice = booking_reassigned_message(
                locale,
                business.name,
                [_when(locale, business, slot) for _, slot in rows],
                name or member.title or message(locale, "staff.someone"),
            )
            await self._to_client(db, client_id, notice)

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
        notice = review_requested_message(locale_for(business=business), business.name, link)
        await self._to_client(db, review.client_id, notice)

    async def on_form_sent(self, db: AsyncSession, form_response_id: str) -> Outcome:
        response = await db.get(FormResponse, form_response_id)
        if response is None:
            return Outcome.SKIPPED
        business = await db.get(Business, response.business_id)
        if business is None:
            return Outcome.SKIPPED
        link = f"{get_settings().connect_base_url}/form/{response.token}"
        notice = form_sent_message(
            locale_for(business=business),
            business.name,
            FormDefinition.model_validate(response.definition).name,
            link,
        )
        return await self._to_client(db, response.client_id, notice)

    async def on_contract_sent(self, db: AsyncSession, signature_id: str) -> None:
        signature = await db.get(Signature, signature_id)
        if signature is None:
            return
        contract = await db.get(Contract, signature.contract_id)
        business = await db.get(Business, signature.business_id)
        if contract is None or business is None:
            return
        link = f"{get_settings().connect_base_url}/contract/{signature.token}"
        notice = contract_sent_message(
            locale_for(business=business), business.name, contract.name, link
        )
        await self._to_client(db, signature.client_id, notice)

    async def _itemised(self, db: AsyncSession, locale: str, payment: Payment) -> Itemised:
        parent: tuple[LineParent, str] | None = (
            ("order", payment.order_id)
            if payment.order_id
            else ("invoice", payment.invoice_id)
            if payment.invoice_id
            else None
        )
        if parent is None:
            return Itemised((), ())
        lines = await fetch_lines(db, payment.business_id, *parent)
        document = (
            await db.get(Order, parent[1])
            if parent[0] == "order"
            else await db.get(Invoice, parent[1])
        )
        if not lines or document is None:
            return Itemised((), ())
        tax = await issued_tax(db, payment.business_id, lines, issued_at(document))
        tips = await ledger.document_tips(db, payment.business_id, parent)
        cur = payment.currency
        return receipt_detail_lines(
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
            format_money(locale, tax.total_cents + tips, cur),
            format_money(locale, tips, cur) if tips else None,
        )

    async def _to_contact(
        self,
        db: AsyncSession,
        email: str | None,
        phone: str | None,
        notice: Notice,
        *,
        business: Business,
    ) -> None:
        if email:
            brand = await business_brand(db, business)
            await self._safe(self.email.send(client_email(business, brand, email, notice)))
        number = e164(phone) if phone else None
        if number:
            await self._safe(
                self.sms.send(
                    Sms(
                        to=number,
                        body=notice.body,
                        from_number=business.sms_number if business else None,
                    )
                )
            )

    async def _to_client(
        self,
        db: AsyncSession,
        client_id: str | None,
        notice: Notice,
        *,
        channel: str | None = None,
    ) -> Outcome:
        """Email + SMS to a client (or only the channel asked for), each isolated from the other."""
        if client_id is None:
            return Outcome.SKIPPED
        client = await db.get(Client, client_id)
        if client is None:
            return Outcome.SKIPPED
        business = await db.get(Business, client.business_id)
        sent: list[bool] = []
        if client.email and channel != "sms" and business is not None:
            brand = await business_brand(db, business)
            mail = client_email(business, brand, client.email, notice, client=client)
            sent.append(await self._safe(self.email.send(mail)))
        number = e164(client.phone) if client.phone else None
        if (
            number
            and channel != "email"
            and not await texts_stopped(db, client.business_id, client.id)
        ):
            sent.append(
                await self._safe(
                    self.sms.send(
                        Sms(
                            to=number,
                            body=notice.body,
                            from_number=business.sms_number if business else None,
                        )
                    )
                )
            )
        if not sent:
            return Outcome.SKIPPED
        # one channel reaching the client counts, so a retry never repeats the channel that worked
        return Outcome.DELIVERED if any(sent) else Outcome.FAILED

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

    async def _safe(self, awaitable: Awaitable[object]) -> bool:
        try:
            await awaitable
        except Exception:
            if self.raise_errors:
                raise
            _log.exception("outreach channel send failed")
            return False
        return True


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
            existing.updated_at = clock.now()
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


def queued_notifier(db: AsyncSession, scope: str, business_id: str) -> Notifier:
    from clientbridge.services.deliveries import DeliveryQueue, QueuedEmail, QueuedPush, QueuedSms

    queue = DeliveryQueue(db, scope, business_id)
    return Notifier(QueuedEmail(queue), QueuedSms(queue), QueuedPush(queue), raise_errors=True)
