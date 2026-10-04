import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_update
from clientbridge.integrations.payments import (
    ChargeFees,
    GatewayEvent,
    PaymentGateway,
    account_status_from,
    period_timestamp,
)
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.catalog import GiftCard, Item, Package, Subscription
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.models.payments import Payment, PaymentMethod
from clientbridge.models.platform import Webhook
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.payments import (
    ConnectStatus,
    DetachResult,
    InteracRequest,
    OnboardingLink,
    PayIntentOut,
    PaymentMethodOut,
    RefundOut,
    SetupIntentOut,
)
from clientbridge.services import ledger_service as ledger
from clientbridge.services.business_service import apply_account_status, kyc_status
from clientbridge.services.earning_service import (
    ensure_earnings,
    ensure_order_earning,
    reverse_earnings,
    reverse_order_earning,
)
from clientbridge.services.lines import apply_totals, tax_for_amount, tax_for_lines
from clientbridge.services.stock_service import sync_parent_stock


@dataclass(frozen=True)
class WebhookOutcome:
    """A post-commit client notification the webhook route fires (mirrors the receipt path)."""

    notify: str  # payment | payment_failed | refund | payment_disputed | gift_card_issued |
    # subscription_{past_due,canceled}
    target_id: str


@dataclass(frozen=True)
class _Settled:
    payment_id: str
    gift_card_id: str | None  # set when the settled charge activated a pending gift card


