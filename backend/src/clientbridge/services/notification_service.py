import logging
from collections.abc import Awaitable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.integrations.notifications import (
    Email,
    EmailSender,
    Push,
    PushSender,
    Sms,
    SmsSender,
)
from clientbridge.models.billing import Estimate, Invoice
from clientbridge.models.catalog import GiftCard, Subscription
from clientbridge.models.crm import Client
from clientbridge.models.documents import Contract, Form, FormResponse, Signature
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.platform import DeviceToken
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking, Session

_log = logging.getLogger(__name__)


def _money(cents: int, currency: str) -> str:
    return f"${cents // 100}.{cents % 100:02d} {currency.upper()}"


def _receipt(locale: str, business_name: str, amount: str) -> tuple[str, str, str]:
    """(email subject, email+sms body, push body) for a payment receipt — bilingual EN/FR."""
    if locale == "fr":
        return (
            f"Reçu de {business_name}",
            f"Merci! Votre paiement de {amount} à {business_name} a été reçu.",
            f"Paiement reçu : {amount}",
        )
    return (
        f"Receipt from {business_name}",
        f"Thank you! Your payment of {amount} to {business_name} was received.",
        f"Payment received: {amount}",
    )


def _invoice_sent(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> tuple[str, str]:
    if locale == "fr":
        body = f"Facture nº{number} de {amount} de la part de {business_name}"
        if link:
            body += f" — payez à {link}"
        return f"Facture nº{number} de {business_name}", body
    body = f"Invoice #{number} for {amount} from {business_name}"
    if link:
        body += f" — pay at {link}"
    return f"Invoice #{number} from {business_name}", body


def _invoice_overdue(
    locale: str, number: int | None, amount: str, business_name: str, link: str
) -> tuple[str, str]:
    if locale == "fr":
        body = f"La facture nº{number} de {amount} de la part de {business_name} est en retard"
        if link:
            body += f" — payez à {link}"
        return f"Facture nº{number} en retard — {business_name}", body
    body = f"Invoice #{number} for {amount} from {business_name} is overdue"
    if link:
        body += f" — pay at {link}"
    return f"Invoice #{number} overdue — {business_name}", body


def _estimate_sent(
    locale: str, number: int | None, amount: str, business_name: str
) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Devis nº{number} de {business_name}",
            f"Devis nº{number} de {amount} de la part de {business_name}",
        )
    return (
        f"Estimate #{number} from {business_name}",
        f"Estimate #{number} for {amount} from {business_name}",
    )


def _estimate_accepted(locale: str, number: int | None) -> tuple[str, str]:
    if locale == "fr":
        return (f"Devis nº{number} accepté", f"Le devis nº{number} a été accepté.")
    return (f"Estimate #{number} accepted", f"Estimate #{number} was accepted.")


def _estimate_declined(locale: str, number: int | None) -> tuple[str, str]:
    if locale == "fr":
        return (f"Devis nº{number} refusé", f"Le devis nº{number} a été refusé.")
    return (f"Estimate #{number} declined", f"Estimate #{number} was declined.")


def _interac_requested(locale: str, amount: str, send_to: str, reference: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            "Demande de virement Interac",
            f"Envoyez un virement Interac de {amount} à {send_to} — référence {reference}",
        )
    return (
        "Interac e-Transfer requested",
        f"Send an Interac e-Transfer of {amount} to {send_to} — use reference {reference}",
    )


def _payment_failed(locale: str, amount: str, business_name: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Paiement échoué — {business_name}",
            f"Votre paiement de {amount} à {business_name} a échoué. Veuillez réessayer.",
        )
    return (
        f"Payment failed — {business_name}",
        f"Your payment of {amount} to {business_name} failed. Please try again.",
    )


def _refund(locale: str, amount: str, business_name: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Remboursement de {business_name}",
            f"Un remboursement de {amount} de la part de {business_name} a été émis.",
        )
    return (
        f"Refund from {business_name}",
        f"A refund of {amount} from {business_name} was issued.",
    )


def _subscription_past_due(locale: str, business_name: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Paiement en retard — {business_name}",
            f"Le paiement de votre abonnement à {business_name} a échoué. "
            "Veuillez mettre à jour votre mode de paiement.",
        )
    return (
        f"Payment past due — {business_name}",
        f"Your subscription payment to {business_name} failed. Please update your payment method.",
    )


