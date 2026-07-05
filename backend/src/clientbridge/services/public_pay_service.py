from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.billing import Invoice
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.schemas.payments import InteracRequest, PublicCardIntent, PublicInvoice
from clientbridge.services.payment_service import (
    assert_payable,
    open_card_payment,
    open_interac_payment,
)
from clientbridge.services.public_common import business_or_404, public_brand, resolve_by_token


class PublicPayService:
    """The unauthenticated pay-by-link surface (#4). The opaque `pay_token` is the only credential —
    it resolves one invoice, so no principal / tenant scope is involved."""

    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def _resolve(self, token: str) -> tuple[Invoice, Business]:
        msg = "payment link not found"
        invoice = await resolve_by_token(self.db, Invoice, Invoice.pay_token == token, msg)
        return invoice, await business_or_404(self.db, invoice.business_id, msg)

    async def invoice(self, token: str) -> PublicInvoice:
        invoice, business = await self._resolve(token)
        return PublicInvoice(
            number=invoice.number,
            business_name=business.name,
            brand=public_brand(business),
            currency=invoice.currency,
            total_cents=invoice.total_cents,
            balance_cents=invoice.balance_cents,
            status=invoice.status,
            accepts_card=business.stripe_charges_enabled,
            interac_email=business.billing_email,
        )

    async def pay_card(self, token: str) -> PublicCardIntent:
        invoice, business = await self._resolve(token)
        amount = assert_payable(invoice)
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("this business can't take card payments yet")
        client = await self.db.get(Client, invoice.client_id)
        if client is None:
            raise NotFound("client not found")
        # open_card_payment is retry-safe (Stripe idempotency key + provider_ref dedup) — a customer
        # double-submit reuses the one intent rather than minting another.
        _, client_secret = await open_card_payment(
            self.db,
            self.gateway,
            account_id=business.stripe_account_id,
            business_id=business.id,
            invoice=invoice,
            client=client,
            amount=amount,
            fee_bps=get_settings().platform_fee_bps,
        )
        await self.db.commit()
        return PublicCardIntent(
            client_secret=client_secret, stripe_account_id=business.stripe_account_id
        )

    async def pay_interac(self, token: str) -> InteracRequest:
        invoice, business = await self._resolve(token)
        amount = assert_payable(invoice)
        payment = await open_interac_payment(
            self.db, business_id=invoice.business_id, invoice=invoice, amount=amount
        )
        await self.db.commit()
        return InteracRequest(
            payment_id=payment.id,
            reference_code=payment.reference_code or "",
            send_to=business.billing_email,
            amount_cents=amount,
        )