class PaymentService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def start_onboarding(self, idempotency_key: str | None) -> OnboardingLink:
        self._assert_admin()
        business = await self._business()
        settings = get_settings()

        async def run(cmd: Command) -> OnboardingLink:
            account_id = business.stripe_account_id
            if account_id is None:
                account_id = await self.gateway.create_connected_account(
                    business_name=business.name,
                    email=business.billing_email,
                    url=f"{settings.connect_base_url}/book/{business.slug}",
                )
                business.stripe_account_id = account_id
                await self.db.flush()
                cmd.record("connect.account_created", entity_type="business", entity_id=business.id)
                # Seed the KYC state from Stripe right away (the webhook keeps it in sync after).
                apply_account_status(business, await self.gateway.get_account(account_id))
            url = await self.gateway.create_account_link(
                account_id,
                refresh_url=f"{settings.web_base_url}/setup/getting-paid?refresh=1",
                return_url=f"{settings.web_base_url}/setup/getting-paid?done=1",
            )
            cmd.record("connect.onboard", entity_type="business", entity_id=business.id)
            return OnboardingLink(url=url, charges_enabled=business.stripe_charges_enabled)

        return await run_command(
            self.db,
            self.principal,
            action="connect.onboard",
            run=run,
            response_model=OnboardingLink,
            idempotency_key=idempotency_key,
        )

    async def status(self) -> ConnectStatus:
        self._assert_admin()
        business = await self._business()
        req = business.stripe_requirements

        def _due(key: str) -> list[str]:
            value = req.get(key)
            return [str(x) for x in value] if isinstance(value, list) else []

        reason = req.get("disabled_reason")
        return ConnectStatus(
            connected=business.stripe_account_id is not None,
            charges_enabled=business.stripe_charges_enabled,
            payouts_enabled=business.stripe_payouts_enabled,
            details_submitted=business.stripe_details_submitted,
            kyc_status=kyc_status(business),
            disabled_reason=str(reason) if isinstance(reason, str) else None,
            currently_due=_due("currently_due"),
            past_due=_due("past_due"),
            pending_verification=_due("pending_verification"),
        )

    async def pay_invoice(
        self,
        invoice_id: str,
        amount_cents: int | None,
        idempotency_key: str | None,
        payment_method_id: str | None = None,
        deposit: bool = False,
    ) -> PayIntentOut:
        self._assert_admin()
        business = await self._business()
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before taking payments")
        account_id = business.stripe_account_id
        invoice = await self._invoice(invoice_id)
        balance = await assert_payable(self.db, invoice)
        amount = balance if amount_cents is None else amount_cents
        if amount <= 0 or amount > balance:
            raise Conflict("invalid payment amount")
        client = await self._client(invoice.client_id)
        fee_bps = get_settings().platform_fee_bps
        pm_ref = await self._saved_method_ref(payment_method_id, invoice.client_id)

        async def run(cmd: Command) -> PayIntentOut:
            payment, client_secret = await open_card_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                invoice=invoice,
                client=client,
                amount=amount,
                fee_bps=fee_bps,
                payment_method=pm_ref,
                kind="deposit" if deposit else "payment",
                idempotency_key=idempotency_key,
            )
            cmd.record("payment.intent", entity_type="payment", entity_id=payment.id)
            return PayIntentOut(
                payment_id=payment.id, client_secret=client_secret, amount_cents=amount
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment.intent",
            run=run,
            response_model=PayIntentOut,
            idempotency_key=idempotency_key,
        )

    async def start_card_setup(
        self, client_id: str, idempotency_key: str | None = None
    ) -> SetupIntentOut:
        """A SetupIntent to save a client's card for later off-session charges (no charge now)."""
        self._assert_admin()
        business = await self._business()
        if business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before saving cards")
        account_id = business.stripe_account_id
        client = await self._client(client_id)

        async def run(cmd: Command) -> SetupIntentOut:
            customer_id = await ensure_customer(self.db, self.gateway, account_id, client)
            intent = await self.gateway.create_setup_intent(account_id, customer_id=customer_id)
            cmd.record("payment.setup_intent", entity_type="client", entity_id=client.id)
            return SetupIntentOut(client_secret=intent.client_secret, stripe_account_id=account_id)

        return await run_command(
            self.db,
            self.principal,
            action="payment.setup_intent",
            run=run,
            response_model=SetupIntentOut,
            idempotency_key=idempotency_key,
        )

    async def start_pad_setup(
        self, client_id: str, idempotency_key: str | None = None
    ) -> SetupIntentOut:
        """A SetupIntent to save a client's ACSS pre-authorized-debit mandate (no charge now)."""
        self._assert_admin()
        business = await self._business()
        if business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before saving bank accounts")
        account_id = business.stripe_account_id
        client = await self._client(client_id)

        async def run(cmd: Command) -> SetupIntentOut:
            customer_id = await ensure_customer(self.db, self.gateway, account_id, client)
            intent = await self.gateway.create_pad_setup_intent(account_id, customer_id=customer_id)
            cmd.record("payment.pad_setup_intent", entity_type="client", entity_id=client.id)
            return SetupIntentOut(client_secret=intent.client_secret, stripe_account_id=account_id)

        return await run_command(
            self.db,
            self.principal,
            action="payment.pad_setup_intent",
            run=run,
            response_model=SetupIntentOut,
            idempotency_key=idempotency_key,
        )

    async def _saved_method_ref(self, payment_method_id: str | None, client_id: str) -> str | None:
        return await resolve_saved_method_ref(self.db, self.biz, payment_method_id, client_id)

    async def detach_card(self, payment_method_id: str) -> DetachResult:
        """Detach a saved card at the provider, then remove its row (owner/admin only)."""
        self._assert_admin()
        business = await self._business()
        pm = await self._payment_method(payment_method_id)
        account_id = business.stripe_account_id
        provider_ref = pm.provider_ref

        async def run(cmd: Command) -> DetachResult:
            if account_id is not None and provider_ref is not None:
                await self.gateway.detach_payment_method(account_id, payment_method_id=provider_ref)
            await self.db.delete(pm)
            await self.db.flush()
            cmd.record(
                "payment_method.detach", entity_type="payment_method", entity_id=payment_method_id
            )
            return DetachResult(detached=True)

        return await run_command(
            self.db,
            self.principal,
            action="payment_method.detach",
            run=run,
            response_model=DetachResult,
        )

    async def set_default_card(self, payment_method_id: str) -> PaymentMethodOut:
        """Make one saved card the client's default, clearing the flag on its siblings."""
        self._assert_admin()
        pm = await self._payment_method(payment_method_id)

        async def run(cmd: Command) -> PaymentMethodOut:
            await self.db.execute(
                scoped_update(PaymentMethod, self.biz)
                .where(PaymentMethod.client_id == pm.client_id, PaymentMethod.id != pm.id)
                .values(preferred=False)
            )
            pm.preferred = True
            await self.db.flush()
            cmd.record("payment_method.set_default", entity_type="payment_method", entity_id=pm.id)
            return PaymentMethodOut(
                id=pm.id,
                client_id=pm.client_id,
                brand=pm.brand,
                last4=pm.last4,
                preferred=pm.preferred,
                status=pm.status,
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment_method.set_default",
            run=run,
            response_model=PaymentMethodOut,
        )

    async def refund_payment(
        self, payment_id: str, amount_cents: int | None = None, idempotency_key: str | None = None
    ) -> RefundOut:
        """Refund all or part of what's left on a payment (several partial refunds are fine).
        Entitlement purchases and forfeited deposits refund in full only."""
        self._assert_admin()
        business = await self._business()
        payment = await self._payment(payment_id)
        if payment.kind == "refund":
            raise Conflict("a refund can't be refunded")
        if payment.status != "succeeded":
            raise Conflict("only a succeeded payment can be refunded")
        if business.stripe_account_id is None or payment.provider_ref is None:
            raise Conflict("payment has no connected charge to refund")
        account_id = business.stripe_account_id
        provider_ref = payment.provider_ref

        async def run(cmd: Command) -> RefundOut:
            await self.db.execute(
                scoped(Payment, self.biz).where(Payment.id == payment.id).with_for_update()
            )
            whole_only = await self._whole_refund_only(payment)
            refunded = await _refunded_cents(self.db, payment)
            left = payment.amount_cents - refunded
            amount = left if amount_cents is None else amount_cents
            if left <= 0:
                raise Conflict("this payment was already refunded")
            if amount <= 0 or amount > left:
                raise Conflict("invalid refund amount")
            if whole_only and (refunded > 0 or amount != payment.amount_cents):
                raise Conflict(whole_only)
            result = await self.gateway.refund(
                account_id,
                payment_intent_id=provider_ref,
                amount_cents=amount,
                idempotency_key=f"refund_{payment.id}_{refunded}",
            )
            refund = Payment(
                id=new_id("payment"),
                business_id=self.biz,
                client_id=payment.client_id,
                kind="refund",
                parent_payment_id=payment.id,
                invoice_id=payment.invoice_id,
                order_id=payment.order_id,
                booking_id=payment.booking_id,
                amount_cents=amount,
                currency=payment.currency,
                method=payment.method,
                provider="stripe",
                provider_ref=result.id,
                status="succeeded",
                paid_at=datetime.now(UTC),
            )
            self.db.add(refund)
            await self.db.flush()
            await _apply_refund(self.db, refund, payment)
            cmd.record("payment.refund", entity_type="payment", entity_id=refund.id)
            return RefundOut(refund_id=refund.id, status=result.status)

        return await run_command(
            self.db,
            self.principal,
            action="payment.refund",
            run=run,
            response_model=RefundOut,
            idempotency_key=idempotency_key,
        )

    async def _whole_refund_only(self, payment: Payment) -> str | None:
        """Why this payment can only be refunded in full (None when partial refunds are fine).
        A gift card or package must also be untouched, so the refund can't lose delivered value."""
        card = (
            await self.db.execute(
                scoped(GiftCard, self.biz)
                .where(GiftCard.payment_id == payment.id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if card is not None:
            if card.status == "expired":
                raise Conflict("can't refund an expired gift card")
            if await ledger.gift_card_balance(self.db, card) < card.initial_cents:
                raise Conflict("can't refund a gift card that has already been partly redeemed")
            return "a gift card purchase is refunded in full"
        pkg = (
            await self.db.execute(
                scoped(Package, self.biz).where(Package.payment_id == payment.id).with_for_update()
            )
        ).scalar_one_or_none()
        if pkg is not None:
            if pkg.status == "expired":
                raise Conflict("can't refund an expired package")
            if await ledger.sessions_used(self.db, pkg) > 0:
                raise Conflict("can't refund a package with sessions already used")
            return "a package purchase is refunded in full"
        if payment.booking_id is not None and payment.kind == "deposit":
            booking = await self.db.get(Booking, payment.booking_id)
            if booking is not None and booking.deposit_status == "forfeited":
                return "a forfeited deposit is refunded in full"
            if booking is not None and await ledger.applied_invoices(self.db, booking):
                return "a deposit applied to an invoice is refunded in full"
        return None

    async def request_interac(
        self,
        invoice_id: str,
        amount_cents: int | None,
        idempotency_key: str | None,
        deposit: bool = False,
    ) -> InteracRequest:
        self._assert_admin()
        business = await self._business()
        invoice = await self._invoice(invoice_id)
        balance = await assert_payable(self.db, invoice)
        amount = balance if amount_cents is None else amount_cents
        if amount <= 0 or amount > balance:
            raise Conflict("invalid payment amount")
        await self._client(invoice.client_id)

        async def run(cmd: Command) -> InteracRequest:
            payment = await open_interac_payment(
                self.db,
                business_id=self.biz,
                invoice=invoice,
                amount=amount,
                kind="deposit" if deposit else "payment",
            )
            cmd.record("payment.interac_request", entity_type="payment", entity_id=payment.id)
            return InteracRequest(
                payment_id=payment.id,
                reference_code=payment.reference_code or "",
                send_to=business.billing_email,
                amount_cents=amount,
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment.interac_request",
            run=run,
            response_model=InteracRequest,
            idempotency_key=idempotency_key,
        )

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage payments"
        )

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
        return row

    async def _invoice(self, invoice_id: str) -> Invoice:
        row = (
            await self.db.execute(scoped(Invoice, self.biz).where(Invoice.id == invoice_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("invoice not found")
        return row

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row

    async def _payment(self, payment_id: str) -> Payment:
        row = (
            await self.db.execute(scoped(Payment, self.biz).where(Payment.id == payment_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("payment not found")
        return row

    async def _payment_method(self, payment_method_id: str) -> PaymentMethod:
        row = (
            await self.db.execute(
                scoped(PaymentMethod, self.biz).where(PaymentMethod.id == payment_method_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("saved card not found")
        return row


async def default_method_ref(db: AsyncSession, business_id: str, client_id: str) -> str | None:
    """The client's default active saved-card provider ref, or None if they have none on file."""
    pm = (
        await db.execute(
            scoped(PaymentMethod, business_id)
            .where(
                PaymentMethod.client_id == client_id,
                PaymentMethod.preferred.is_(True),
                PaymentMethod.status == "active",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return pm.provider_ref if pm is not None else None


async def resolve_saved_method_ref(
    db: AsyncSession, business_id: str, payment_method_id: str | None, client_id: str
) -> str | None:
    """Resolve a saved-card selection to its provider ref: None (interactive), the `"default"`
    sentinel (the client's default card), or a specific saved card id. Raises if not on file."""
    if payment_method_id is None:
        return None
    if payment_method_id == "default":
        ref = await default_method_ref(db, business_id, client_id)
        if ref is None:
            raise NotFound("no default card on file")
        return ref
    pm = (
        await db.execute(
            scoped(PaymentMethod, business_id).where(
                PaymentMethod.id == payment_method_id, PaymentMethod.client_id == client_id
            )
        )
    ).scalar_one_or_none()
    if pm is None or pm.provider_ref is None:
        raise NotFound("saved card not found")
    return pm.provider_ref


async def assert_payable(db: AsyncSession, invoice: Invoice) -> int:
    """Validate an invoice can take a payment; return the outstanding balance. Shared by the authed
    command path and the public pay-link surface so the rule can't drift between them."""
    if invoice.status == "draft":
        raise Conflict("send the invoice before taking a payment")
    status, _ = await ledger.invoice_state(db, invoice)
    if status in ("paid", "void", "refunded"):
        raise Conflict(f"a {status} invoice can't be charged")
    balance = await ledger.invoice_balance(db, invoice)
    if balance <= 0:
        raise Conflict("nothing left to pay on this invoice")
    return balance


async def _assert_room(db: AsyncSession, invoice: Invoice, amount: int) -> None:
    """Reject a new charge that, with payments already pending on this invoice, would overpay it —
    so a customer paying by two methods/tabs can't drive the balance negative. Locks the invoice row
    so concurrent partial charges see each other's pending rows instead of both reading zero."""
    await db.execute(select(Invoice.id).where(Invoice.id == invoice.id).with_for_update())
    pending = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
                Payment.invoice_id == invoice.id,
                Payment.status == "pending",
                Payment.kind.in_(("payment", "deposit")),
            )
        )
    ).scalar_one()
    if amount > await ledger.invoice_balance(db, invoice) - int(pending):
        raise Conflict("this invoice already has a payment in progress")


async def _assert_order_room(db: AsyncSession, order: Order, amount: int) -> None:
    """Reject a checkout when a payment is already pending on the order — so editing the total and
    re-checking-out can't open a second intent. Locks the order row so concurrent checkouts see each
    other's pending rows."""
    await db.execute(select(Order.id).where(Order.id == order.id).with_for_update())
    pending = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
                Payment.order_id == order.id,
                Payment.status == "pending",
                Payment.kind.in_(("payment", "deposit")),
            )
        )
    ).scalar_one()
    if amount > order.total_cents - int(pending):
        raise Conflict("this order already has a checkout in progress")


async def ensure_customer(
    db: AsyncSession, gateway: PaymentGateway, account_id: str, client: Client
) -> str:
    """The client's Stripe Customer id, created once. Locks the client row so two concurrent
    first-charges don't both create a Customer (populate_existing re-reads under the lock)."""
    if client.stripe_customer_id is not None:
        return client.stripe_customer_id
    locked = (
        await db.execute(
            select(Client)
            .where(Client.id == client.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    if locked.stripe_customer_id is None:
        locked.stripe_customer_id = await gateway.create_customer(
            account_id, name=locked.name, email=locked.email
        )
        await db.flush()
    assert locked.stripe_customer_id is not None
    return locked.stripe_customer_id


async def ensure_subscription_price(
    db: AsyncSession,
    gateway: PaymentGateway,
    account_id: str,
    item: Item,
    *,
    interval_count: int,
    frequency: str,
) -> str:
    """The item's Stripe recurring Price, created (and cached on the item) on first use. The Price
    is the tax-inclusive total, since a recurring charge must collect GST/PST."""
    if item.stripe_price_id is not None:
        return item.stripe_price_id
    tax = await tax_for_amount(db, item.business_id, item.price_cents)
    price_id = await gateway.create_price(
        account_id,
        amount_cents=tax.total_cents,
        currency=item.currency,
        interval_count=interval_count,
        frequency=frequency,
    )
    item.stripe_price_id = price_id
    await db.flush()
    return price_id


async def open_card_payment(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    invoice: Invoice,
    client: Client,
    amount: int,
    fee_bps: int,
    payment_method: str | None = None,
    kind: str = "payment",
    idempotency_key: str | None = None,
) -> tuple[Payment, str]:
    """Create the direct-charge PaymentIntent (+ app fee, ensuring the client is a Customer) and a
    pending card Payment (kind "payment" or "deposit"). A saved `payment_method` charges off-session
    now; otherwise the returned client_secret is confirmed by the frontend. The caller commits."""
    customer_id = await ensure_customer(db, gateway, account_id, client)
    if payment_method is not None:
        # a saved method charges synchronously below — reserve room (locks the invoice) FIRST so a
        # concurrent partial can't also charge. (The authed path is the only off-session caller and
        # is run_command-idempotent, so this can't wrongly reject a retry.)
        await _assert_room(db, invoice, amount)
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=invoice.currency,
        customer_id=customer_id,
        application_fee_cents=amount * fee_bps // 10000,
        metadata={"invoice_id": invoice.id, "business_id": business_id},
        # key on the caller's Idempotency-Key so a true retry dedups but two distinct same-amount
        # partials (distinct keys) each get their own intent
        idempotency_key=f"{kind}_{invoice.id}_{idempotency_key or amount}",
        payment_method=payment_method,
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    if (
        payment_method is None
    ):  # interactive: room is checked after the dedup (charge isn't yet made)
        await _assert_room(db, invoice, amount)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=client.id,
        kind=kind,
        invoice_id=invoice.id,
        amount_cents=amount,
        currency=invoice.currency,
        method="card",
        provider="stripe",
        provider_ref=intent.id,
        status="pending",
    )
    db.add(payment)
    try:
        await db.flush()  # the unique provider_ref guards a concurrent insert of the same intent
    except IntegrityError as exc:
        raise Conflict("payment is being set up — please retry") from exc
    return payment, intent.client_secret


async def open_booking_deposit(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    booking: Booking,
    client: Client,
    amount: int,
    fee_bps: int,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[Payment, str]:
    """Create the direct-charge deposit PaymentIntent (+ app fee, ensuring the client is a Customer)
    and a pending deposit Payment keyed on the booking. A saved `payment_method` charges off-session
    now; otherwise the returned client_secret is confirmed by the frontend. The caller commits."""
    customer_id = await ensure_customer(db, gateway, account_id, client)
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency="CAD",
        customer_id=customer_id,
        application_fee_cents=amount * fee_bps // 10000,
        metadata={"booking_id": booking.id, "business_id": business_id},
        idempotency_key=f"deposit_{booking.id}_{idempotency_key or amount}",
        payment_method=payment_method,
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=client.id,
        kind="deposit",
        booking_id=booking.id,
        amount_cents=amount,
        currency="CAD",
        method="card",
        provider="stripe",
        provider_ref=intent.id,
        status="pending",
    )
    db.add(payment)
    try:
        await db.flush()  # the unique provider_ref guards a concurrent insert of the same intent
    except IntegrityError as exc:
        raise Conflict("deposit is being set up — please retry") from exc
    return payment, intent.client_secret


async def open_entitlement_payment(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    client: Client,
    amount: int,
    currency: str,
    fee_bps: int,
    entitlement_kind: str,
    entitlement_id: str,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[Payment, str]:
    """Create the direct-charge PaymentIntent (+ app fee) and a pending Payment for a package/gift-
    card purchase. A saved `payment_method` charges off-session now; otherwise the returned
    client_secret is confirmed by the frontend. The caller links the entitlement to the returned
    Payment (its `payment_id`) and commits; the webhook activates it on settlement."""
    customer_id = await ensure_customer(db, gateway, account_id, client)
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=currency,
        customer_id=customer_id,
        application_fee_cents=amount * fee_bps // 10000,
        metadata={f"{entitlement_kind}_id": entitlement_id, "business_id": business_id},
        # the entitlement id is minted fresh per request, so it can't anchor the dedup; key on the
        # client's Idempotency-Key (a keyless purchase stays per-request, like the deposit route)
        idempotency_key=f"{entitlement_kind}_{idempotency_key or entitlement_id}",
        payment_method=payment_method,
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=client.id,
        kind="payment",
        amount_cents=amount,
        currency=currency,
        method="card",
        provider="stripe",
        provider_ref=intent.id,
        status="pending",
    )
    db.add(payment)
    try:
        await db.flush()  # the unique provider_ref guards a concurrent insert of the same intent
    except IntegrityError as exc:
        raise Conflict("purchase is being set up — please retry") from exc
    return payment, intent.client_secret


async def open_order_card_payment(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    order: Order,
    client: Client | None,
    amount: int,
    fee_bps: int,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[Payment, str]:
    """An online card PaymentIntent for a sale (the web till), settled by the same webhook as a
    reader payment. A saved method charges now; otherwise the client secret goes to the card form.
    The caller commits."""
    customer_id = await ensure_customer(db, gateway, account_id, client) if client else None
    if payment_method is not None:
        await _assert_order_room(db, order, amount)
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=order.currency,
        customer_id=customer_id,
        application_fee_cents=amount * fee_bps // 10000,
        metadata={"order_id": order.id, "business_id": business_id},
        idempotency_key=f"order_card_{order.id}_{idempotency_key or amount}",
        payment_method=payment_method,
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing, intent.client_secret
    if payment_method is None:
        await _assert_order_room(db, order, amount)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=order.client_id,
        kind="payment",
        order_id=order.id,
        amount_cents=amount,
        currency=order.currency,
        method="card",
        provider="stripe",
        provider_ref=intent.id,
        status="pending",
    )
    db.add(payment)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise Conflict("checkout is being set up — please retry") from exc
    return payment, intent.client_secret


async def open_terminal_payment(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    order: Order,
    amount: int,
    fee_bps: int,
    idempotency_key: str | None = None,
) -> tuple[Payment, str]:
    """Create a Terminal (card_present) PaymentIntent (+ app fee, no customer) and a pending card
    Payment linked to the order. The device confirms via the Terminal SDK; the webhook settles. The
    caller commits."""
    intent = await gateway.create_terminal_payment_intent(
        account_id,
        amount_cents=amount,
        currency=order.currency,
        application_fee_cents=amount * fee_bps // 10000,
        metadata={"order_id": order.id, "business_id": business_id},
        # key on the caller's Idempotency-Key so a true retry dedups; a re-checkout after an edit
        # (new amount/key) gets a fresh intent that _assert_order_room then rejects
        idempotency_key=f"order_{order.id}_{idempotency_key or amount}",
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    await _assert_order_room(db, order, amount)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=order.client_id,
        kind="payment",
        order_id=order.id,
        amount_cents=amount,
        currency=order.currency,
        method="card",
        provider="stripe",
        provider_ref=intent.id,
        status="pending",
    )
    db.add(payment)
    try:
        await db.flush()  # the unique provider_ref guards a concurrent insert of the same intent
    except IntegrityError as exc:
        raise Conflict("checkout is being set up — please retry") from exc
    return payment, intent.client_secret


async def open_interac_payment(
    db: AsyncSession, *, business_id: str, invoice: Invoice, amount: int, kind: str = "payment"
) -> Payment:
    """A pending Interac Payment with a unique auto-match reference code (caller commits). Reuses an
    open request for the invoice, so a double-submit returns the same code rather than a new one."""
    existing = (
        (
            await db.execute(
                select(Payment)
                .where(
                    Payment.invoice_id == invoice.id,
                    Payment.provider == "interac",
                    Payment.status == "pending",
                )
                .order_by(Payment.created_at)
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    await _assert_room(db, invoice, amount)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=invoice.client_id,
        kind=kind,
        invoice_id=invoice.id,
        amount_cents=amount,
        currency=invoice.currency,
        method="interac",
        provider="interac",
        reference_code=secrets.token_hex(4).upper(),
        status="pending",
    )
    db.add(payment)
    try:
        await db.flush()  # reference_code is unique — a collision is a rare retry
    except IntegrityError as exc:
        raise Conflict("reference code collision — please retry") from exc
    return payment


async def process_stripe_event(
    db: AsyncSession, gateway: PaymentGateway, payload: bytes, signature: str
) -> WebhookOutcome | None:
    """Verify + dedup + dispatch a Stripe webhook (surface #4). Raises WebhookVerificationError on a
    bad signature. A repeated event id is a no-op; on a dispatch error nothing commits, so Stripe
    retries. Returns the client notification this delivery warrants (for the caller to fire
    post-commit), else None."""
    event = gateway.verify_webhook(payload, signature)
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event.id))).scalar_one_or_none()
    if seen is not None:
        return None
    record = Webhook(
        id=event.id, provider="stripe", event=event.type, payload=event.data, status="pending"
    )
    db.add(record)
    outcome = await _dispatch(db, gateway, event)
    record.status = "processed"
    record.processed_at = datetime.now(UTC)
    try:
        await db.commit()
    except IntegrityError:  # a concurrent delivery won the race on a unique key — already applied
        await db.rollback()
        return None
    return outcome


async def _update_payment_method(
    db: AsyncSession, account_id: str | None, data: dict[str, object]
) -> None:
    """Stripe auto-updated a saved card (reissue / new expiry) — refresh our brand + last4."""
    if account_id is None:
        return
    biz = (
        await db.execute(select(Business.id).where(Business.stripe_account_id == account_id))
    ).scalar_one_or_none()
    if biz is None:
        return
    pm = (
        await db.execute(
            scoped(PaymentMethod, biz).where(PaymentMethod.provider_ref == str(data.get("id")))
        )
    ).scalar_one_or_none()
    if pm is None:
        return
    card = data.get("card")
    card = card if isinstance(card, dict) else {}
    if isinstance(card.get("brand"), str):
        pm.brand = card["brand"]
    if isinstance(card.get("last4"), str):
        pm.last4 = card["last4"]
    await db.flush()


async def _reconcile_refund(db: AsyncSession, data: dict[str, object]) -> str | None:
    """Mirror a refund made on Stripe's side (e.g. the dashboard) as a refund row. Our own refund
    command already wrote its row under the same provider_ref, and a re-delivery finds it too."""
    refund_id, intent, amount = data.get("id"), data.get("payment_intent"), data.get("amount")
    if not isinstance(refund_id, str) or not isinstance(intent, str):
        return None
    if not isinstance(amount, int) or amount <= 0 or data.get("status") in ("failed", "canceled"):
        return None
    seen = (
        await db.execute(select(Payment.id).where(Payment.provider_ref == refund_id))
    ).scalar_one_or_none()
    if seen is not None:
        return None
    payment = (
        await db.execute(
            select(Payment).where(Payment.provider_ref == intent, Payment.kind != "refund")
        )
    ).scalar_one_or_none()
    if payment is None or payment.status != "succeeded":
        return None
    refund = Payment(
        id=new_id("payment"),
        business_id=payment.business_id,
        client_id=payment.client_id,
        kind="refund",
        parent_payment_id=payment.id,
        invoice_id=payment.invoice_id,
        order_id=payment.order_id,
        booking_id=payment.booking_id,
        amount_cents=amount,
        currency=payment.currency,
        method=payment.method,
        provider="stripe",
        provider_ref=refund_id,
        status="succeeded",
        paid_at=datetime.now(UTC),
    )
    db.add(refund)
    await db.flush()
    await _apply_refund(db, refund, payment)
    return refund.id


async def _record_dispute(db: AsyncSession, data: dict[str, object]) -> str | None:
    """A chargeback was opened — book the pulled funds + fee and return the disputed payment."""
    status = data.get("status")
    if isinstance(status, str) and status.startswith("warning_"):
        return None  # an inquiry: no funds are withdrawn unless it escalates to a dispute
    payment = await _disputed_payment(db, data)
    if payment is None:
        return None
    amount = data.get("amount")
    txns = data.get("balance_transactions")
    fee = sum(
        int(t["fee"])
        for t in (txns if isinstance(txns, list) else [])
        if isinstance(t, dict) and isinstance(t.get("fee"), int)
    )
    await ledger.post_dispute(
        db,
        payment,
        dispute_id=str(data.get("id")),
        amount=amount if isinstance(amount, int) else payment.amount_cents,
        fee=fee,
    )
    return payment.id


async def _close_dispute(db: AsyncSession, data: dict[str, object]) -> None:
    payment = await _disputed_payment(db, data)
    if payment is not None and data.get("status") == "won":
        await ledger.close_dispute(db, payment.business_id, str(data.get("id")))


async def _disputed_payment(db: AsyncSession, data: dict[str, object]) -> Payment | None:
    intent = data.get("payment_intent")
    if not isinstance(intent, str):
        return None
    return (
        await db.execute(
            select(Payment).where(Payment.provider_ref == intent, Payment.kind != "refund")
        )
    ).scalar_one_or_none()


async def _dispatch(
    db: AsyncSession, gateway: PaymentGateway, event: GatewayEvent
) -> WebhookOutcome | None:
    if event.type == "account.updated":
        account_id = event.data.get("id")
        if isinstance(account_id, str):
            business = (
                await db.execute(select(Business).where(Business.stripe_account_id == account_id))
            ).scalar_one_or_none()
            if business is not None:
                apply_account_status(business, account_status_from(account_id, event.data))
                await db.flush()
    elif event.type == "payment_intent.succeeded":
        settled = await _settle_payment(db, gateway, event.data)
        if settled is None:
            return None
        if settled.gift_card_id is not None:
            return WebhookOutcome("gift_card_issued", settled.gift_card_id)
        return WebhookOutcome("payment", settled.payment_id)
    elif event.type == "payment_intent.payment_failed":
        failed = await _fail_payment(db, str(event.data.get("id")))
        return WebhookOutcome("payment_failed", failed) if failed is not None else None
    elif event.type == "payment_intent.canceled":
        await _fail_payment(db, str(event.data.get("id")), status="canceled")
    elif event.type == "payout.paid":
        await _record_payout(db, event.account, event.data)
    elif event.type == "payout.failed":
        await _fail_payout(db, event.account, event.data)
    elif event.type == "payment_method.attached":
        await _record_payment_method(db, event.account, event.data)
    elif event.type == "payment_method.automatically_updated":
        await _update_payment_method(db, event.account, event.data)
    elif event.type in ("refund.created", "refund.updated"):
        refunded = await _reconcile_refund(db, event.data)
        return WebhookOutcome("refund", refunded) if refunded is not None else None
    elif event.type == "charge.dispute.created":
        disputed = await _record_dispute(db, event.data)
        return WebhookOutcome("payment_disputed", disputed) if disputed is not None else None
    elif event.type == "charge.dispute.closed":
        await _close_dispute(db, event.data)
    elif event.type == "customer.subscription.updated":
        await _update_subscription(db, event.data)
    elif event.type == "customer.subscription.deleted":
        canceled = await _cancel_subscription(db, event.data)
        return WebhookOutcome("subscription_canceled", canceled) if canceled is not None else None
    elif event.type == "invoice.payment_succeeded":
        recorded = await _record_recurring_payment(db, gateway, event.data)
        return WebhookOutcome("payment", recorded) if recorded is not None else None
    elif event.type == "invoice.payment_failed":
        past_due = await _subscription_past_due(db, event.data)
        return WebhookOutcome("subscription_past_due", past_due) if past_due is not None else None
    return None


async def _settle_payment(
    db: AsyncSession, gateway: PaymentGateway, intent: dict[str, object]
) -> _Settled | None:
    intent_id = str(intent.get("id"))
    payment = (
        await db.execute(
            select(Payment).where(Payment.provider_ref == intent_id, Payment.provider == "stripe")
        )
    ).scalar_one_or_none()
    if payment is None:
        _assert_not_ours(intent)
        return None
    if payment.status not in ("pending", "failed"):
        return None
    payment.status = "succeeded"
    payment.paid_at = datetime.now(UTC)
    await db.flush()
    fees = await _fees(db, gateway, payment.business_id, intent_id)
    await ledger.post_payment(db, payment, available_at=fees.available_at)
    await ledger.post_fees(db, payment, fees)
    await _sync_parent(db, payment)
    if payment.booking_id is not None and payment.kind == "deposit":
        await _settle_booking_deposit(db, payment.booking_id)
    gift_card_id = await _settle_entitlement(db, payment)
    return _Settled(payment.id, gift_card_id)


async def _fees(
    db: AsyncSession, gateway: PaymentGateway, business_id: str, intent_id: str
) -> ChargeFees:
    account_id = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == business_id))
    ).scalar_one_or_none()
    if account_id is None:
        return ChargeFees(0, 0, None)
    return await gateway.get_payment_fees(account_id, payment_intent_id=intent_id)


async def _apply_refund(db: AsyncSession, refund: Payment, payment: Payment) -> None:
    """Book a refund and roll its parent back: a forfeited deposit is un-forfeited first so the
    refund draws on the deposit it returns; a refunded package/gift card is voided."""
    deposit = payment.booking_id is not None and payment.kind == "deposit"
    reopened: list[str] = []
    if deposit and payment.booking_id is not None:
        reopened = await _reverse_booking_deposit(db, payment.booking_id)
    await ledger.post_refund(db, refund, payment)
    if deposit and payment.booking_id is not None:
        await _booking_deposit_refunded(db, payment.booking_id)
    for invoice_id in reopened:
        await sync_invoice(db, invoice_id)
    await _sync_parent(db, payment)
    if await _fully_refunded(db, payment):
        await _reverse_entitlement(db, payment)


async def _sync_parent(db: AsyncSession, payment: Payment) -> None:
    if payment.invoice_id is not None:
        await sync_invoice(db, payment.invoice_id)
    if payment.order_id is not None:
        await _sync_order(db, payment.order_id)


async def _settle_entitlement(db: AsyncSession, payment: Payment) -> str | None:
    """Activate a pending package/gift card once its purchase charge settles (only a pure
    entitlement purchase has no invoice/order/booking). Returns the gift card id to notify."""
    if payment.invoice_id or payment.order_id or payment.booking_id:
        return None
    # deferred: package/gift_card import this module's builders, so a top-level import would cycle.
    from clientbridge.services import gift_card_service, package_service

    await package_service.activate_purchased(db, payment.id)
    return await gift_card_service.activate_purchased(db, payment.id)


async def _settle_booking_deposit(db: AsyncSession, booking_id: str) -> None:
    from clientbridge.services import booking_service  # deferred: booking imports this module

    invoice_id = await booking_service.settle_deposit(db, booking_id)
    if invoice_id is not None:
        await sync_invoice(db, invoice_id)


async def _reverse_booking_deposit(db: AsyncSession, booking_id: str) -> list[str]:
    from clientbridge.services import booking_service  # deferred: booking imports this module

    return await booking_service.reverse_deposit(db, booking_id)


async def _booking_deposit_refunded(db: AsyncSession, booking_id: str) -> None:
    from clientbridge.services import booking_service  # deferred: booking imports this module

    await booking_service.deposit_refunded(db, booking_id)


async def _refunded_cents(db: AsyncSession, payment: Payment) -> int:
    total = await db.execute(
        select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
            Payment.parent_payment_id == payment.id,
            Payment.kind == "refund",
            Payment.status == "succeeded",
        )
    )
    return int(total.scalar_one())


async def _fully_refunded(db: AsyncSession, payment: Payment) -> bool:
    return await _refunded_cents(db, payment) >= payment.amount_cents


async def _reverse_entitlement(db: AsyncSession, payment: Payment) -> None:
    """Void a package/gift card whose purchase charge is refunded (mirrors _settle_entitlement)."""
    if payment.invoice_id or payment.order_id or payment.booking_id:
        return
    # deferred: package/gift_card import this module's builders, so a top-level import would cycle.
    from clientbridge.services import gift_card_service, package_service

    await package_service.void_purchased(db, payment.id)
    await gift_card_service.void_purchased(db, payment.id)


async def _sync_order(db: AsyncSession, order_id: str) -> None:
    order = await db.get(Order, order_id)
    if order is None:
        return
    status, _ = await ledger.order_state(db, order)
    await sync_parent_stock(db, order.business_id, "order", order.id, status)
    if status == "paid":
        await ensure_order_earning(db, order)
    else:
        await reverse_order_earning(db, order)


def _assert_not_ours(intent: dict[str, object]) -> None:
    """Our intents carry the business in metadata; one we haven't committed yet (an off-session
    charge whose command is still open) must be retried by Stripe, not acknowledged."""
    metadata = intent.get("metadata")
    if isinstance(metadata, dict) and metadata.get("business_id"):
        raise AppError("payment not recorded yet", status_code=503, code="retry_later")


async def _fail_payment(db: AsyncSession, intent_id: str, *, status: str = "failed") -> str | None:
    """Flag a pending charge failed/canceled; return its id (to notify on) when it transitioned."""
    payment = (
        await db.execute(
            select(Payment).where(Payment.provider_ref == intent_id, Payment.provider == "stripe")
        )
    ).scalar_one_or_none()
    if payment is not None and payment.status == "pending":
        payment.status = status  # a canceled intent frees the invoice's pending room to retry
        await db.flush()
        return payment.id
    return None


async def sync_invoice(db: AsyncSession, invoice_id: str) -> None:
    """Move stock and accrue or unwind the staff earnings that hang off an invoice being fully paid,
    by its status as the ledger now reads it."""
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None or invoice.status in ("draft", "void"):
        return
    status, _ = await ledger.invoice_state(db, invoice)
    await sync_parent_stock(db, invoice.business_id, "invoice", invoice.id, status)
    if status == "paid":
        await ensure_earnings(db, invoice)
    else:
        await reverse_earnings(db, invoice)


async def _record_payout(db: AsyncSession, account_id: str | None, data: dict[str, object]) -> None:
    biz = await _business_for_account(db, account_id)
    amount = data.get("amount")
    if biz is None or not isinstance(amount, int):
        return
    currency = data.get("currency")
    await ledger.post_payout(
        db,
        biz,
        payout_id=str(data.get("id")),
        amount=amount,
        currency=currency.upper() if isinstance(currency, str) else "CAD",
        arrival_at=_period(data, "arrival_date"),
    )


async def _fail_payout(db: AsyncSession, account_id: str | None, data: dict[str, object]) -> None:
    biz = await _business_for_account(db, account_id)
    if biz is not None:
        await ledger.fail_payout(db, biz, str(data.get("id")))


async def _business_for_account(db: AsyncSession, account_id: str | None) -> str | None:
    if account_id is None:
        return None
    return (
        await db.execute(select(Business.id).where(Business.stripe_account_id == account_id))
    ).scalar_one_or_none()


async def _record_payment_method(
    db: AsyncSession, account_id: str | None, data: dict[str, object]
) -> None:
    """Record a saved card (from a SetupIntent) for reuse: maps the connected account → business and
    the Stripe customer → client; deduped by provider_ref."""
    if account_id is None:
        return
    biz = (
        await db.execute(select(Business.id).where(Business.stripe_account_id == account_id))
    ).scalar_one_or_none()
    customer = data.get("customer")
    if biz is None or not isinstance(customer, str):
        return
    client = (
        await db.execute(
            scoped(Client, biz, soft_delete=True).where(Client.stripe_customer_id == customer)
        )
    ).scalar_one_or_none()
    if client is None:
        return
    pm_id = str(data.get("id"))
    seen = (
        await db.execute(scoped(PaymentMethod, biz).where(PaymentMethod.provider_ref == pm_id))
    ).scalar_one_or_none()
    if seen is not None:
        return
    has_card = (
        await db.execute(
            scoped(PaymentMethod, biz)
            .where(PaymentMethod.client_id == client.id, PaymentMethod.status == "active")
            .limit(1)
        )
    ).scalar_one_or_none()
    pm_type = data.get("type")
    if pm_type in ("acss_debit", "us_bank_account"):  # a PAD / bank mandate, not a card
        kind, mandate = "bank_eft", "active"
        detail = data.get(pm_type)
    else:
        kind, mandate = "card", "none"
        detail = data.get("card")
    detail = detail if isinstance(detail, dict) else {}
    brand = detail.get("bank_name") if kind == "bank_eft" else detail.get("brand")
    last4 = detail.get("last4")
    db.add(
        PaymentMethod(
            id=new_id("payment_method"),
            business_id=biz,
            client_id=client.id,
            method=kind,
            brand=brand if isinstance(brand, str) else None,
            last4=last4 if isinstance(last4, str) else None,
            provider="stripe",
            provider_ref=pm_id,
            preferred=has_card is None,  # first method on file becomes the default
            mandate_status=mandate,
            status="active",
        )
    )
    await db.flush()


_SUB_STATUS = {
    "active": "active",
    "trialing": "active",
    "past_due": "past_due",
    "unpaid": "past_due",
    "paused": "paused",
    "canceled": "canceled",
}


def map_subscription_status(stripe_status: str) -> str:
    """Stripe's subscription status → our `subscriptions.status` enum (unknown → past_due, so a
    lapsed/odd status never leaves a non-serving sub marked active)."""
    return _SUB_STATUS.get(stripe_status, "past_due")


async def _find_subscription(db: AsyncSession, provider_ref: str) -> Subscription | None:
    # provider_ref (the Stripe subscription id) is globally unique → no tenant scope needed.
    return (
        await db.execute(select(Subscription).where(Subscription.provider_ref == provider_ref))
    ).scalar_one_or_none()


def _period(data: dict[str, object], edge: str) -> datetime | None:
    ts = period_timestamp(data, edge)
    return datetime.fromtimestamp(ts, tz=UTC) if ts is not None else None


def _invoice_subscription(invoice: dict[str, object]) -> str | None:
    parent = invoice.get("parent")
    details = parent.get("subscription_details") if isinstance(parent, dict) else None
    sub = details.get("subscription") if isinstance(details, dict) else None
    return sub if isinstance(sub, str) else None


async def _update_subscription(db: AsyncSession, data: dict[str, object]) -> None:
    sub_id = data.get("id")
    if not isinstance(sub_id, str):
        return
    sub = await _find_subscription(db, sub_id)
    if sub is None:
        return
    status = data.get("status")
    if isinstance(status, str):
        sub.status = map_subscription_status(status)
    start = _period(data, "start")
    end = _period(data, "end")
    if start is not None:
        sub.current_period_start = start
    if end is not None:
        sub.current_period_end = end
    await db.flush()


async def _cancel_subscription(db: AsyncSession, data: dict[str, object]) -> str | None:
    """Flag a deleted Stripe subscription canceled; return our id (to notify on), else None."""
    sub_id = data.get("id")
    if not isinstance(sub_id, str):
        return None
    sub = await _find_subscription(db, sub_id)
    if sub is None:
        return None
    sub.status = "canceled"
    await db.flush()
    return sub.id


async def _subscription_past_due(db: AsyncSession, data: dict[str, object]) -> str | None:
    """Flag a failed charge's subscription past_due; return our id (to notify on), else None."""
    sub_id = _invoice_subscription(data)
    if sub_id is None:
        return None
    sub = await _find_subscription(db, sub_id)
    if sub is None:
        return None
    sub.status = "past_due"
    await db.flush()
    return sub.id


async def _recurring_method(db: AsyncSession, sub: Subscription) -> str:
    if sub.payment_method_id is None:
        return "card"
    pm = await db.get(PaymentMethod, sub.payment_method_id)
    if pm is None:
        return "card"
    return pm.method


async def _record_recurring_payment(
    db: AsyncSession, gateway: PaymentGateway, data: dict[str, object]
) -> str | None:
    """Record a subscription's recurring charge as a paid Invoice (with line + Canadian tax) and a
    linked succeeded Payment (deduped on the Stripe charge/intent id, so a re-delivery doesn't
    double-record). Returns the new payment id for the post-commit receipt, else None."""
    sub_id, invoice_id = _invoice_subscription(data), data.get("id")
    if sub_id is None or not isinstance(invoice_id, str):
        return None
    sub = await _find_subscription(db, sub_id)
    if sub is None:
        return None
    account_id = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == sub.business_id))
    ).scalar_one_or_none()
    if account_id is None:
        return None
    ref = await gateway.get_invoice_payment_intent(account_id, invoice_id=invoice_id)
    paid = data.get("amount_paid")
    if ref is None:
        if isinstance(paid, int) and paid > 0:
            raise AppError("invoice payment not visible yet", status_code=503, code="retry_later")
        return None
    seen = (
        await db.execute(select(Payment.id).where(Payment.provider_ref == ref))
    ).scalar_one_or_none()
    if seen is not None:  # already recorded — a re-delivery of the same charge
        return None
    currency = data.get("currency")
    cur = currency.upper() if isinstance(currency, str) else "CAD"
    invoice_id = await _recurring_invoice(db, sub, cur)
    payment = Payment(
        id=new_id("payment"),
        business_id=sub.business_id,
        client_id=sub.client_id,
        kind="payment",
        invoice_id=invoice_id,
        amount_cents=paid if isinstance(paid, int) else 0,
        currency=cur,
        method=await _recurring_method(db, sub),
        provider="stripe",
        provider_ref=ref,
        status="succeeded",
        paid_at=datetime.now(UTC),
    )
    db.add(payment)
    await db.flush()
    fees = await _fees(db, gateway, sub.business_id, ref)
    await ledger.post_payment(db, payment, available_at=fees.available_at)
    await ledger.post_fees(db, payment, fees)
    await _sync_parent(db, payment)
    return payment.id


async def _recurring_invoice(db: AsyncSession, sub: Subscription, currency: str) -> str | None:
    """An internal Invoice + Line for one subscription period, taxed through the line engine and
    booked to the ledger so the recurring charge settles it like any other invoice."""
    item = await db.get(Item, sub.item_id)
    if item is None:
        return None
    now = datetime.now(UTC)
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=sub.business_id,
        client_id=sub.client_id,
        status="sent",
        currency=currency,
        issued_at=now,
    )
    db.add(invoice)
    await db.flush()
    line = Line(
        id=new_id("line"),
        business_id=sub.business_id,
        invoice_id=invoice.id,
        description=item.name,
        item_id=item.id,
        quantity=1,
        unit_amount_cents=item.price_cents,
        amount_cents=item.price_cents,
        position=0,
    )
    db.add(line)
    result = await tax_for_lines(db, sub.business_id, [line])
    apply_totals(invoice, result)
    await db.flush()
    await ledger.post_invoice(db, invoice, result)
    return invoice.id


async def match_interac(db: AsyncSession, reference_code: str, amount_cents: int) -> str | None:
    """Match an inbound e-Transfer to its pending payment by reference code (no fee — the wedge).
    reference_code is globally unique, so the lookup needs no tenant scope. Returns the matched
    payment id, else None."""
    payment = (
        await db.execute(
            select(Payment).where(
                Payment.reference_code == reference_code,
                Payment.provider == "interac",
                Payment.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if payment is None or amount_cents < payment.amount_cents:
        return None
    payment.status = "succeeded"
    payment.paid_at = datetime.now(UTC)
    await db.flush()
    await ledger.post_payment(db, payment)
    await _sync_parent(db, payment)
    return payment.id


async def process_interac_event(
    db: AsyncSession, reference_code: str, amount_cents: int
) -> str | None:
    """Webhook entry (surface #4): dedup by reference, auto-match, record the event. Returns the
    matched payment id (for the caller to notify on, post-commit), else None."""
    event_id = f"interac_{reference_code}"
    seen = (await db.execute(select(Webhook.id).where(Webhook.id == event_id))).scalar_one_or_none()
    if seen is not None:
        return None
    matched_id = await match_interac(db, reference_code, amount_cents)
    db.add(
        Webhook(
            id=event_id,
            provider="interac",
            event="etransfer.received",
            payload={
                "reference_code": reference_code,
                "amount_cents": amount_cents,
                "matched": matched_id is not None,
            },
            status="processed",
            processed_at=datetime.now(UTC),
        )
    )
    try:
        await db.commit()
    except IntegrityError:  # a concurrent delivery won the race on the event id — already applied
        await db.rollback()
        return None
    return matched_id