def _subscription_canceled(locale: str, business_name: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Abonnement annulé — {business_name}",
            f"Votre abonnement à {business_name} a été annulé.",
        )
    return (
        f"Subscription canceled — {business_name}",
        f"Your subscription to {business_name} was canceled.",
    )


def _gift_card_issued(locale: str, business_name: str, amount: str, code: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Vous avez reçu une carte-cadeau de {business_name}",
            f"Vous avez reçu une carte-cadeau de {amount} de {business_name}. Code : {code}",
        )
    return (
        f"You've received a gift card from {business_name}",
        f"You've received a {amount} gift card from {business_name}. Code: {code}",
    )


def _booking_reminder(locale: str, business_name: str, when: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Rappel de rendez-vous — {business_name}",
            f"Rappel : vous avez un rendez-vous avec {business_name} le {when}.",
        )
    return (
        f"Appointment reminder — {business_name}",
        f"Reminder: you have an appointment with {business_name} on {when}.",
    )


def _booking_confirmed(locale: str, business_name: str, when: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Réservation confirmée — {business_name}",
            f"Vous avez un rendez-vous avec {business_name} le {when}.",
        )
    return (
        f"Booking confirmed — {business_name}",
        f"You're booked with {business_name} on {when}.",
    )


def _booking_rescheduled(locale: str, business_name: str, when: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Rendez-vous reporté — {business_name}",
            f"Votre rendez-vous avec {business_name} a été déplacé au {when}.",
        )
    return (
        f"Appointment rescheduled — {business_name}",
        f"Your appointment with {business_name} was moved to {when}.",
    )


def _booking_canceled(locale: str, business_name: str, when: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Rendez-vous annulé — {business_name}",
            f"Votre rendez-vous avec {business_name} le {when} a été annulé.",
        )
    return (
        f"Appointment canceled — {business_name}",
        f"Your appointment with {business_name} on {when} was canceled.",
    )


def _form_sent(locale: str, business_name: str, form_name: str, link: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"{business_name} : veuillez remplir « {form_name} »",
            f"{business_name} vous demande de remplir le formulaire « {form_name} » : {link}",
        )
    return (
        f'{business_name}: please complete "{form_name}"',
        f'{business_name} has asked you to complete the form "{form_name}": {link}',
    )


def _contract_sent(
    locale: str, business_name: str, contract_name: str, link: str
) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"{business_name} : veuillez signer « {contract_name} »",
            f"{business_name} vous demande de signer le contrat « {contract_name} » : {link}",
        )
    return (
        f'{business_name}: please sign "{contract_name}"',
        f'{business_name} has asked you to sign the contract "{contract_name}": {link}',
    )


def _review_requested(locale: str, business_name: str, link: str) -> tuple[str, str]:
    if locale == "fr":
        return (
            f"Comment s'est passée votre visite chez {business_name}?",
            f"Merci d'avoir choisi {business_name}! Laissez un avis : {link}",
        )
    return (
        f"How was your visit to {business_name}?",
        f"Thanks for choosing {business_name}! Leave a review: {link}",
    )


