import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped, scoped_update
from clientbridge.integrations.payments import GatewayEvent, PaymentGateway
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.catalog import GiftCard, Item, Package, Subscription
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff
from clientbridge.models.payments import Payment, PaymentMethod, Payout, PayoutAllocation
from clientbridge.models.platform import WebhookEvent
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.payments import (
    ConnectStatus,
    DetachResult,
    InteracRequest,
    OnboardingLink,
    PayIntentOut,
    PaymentMethodOut,
    RefundOut,
    RemittanceSummary,
    SetupIntentOut,
)
from clientbridge.services.lines import tax_for_lines


@dataclass(frozen=True)
class WebhookOutcome:
    """A post-commit client notification the webhook route fires (mirrors the receipt path)."""

    notify: str  # payment | payment_failed | gift_card_issued | subscription_{past_due,canceled}
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
            if business.stripe_account_id is None:
                business.stripe_account_id = await self.gateway.create_connected_account(
                    business_name=business.name, email=business.billing_email
                )
                await self.db.flush()
                cmd.record("connect.account_created", entity_type="business", entity_id=business.id)
            url = await self.gateway.create_account_link(
                business.stripe_account_id,
                refresh_url=f"{settings.web_base_url}/settings/payments?refresh=1",
                return_url=f"{settings.web_base_url}/settings/payments?done=1",
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
        return ConnectStatus(
            connected=business.stripe_account_id is not None,
            charges_enabled=business.stripe_charges_enabled,
        )

    async def remittance_summary(self) -> RemittanceSummary:
        self._assert_admin()
        paid = scoped(Invoice, self.biz).where(Invoice.status == "paid").subquery()
        total = (
            await self.db.execute(select(func.coalesce(func.sum(paid.c.tax_total_cents), 0)))
        ).scalar_one()
        return RemittanceSummary(tax_collected_cents=int(total))

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
        balance = assert_payable(invoice)
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
                .values(is_default=False)
            )
            pm.is_default = True
            await self.db.flush()
            cmd.record("payment_method.set_default", entity_type="payment_method", entity_id=pm.id)
            return PaymentMethodOut(
                id=pm.id,
                client_id=pm.client_id,
                brand=pm.brand,
                last4=pm.last4,
                is_default=pm.is_default,
                status=pm.status,
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment_method.set_default",
            run=run,
            response_model=PaymentMethodOut,
        )

    async def refund_payment(self, payment_id: str) -> RefundOut:
        self._assert_admin()
        business = await self._business()
        payment = await self._payment(payment_id)
        if payment.kind == "refund":
            raise Conflict("a refund can't be refunded")
        if payment.status != "succeeded":
            raise Conflict("only a succeeded payment can be refunded")
        if business.stripe_account_id is None or payment.provider_ref is None:
            raise Conflict("payment has no connected charge to refund")
        prior = (
            await self.db.execute(
                select(Payment.id).where(
                    Payment.parent_payment_id == payment.id, Payment.kind == "refund"
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            raise Conflict("this payment was already refunded")
        account_id = business.stripe_account_id
        provider_ref = payment.provider_ref

        async def run(cmd: Command) -> RefundOut:
            result = await self.gateway.refund(
                account_id,
                payment_intent_id=provider_ref,
                amount_cents=payment.amount_cents,
                idempotency_key=f"refund_{payment.id}",
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
                amount_cents=payment.amount_cents,
                currency=payment.currency,
                method=payment.method,
                provider="stripe",
                provider_ref=result.id,
                status="succeeded",
                paid_at=datetime.now(UTC),
            )
            self.db.add(refund)
            try:
                await self.db.flush()  # one-refund-per-payment unique guards a concurrent double
            except IntegrityError as exc:
                raise Conflict("this payment was already refunded") from exc
            if payment.invoice_id is not None:
                await _reconcile_invoice(self.db, payment.invoice_id)
            if payment.order_id is not None:
                await _reconcile_order(self.db, payment.order_id)
            if payment.booking_id is not None and payment.kind == "deposit":
                await _reverse_booking_deposit(self.db, payment.booking_id)
            await _reverse_entitlement(self.db, payment)
            cmd.record("payment.refund", entity_type="payment", entity_id=refund.id)
            return RefundOut(refund_id=refund.id, status=result.status)

        return await run_command(
            self.db, self.principal, action="payment.refund", run=run, response_model=RefundOut
        )

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
        balance = assert_payable(invoice)
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
        if self.principal.role not in ("owner", "admin"):
            raise Forbidden("only an owner or admin can manage payments")

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
                PaymentMethod.is_default.is_(True),
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


def assert_payable(invoice: Invoice) -> int:
    """Validate an invoice can take a payment; return the outstanding balance. Shared by the authed
    command path and the public pay-link surface so the rule can't drift between them."""
    if invoice.status in ("paid", "void"):
        raise Conflict(f"a {invoice.status} invoice can't be charged")
    if invoice.balance_cents <= 0:
        raise Conflict("nothing left to pay on this invoice")
    return invoice.balance_cents


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
    if amount > invoice.balance_cents - int(pending):
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
    if amount > order.balance_cents - int(pending):
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
    """A pending Interac Payment with a unique auto-match reference code (caller commits)."""
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
    seen = (
        await db.execute(select(WebhookEvent.id).where(WebhookEvent.id == event.id))
    ).scalar_one_or_none()
    if seen is not None:
        return None
    record = WebhookEvent(
        id=event.id, provider="stripe", type=event.type, payload=event.data, status="pending"
    )
    db.add(record)
    outcome = await _dispatch(db, event)
    record.status = "processed"
    record.processed_at = datetime.now(UTC)
    try:
        await db.commit()
    except IntegrityError:  # a concurrent delivery won the race on a unique key — already applied
        await db.rollback()
        return None
    return outcome


async def _dispatch(db: AsyncSession, event: GatewayEvent) -> WebhookOutcome | None:
    if event.type == "account.updated":
        account_id = event.data.get("id")
        if isinstance(account_id, str):
            await db.execute(
                update(Business)
                .where(Business.stripe_account_id == account_id)
                .values(stripe_charges_enabled=bool(event.data.get("charges_enabled")))
            )
    elif event.type == "payment_intent.succeeded":
        fee = event.data.get("application_fee_amount")
        settled = await _settle_payment(
            db, str(event.data.get("id")), fee_cents=int(fee) if isinstance(fee, int) else 0
        )
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
    elif event.type == "payment_method.attached":
        await _record_payment_method(db, event.account, event.data)
    elif event.type == "customer.subscription.updated":
        await _update_subscription(db, event.data)
    elif event.type == "customer.subscription.deleted":
        canceled = await _cancel_subscription(db, event.data)
        return WebhookOutcome("subscription_canceled", canceled) if canceled is not None else None
    elif event.type == "invoice.payment_succeeded":
        recorded = await _record_recurring_payment(db, event.data)
        return WebhookOutcome("payment", recorded) if recorded is not None else None
    elif event.type == "invoice.payment_failed":
        past_due = await _subscription_past_due(db, event.data)
        return WebhookOutcome("subscription_past_due", past_due) if past_due is not None else None
    return None


async def _settle_payment(db: AsyncSession, intent_id: str, *, fee_cents: int) -> _Settled | None:
    payment = (
        await db.execute(
            select(Payment).where(Payment.provider_ref == intent_id, Payment.provider == "stripe")
        )
    ).scalar_one_or_none()
    if payment is None or payment.status != "pending":
        return None
    payment.status = "succeeded"
    payment.paid_at = datetime.now(UTC)
    payment.fee_cents = fee_cents
    payment.net_cents = payment.amount_cents - fee_cents
    await db.flush()
    if payment.invoice_id is not None:
        await _reconcile_invoice(db, payment.invoice_id)
    if payment.order_id is not None:
        await _reconcile_order(db, payment.order_id)
    if payment.booking_id is not None and payment.kind == "deposit":
        await _settle_booking_deposit(db, payment.booking_id)
    gift_card_id = await _settle_entitlement(db, payment)
    return _Settled(payment.id, gift_card_id)


async def _settle_entitlement(db: AsyncSession, payment: Payment) -> str | None:
    """Activate a pending package/gift card once its purchase charge settles (mirrors the deposit
    settlement). Returns the gift card id whose recipient to notify, else None."""
    if payment.invoice_id or payment.order_id or payment.booking_id:
        return None
    package = (
        await db.execute(select(Package).where(Package.payment_id == payment.id))
    ).scalar_one_or_none()
    if package is not None and package.status == "pending":
        package.status = "active"
        await db.flush()
        return None
    card = (
        await db.execute(select(GiftCard).where(GiftCard.payment_id == payment.id))
    ).scalar_one_or_none()
    if card is not None and card.status == "pending":
        card.status = "active"
        await db.flush()
        return card.id
    return None


async def _settle_booking_deposit(db: AsyncSession, booking_id: str) -> None:
    """Mark a booking's deposit collected once its charge settles — but never downgrade one already
    forfeited (a no-show capture marks forfeited up-front; its later settlement keeps it)."""
    booking = await db.get(Booking, booking_id)
    if booking is not None and booking.deposit_status in ("none", "pending"):
        booking.deposit_status = "collected"
        await db.flush()


async def _reverse_booking_deposit(db: AsyncSession, booking_id: str) -> None:
    """Undo a collected deposit when its charge is refunded (no `refunded` enum value → `none`)."""
    booking = await db.get(Booking, booking_id)
    if booking is not None and booking.deposit_status == "collected":
        booking.deposit_status = "none"
        await db.flush()


async def _reverse_entitlement(db: AsyncSession, payment: Payment) -> None:
    """Void a package/gift card whose purchase charge is refunded (mirrors _settle_entitlement)."""
    if payment.invoice_id or payment.order_id or payment.booking_id:
        return
    package = (
        await db.execute(select(Package).where(Package.payment_id == payment.id))
    ).scalar_one_or_none()
    if package is not None and package.status in ("pending", "active"):
        package.status = "canceled"
        await db.flush()
        return
    card = (
        await db.execute(select(GiftCard).where(GiftCard.payment_id == payment.id))
    ).scalar_one_or_none()
    if card is not None and card.status in ("pending", "active"):
        card.status = "void"
        await db.flush()


async def _reconcile_order(db: AsyncSession, order_id: str) -> None:
    """Recompute amount_paid / balance / status from the order's succeeded payments + refunds."""
    order = await db.get(Order, order_id)
    if order is None:
        return
    rows = (await db.execute(select(Payment).where(Payment.order_id == order_id))).scalars().all()
    paid = sum(
        p.amount_cents for p in rows if p.status == "succeeded" and p.kind in ("payment", "deposit")
    ) - sum(p.amount_cents for p in rows if p.status == "succeeded" and p.kind == "refund")
    refunded = any(p.status == "succeeded" and p.kind == "refund" for p in rows)
    order.amount_paid_cents = paid
    order.balance_cents = order.total_cents - paid
    if paid > 0 and order.balance_cents <= 0:
        order.status = "paid"
        order.paid_at = datetime.now(UTC)
    elif paid <= 0 and refunded:
        order.status = "refunded"  # fully refunded
        order.paid_at = None
    else:
        order.status = "open"
        order.paid_at = None
    await db.flush()


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


async def _reconcile_invoice(db: AsyncSession, invoice_id: str) -> None:
    """Recompute amount_paid / balance / status from the invoice's succeeded payments + refunds."""
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        return
    rows = (
        (await db.execute(select(Payment).where(Payment.invoice_id == invoice_id))).scalars().all()
    )
    paid = sum(
        p.amount_cents for p in rows if p.status == "succeeded" and p.kind in ("payment", "deposit")
    ) - sum(p.amount_cents for p in rows if p.status == "succeeded" and p.kind == "refund")
    invoice.amount_paid_cents = paid
    invoice.balance_cents = invoice.total_cents - paid
    if paid <= 0:
        if invoice.status in ("paid", "partial"):
            invoice.status = "sent"  # fully refunded back to owing
            invoice.paid_at = None
    elif invoice.balance_cents <= 0:
        invoice.status = "paid"
        invoice.paid_at = datetime.now(UTC)
    else:
        invoice.status = "partial"
        invoice.paid_at = None  # a partial refund un-pays the invoice
    await db.flush()
    if invoice.status == "paid":
        await _ensure_allocations(db, invoice)


async def _record_payout(db: AsyncSession, account_id: str | None, data: dict[str, object]) -> None:
    """Mirror a Stripe payout (on the connected account) into our `payouts` table, then attach the
    business's settled (approved/paid) unlinked allocations to it. Stripe doesn't itemize our
    splits, so this is coarse — all currently-owed allocations link to this bank payout."""
    if account_id is None:
        return
    biz = (
        await db.execute(select(Business.id).where(Business.stripe_account_id == account_id))
    ).scalar_one_or_none()
    if biz is None:
        return
    payout_ref = str(data.get("id"))
    amount = data.get("amount")
    arrival = data.get("arrival_date")
    arrival_at = datetime.fromtimestamp(arrival, tz=UTC) if isinstance(arrival, int) else None
    existing = (
        await db.execute(
            select(Payout).where(Payout.provider_ref == payout_ref, Payout.business_id == biz)
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.status = "paid"
        if arrival_at is not None:
            existing.arrival_at = arrival_at
        payout = existing
    else:
        payout = Payout(
            id=new_id("payout"),
            business_id=biz,
            amount_cents=amount if isinstance(amount, int) else 0,
            status="paid",
            provider_ref=payout_ref,
            arrival_at=arrival_at,
        )
        db.add(payout)
    await db.flush()
    await db.execute(
        scoped_update(PayoutAllocation, biz)
        .where(
            PayoutAllocation.status.in_(("approved", "paid")),
            PayoutAllocation.payout_id.is_(None),
        )
        .values(payout_id=payout.id)
    )
    await db.flush()


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
        await db.execute(
            select(PaymentMethod.id).where(
                PaymentMethod.business_id == biz, PaymentMethod.provider_ref == pm_id
            )
        )
    ).scalar_one_or_none()
    if seen is not None:
        return
    has_card = (
        await db.execute(
            select(PaymentMethod.id)
            .where(
                PaymentMethod.business_id == biz,
                PaymentMethod.client_id == client.id,
                PaymentMethod.status == "active",
            )
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
            type=kind,
            brand=brand if isinstance(brand, str) else None,
            last4=last4 if isinstance(last4, str) else None,
            provider="stripe",
            provider_ref=pm_id,
            is_default=has_card is None,  # first method on file becomes the default
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


def _period(data: dict[str, object], key: str) -> datetime | None:
    ts = data.get(key)
    return datetime.fromtimestamp(ts, tz=UTC) if isinstance(ts, int) else None


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
    start = _period(data, "current_period_start")
    end = _period(data, "current_period_end")
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
    sub_id = data.get("subscription")
    if not isinstance(sub_id, str):
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
    return {"card": "card", "bank_eft": "eft", "interac": "interac"}.get(pm.type, "card")


async def _record_recurring_payment(db: AsyncSession, data: dict[str, object]) -> str | None:
    """Record a subscription's recurring charge as a paid Invoice (with line + Canadian tax) and a
    linked succeeded Payment (deduped on the Stripe charge/intent id, so a re-delivery doesn't
    double-record). Returns the new payment id for the post-commit receipt, else None."""
    sub_id = data.get("subscription")
    if not isinstance(sub_id, str):
        return None
    sub = await _find_subscription(db, sub_id)
    if sub is None:
        return None
    ref = data.get("payment_intent") or data.get("charge")
    if not isinstance(ref, str):
        return None
    seen = (
        await db.execute(select(Payment.id).where(Payment.provider_ref == ref))
    ).scalar_one_or_none()
    if seen is not None:  # already recorded — a re-delivery of the same charge
        return None
    amount = data.get("amount_paid")
    currency = data.get("currency")
    cur = currency.upper() if isinstance(currency, str) else "CAD"
    invoice_id = await _recurring_invoice(db, sub, cur)
    payment = Payment(
        id=new_id("payment"),
        business_id=sub.business_id,
        client_id=sub.client_id,
        kind="payment",
        invoice_id=invoice_id,
        amount_cents=amount if isinstance(amount, int) else 0,
        currency=cur,
        method=await _recurring_method(db, sub),
        provider="stripe",
        provider_ref=ref,
        status="succeeded",
        paid_at=datetime.now(UTC),
    )
    db.add(payment)
    await db.flush()
    return payment.id


async def _recurring_invoice(db: AsyncSession, sub: Subscription, currency: str) -> str | None:
    """A paid internal Invoice + Line for one subscription period, taxed through the line engine so
    the GST/HST report (which sums paid invoices) counts the recurring revenue."""
    item = await db.get(Item, sub.item_id)
    if item is None:
        return None
    now = datetime.now(UTC)
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=sub.business_id,
        client_id=sub.client_id,
        status="paid",
        currency=currency,
        issued_at=now,
        paid_at=now,
    )
    db.add(invoice)
    await db.flush()
    line = Line(
        id=new_id("line"),
        business_id=sub.business_id,
        parent_type="invoice",
        parent_id=invoice.id,
        description=item.name,
        item_id=item.id,
        quantity=1,
        unit_amount_cents=item.price_cents,
        amount_cents=item.price_cents,
        position=0,
    )
    db.add(line)
    result = await tax_for_lines(db, sub.business_id, [line])
    invoice.subtotal_cents = result.subtotal_cents
    invoice.tax_total_cents = result.tax_total_cents
    invoice.total_cents = result.total_cents
    invoice.amount_paid_cents = result.total_cents
    invoice.balance_cents = 0
    await db.flush()
    return invoice.id


async def _ensure_allocations(db: AsyncSession, invoice: Invoice) -> None:
    """On a fully-paid invoice, record a pending payout split for each payee staff on its booking
    lines (percent of the line). Idempotent — skips bookings already allocated."""
    lines = (
        (
            await db.execute(
                select(Line).where(
                    Line.parent_type == "invoice",
                    Line.parent_id == invoice.id,
                    Line.booking_id.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for line in lines:
        booking_id = line.booking_id
        if booking_id is None:
            continue
        seen = (
            (
                await db.execute(
                    select(PayoutAllocation.id)
                    .where(
                        PayoutAllocation.source_type == "booking",
                        PayoutAllocation.source_id == booking_id,
                    )
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if seen is not None:
            continue
        booking = await db.get(Booking, booking_id)
        if booking is None or booking.staff_id is None:
            continue
        staff = await db.get(Staff, booking.staff_id)
        if (
            staff is None
            or not staff.is_payee
            or staff.rate_type != "percent"
            or staff.default_rate is None
        ):
            continue
        db.add(
            PayoutAllocation(
                id=new_id("payout_allocation"),
                business_id=invoice.business_id,
                staff_id=staff.id,
                source_type="booking",
                source_id=booking_id,
                basis="percent",
                rate=staff.default_rate,
                amount_cents=round(line.amount_cents * staff.default_rate / 100),
                status="pending",
            )
        )
    await db.flush()


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
    payment.net_cents = payment.amount_cents
    await db.flush()
    if payment.invoice_id is not None:
        await _reconcile_invoice(db, payment.invoice_id)
    return payment.id


async def process_interac_event(
    db: AsyncSession, reference_code: str, amount_cents: int
) -> str | None:
    """Webhook entry (surface #4): dedup by reference, auto-match, record the event. Returns the
    matched payment id (for the caller to notify on, post-commit), else None."""
    event_id = f"interac_{reference_code}"
    seen = (
        await db.execute(select(WebhookEvent.id).where(WebhookEvent.id == event_id))
    ).scalar_one_or_none()
    if seen is not None:
        return None
    matched_id = await match_interac(db, reference_code, amount_cents)
    db.add(
        WebhookEvent(
            id=event_id,
            provider="interac",
            type="etransfer.received",
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
