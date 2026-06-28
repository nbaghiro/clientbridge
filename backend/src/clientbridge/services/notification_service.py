from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.integrations.email import Email, EmailSender
from clientbridge.integrations.push import Push, PushSender
from clientbridge.integrations.sms import Sms, SmsSender
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment
from clientbridge.models.platform import DeviceToken


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


class Notifier:
    """Unified outreach across channels: client receipts (email + SMS) and staff alerts (push)
    flow through here, so every event reaches every channel from one place."""

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
        await self._receipt_to_client(db, payment.client_id, subject, body)
        await self._alert_staff(
            db, business, push_body, {"type": "payment", "payment_id": payment_id}
        )

    async def _receipt_to_client(
        self, db: AsyncSession, client_id: str | None, subject: str, body: str
    ) -> None:
        if client_id is None:
            return
        client = await db.get(Client, client_id)
        if client is None:
            return
        if client.email:
            await self.email.send(Email(to=client.email, subject=subject, body=body))
        if client.phone:
            await self.sms.send(Sms(to=client.phone, body=body))

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
            await self.push.send(
                Push(tokens=list(tokens), title=business.name, body=body, data=data)
            )