class Notifier:
    """Unified outreach across channels: client messages (email + SMS) and staff alerts (push) flow
    through here, so every event reaches every channel from one place. Channel sends are isolated
    (one failure never blocks the others or the caller)."""

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
        amount = _money(payment.amount_cents, payment.currency)
        subject, body, push_body = _receipt(business.locale, business.name, amount)
        await self._to_client(db, payment.client_id, subject, body)
        await self._alert_staff(
            db, business, push_body, {"type": "payment", "payment_id": payment_id}
        )

    async def on_invoice_sent(self, db: AsyncSession, invoice_id: str) -> None:
        invoice = await db.get(Invoice, invoice_id)
        if invoice is None:
            return
        business = await db.get(Business, invoice.business_id)
        if business is None:
            return
        amount = _money(invoice.total_cents, invoice.currency)
        link = f"{get_settings().web_base_url}/pay/{invoice.pay_token}" if invoice.pay_token else ""
        subject, body = _invoice_sent(business.locale, invoice.number, amount, business.name, link)
        await self._to_client(db, invoice.client_id, subject, body)

    async def on_invoice_overdue(self, db: AsyncSession, invoice_id: str) -> None:
        invoice = await db.get(Invoice, invoice_id)
        if invoice is None:
            return
        business = await db.get(Business, invoice.business_id)
        if business is None:
            return
        amount = _money(invoice.balance_cents, invoice.currency)
        link = f"{get_settings().web_base_url}/pay/{invoice.pay_token}" if invoice.pay_token else ""
        subject, body = _invoice_overdue(
            business.locale, invoice.number, amount, business.name, link
        )
        await self._to_client(db, invoice.client_id, subject, body)

    async def on_estimate_sent(self, db: AsyncSession, estimate_id: str) -> None:
        estimate = await db.get(Estimate, estimate_id)
        if estimate is None:
            return
        business = await db.get(Business, estimate.business_id)
        if business is None:
            return
        amount = _money(estimate.total_cents, "CAD")
        subject, body = _estimate_sent(business.locale, estimate.number, amount, business.name)
        await self._to_client(db, estimate.client_id, subject, body)

    async def on_estimate_accepted(self, db: AsyncSession, estimate_id: str) -> None:
        """Alert the provider (their billing email) that a client accepted an estimate."""
        estimate = await db.get(Estimate, estimate_id)
        if estimate is None:
            return
        business = await db.get(Business, estimate.business_id)
        if business is None or not business.billing_email:
            return
        subject, body = _estimate_accepted(business.locale, estimate.number)
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
        subject, body = _estimate_declined(business.locale, estimate.number)
        await self._safe(
            self.email.send(Email(to=business.billing_email, subject=subject, body=body))
        )

    async def on_interac_requested(self, db: AsyncSession, payment_id: str) -> None:
        payment = await db.get(Payment, payment_id)
        if payment is None:
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        amount = _money(payment.amount_cents, payment.currency)
        subject, body = _interac_requested(
            business.locale, amount, business.billing_email or "", payment.reference_code or ""
        )
        await self._to_client(db, payment.client_id, subject, body)

    async def on_refund(self, db: AsyncSession, refund_payment_id: str) -> None:
        payment = await db.get(Payment, refund_payment_id)
        if payment is None:
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        amount = _money(payment.amount_cents, payment.currency)
        subject, body = _refund(business.locale, amount, business.name)
        await self._to_client(db, payment.client_id, subject, body)

    async def on_payment_failed(self, db: AsyncSession, payment_id: str) -> None:
        """Tell the client a one-off charge failed so they can retry (subscription dunning is a
        separate event)."""
        payment = await db.get(Payment, payment_id)
        if payment is None:
            return
        business = await db.get(Business, payment.business_id)
        if business is None:
            return
        amount = _money(payment.amount_cents, payment.currency)
        subject, body = _payment_failed(business.locale, amount, business.name)
        await self._to_client(db, payment.client_id, subject, body)

    async def on_subscription_past_due(self, db: AsyncSession, subscription_id: str) -> None:
        sub = await db.get(Subscription, subscription_id)
        if sub is None:
            return
        business = await db.get(Business, sub.business_id)
        if business is None:
            return
        subject, body = _subscription_past_due(business.locale, business.name)
        await self._to_client(db, sub.client_id, subject, body)

    async def on_subscription_canceled(self, db: AsyncSession, subscription_id: str) -> None:
        sub = await db.get(Subscription, subscription_id)
        if sub is None:
            return
        business = await db.get(Business, sub.business_id)
        if business is None:
            return
        subject, body = _subscription_canceled(business.locale, business.name)
        await self._to_client(db, sub.client_id, subject, body)

    async def on_gift_card_issued(self, db: AsyncSession, gift_card_id: str) -> None:
        """Send the code to the gift card's recipient once the purchase settles. The recipient is a
        raw email/phone (not a known client), so this is a direct send, not CASL-gated."""
        card = await db.get(GiftCard, gift_card_id)
        if card is None or not card.recipient:
            return
        business = await db.get(Business, card.business_id)
        if business is None:
            return
        amount = _money(card.initial_cents, "CAD")
        subject, body = _gift_card_issued(business.locale, business.name, amount, card.code)
        if "@" in card.recipient:
            await self._safe(self.email.send(Email(to=card.recipient, subject=subject, body=body)))
        else:
            await self._safe(self.sms.send(Sms(to=card.recipient, body=body)))

    async def on_booking_reminder(self, db: AsyncSession, booking_id: str) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        session = await db.get(Session, booking.session_id)
        business = await db.get(Business, booking.business_id)
        if session is None or business is None:
            return
        local = session.starts_at.astimezone(ZoneInfo(business.timezone))
        subject, body = _booking_reminder(
            business.locale, business.name, f"{local:%Y-%m-%d at %H:%M}"
        )
        await self._to_client(db, booking.client_id, subject, body)

    async def on_booking_confirmed(self, db: AsyncSession, booking_id: str) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        session = await db.get(Session, booking.session_id)
        business = await db.get(Business, booking.business_id)
        if session is None or business is None:
            return
        local = session.starts_at.astimezone(ZoneInfo(business.timezone))
        subject, body = _booking_confirmed(
            business.locale, business.name, f"{local:%Y-%m-%d at %H:%M}"
        )
        await self._to_client(db, booking.client_id, subject, body)

    async def on_booking_rescheduled(self, db: AsyncSession, booking_id: str) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        session = await db.get(Session, booking.session_id)
        business = await db.get(Business, booking.business_id)
        if session is None or business is None:
            return
        local = session.starts_at.astimezone(ZoneInfo(business.timezone))
        subject, body = _booking_rescheduled(
            business.locale, business.name, f"{local:%Y-%m-%d at %H:%M}"
        )
        await self._to_client(db, booking.client_id, subject, body)

    async def on_booking_canceled(self, db: AsyncSession, booking_id: str) -> None:
        booking = await db.get(Booking, booking_id)
        if booking is None:
            return
        session = await db.get(Session, booking.session_id)
        business = await db.get(Business, booking.business_id)
        if session is None or business is None:
            return
        local = session.starts_at.astimezone(ZoneInfo(business.timezone))
        subject, body = _booking_canceled(
            business.locale, business.name, f"{local:%Y-%m-%d at %H:%M}"
        )
        await self._to_client(db, booking.client_id, subject, body)

    async def on_review_requested(self, db: AsyncSession, review_request_id: str) -> None:
        request = await db.get(ReviewRequest, review_request_id)
        if request is None:
            return
        business = await db.get(Business, request.business_id)
        if business is None:
            return
        link = f"{get_settings().web_base_url}/review/{request.token}"
        subject, body = _review_requested(business.locale, business.name, link)
        await self._to_client(db, request.client_id, subject, body)

    async def on_form_sent(self, db: AsyncSession, form_response_id: str) -> None:
        response = await db.get(FormResponse, form_response_id)
        if response is None:
            return
        form = await db.get(Form, response.form_id)
        business = await db.get(Business, response.business_id)
        if form is None or business is None:
            return
        link = f"{get_settings().web_base_url}/form/{response.token}"
        subject, body = _form_sent(business.locale, business.name, form.name, link)
        await self._to_client(db, response.client_id, subject, body)

    async def on_contract_sent(self, db: AsyncSession, signature_id: str) -> None:
        signature = await db.get(Signature, signature_id)
        if signature is None:
            return
        contract = await db.get(Contract, signature.contract_id)
        business = await db.get(Business, signature.business_id)
        if contract is None or business is None:
            return
        link = f"{get_settings().web_base_url}/contract/{signature.token}"
        subject, body = _contract_sent(business.locale, business.name, contract.name, link)
        await self._to_client(db, signature.client_id, subject, body)

    async def _to_client(
        self, db: AsyncSession, client_id: str | None, subject: str, body: str
    ) -> None:
        """Email + SMS to a client, each isolated from the other."""
        if client_id is None:
            return
        client = await db.get(Client, client_id)
        if client is None:
            return
        if client.email:
            await self._safe(self.email.send(Email(to=client.email, subject=subject, body=body)))
        if client.phone:
            await self._safe(self.sms.send(Sms(to=client.phone, body=body)))

    async def _alert_staff(
        self, db: AsyncSession, business: Business, body: str, data: dict[str, str]
    ) -> None:
        tokens = (
            (
                await db.execute(
                    select(DeviceToken.token).where(DeviceToken.business_id == business.id)
                )
            )
            .scalars()
            .all()
        )
        if tokens:
            await self._safe(
                self.push.send(Push(tokens=list(tokens), title=business.name, body=body, data=data))
            )

    async def _safe(self, awaitable: Awaitable[None]) -> None:
        try:
            await awaitable
        except Exception:
            _log.exception("outreach channel send failed")
