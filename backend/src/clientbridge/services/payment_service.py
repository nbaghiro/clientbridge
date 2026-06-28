import secrets
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal
from clientbridge.core.errors import Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import GatewayEvent, PaymentGateway
from clientbridge.models.billing import Invoice, Line
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business, Staff
from clientbridge.models.payments import Payment, PaymentMethod, Payout, PayoutAllocation
from clientbridge.models.platform import WebhookEvent
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.payments import (
    ConnectStatus,
    InteracRequest,
    OnboardingLink,
    PayIntentOut,
    RefundOut,
    RemittanceSummary,
    SetupIntentOut,
)


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

    async def start_card_setup(self, client_id: str) -> SetupIntentOut:
        """A SetupIntent to save a client's card for later off-session charges (no charge now)."""
        self._assert_admin()
        business = await self._business()
        if business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before saving cards")
        client = await self._client(client_id)
        customer_id = await ensure_customer(
            self.db, self.gateway, business.stripe_account_id, client
        )
        intent = await self.gateway.create_setup_intent(
            business.stripe_account_id, customer_id=customer_id
        )
        await self.db.commit()
        return SetupIntentOut(
            client_secret=intent.client_secret, stripe_account_id=business.stripe_account_id
        )

    async def _saved_method_ref(self, payment_method_id: str | None, client_id: str) -> str | None:
        if payment_method_id is None:
            return None
        pm = (
            await self.db.execute(
                scoped(PaymentMethod, self.biz).where(
                    PaymentMethod.id == payment_method_id, PaymentMethod.client_id == client_id
                )
            )
        ).scalar_one_or_none()
        if pm is None or pm.provider_ref is None:
            raise NotFound("saved card not found")
        return pm.provider_ref

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
            cmd.record("payment.refund", entity_type="payment", entity_id=refund.id)
            return RefundOut(refund_id=refund.id, status=result.status)

        return await run_command(
            self.db, self.principal, action="payment.refund", run=run, response_model=RefundOut
        )

    async def request_interac(
        self, invoice_id: str, amount_cents: int | None, idempotency_key: str | None
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
                self.db, business_id=self.biz, invoice=invoice, amount=amount
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
) -> tuple[Payment, str]:
    """Create the direct-charge PaymentIntent (+ app fee, ensuring the client is a Customer) and a
    pending card Payment. A saved `payment_method` charges off-session now; otherwise the returned
    client_secret is confirmed by the frontend. The caller commits."""
    customer_id = await ensure_customer(db, gateway, account_id, client)
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=invoice.currency,
        customer_id=customer_id,
        application_fee_cents=amount * fee_bps // 10000,
        metadata={"invoice_id": invoice.id, "business_id": business_id},
        # one intent per (invoice, amount) — a retry returns the same intent, not a new charge
        idempotency_key=f"card_{invoice.id}_{amount}",
        payment_method=payment_method,
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    await _assert_room(db, invoice, amount)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=client.id,
        kind="payment",
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


async def open_interac_payment(
    db: AsyncSession, *, business_id: str, invoice: Invoice, amount: int
) -> Payment:
    """A pending Interac Payment with a unique auto-match reference code (caller commits)."""
    await _assert_room(db, invoice, amount)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=invoice.client_id,
        kind="payment",
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
) -> str | None:
    """Verify + dedup + dispatch a Stripe webhook (surface #4). Raises WebhookVerificationError on a
    bad signature. A repeated event id is a no-op; on a dispatch error nothing commits, so Stripe
    retries. Returns the id of a payment that settled this delivery (for the caller to notify on,
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
    settled = await _dispatch(db, event)
    record.status = "processed"
    record.processed_at = datetime.now(UTC)
    try:
        await db.commit()
    except IntegrityError:  # a concurrent delivery won the race on a unique key — already applied
        await db.rollback()
        return None
    return settled


async def _dispatch(db: AsyncSession, event: GatewayEvent) -> str | None:
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
        return await _settle_payment(
            db, str(event.data.get("id")), fee_cents=int(fee) if isinstance(fee, int) else 0
        )
    elif event.type == "payment_intent.payment_failed":
        await _fail_payment(db, str(event.data.get("id")))
    elif event.type == "payment_intent.canceled":
        await _fail_payment(db, str(event.data.get("id")), status="canceled")
    elif event.type == "payout.paid":
        await _record_payout(db, event.account, event.data)
    elif event.type == "payment_method.attached":
        await _record_payment_method(db, event.account, event.data)
    return None


async def _settle_payment(db: AsyncSession, intent_id: str, *, fee_cents: int) -> str | None:
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
    return payment.id


async def _fail_payment(db: AsyncSession, intent_id: str, *, status: str = "failed") -> None:
    payment = (
        await db.execute(
            select(Payment).where(Payment.provider_ref == intent_id, Payment.provider == "stripe")
        )
    ).scalar_one_or_none()
    if payment is not None and payment.status == "pending":
        payment.status = status  # a canceled intent frees the invoice's pending room to retry
        await db.flush()


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
    """Mirror a Stripe payout (on the connected account) into our `payouts` table."""
    if account_id is None:
        return
    biz = (
        await db.execute(select(Business.id).where(Business.stripe_account_id == account_id))
    ).scalar_one_or_none()
    if biz is None:
        return
    payout_id = str(data.get("id"))
    amount = data.get("amount")
    arrival = data.get("arrival_date")
    arrival_at = datetime.fromtimestamp(arrival, tz=UTC) if isinstance(arrival, int) else None
    existing = (
        await db.execute(
            select(Payout).where(Payout.provider_ref == payout_id, Payout.business_id == biz)
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.status = "paid"
        if arrival_at is not None:
            existing.arrival_at = arrival_at
    else:
        db.add(
            Payout(
                id=new_id("payout"),
                business_id=biz,
                amount_cents=amount if isinstance(amount, int) else 0,
                status="paid",
                provider_ref=payout_id,
                arrival_at=arrival_at,
            )
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
            select(Client).where(Client.business_id == biz, Client.stripe_customer_id == customer)
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
    card = data.get("card")
    brand = card.get("brand") if isinstance(card, dict) else None
    last4 = card.get("last4") if isinstance(card, dict) else None
    db.add(
        PaymentMethod(
            id=new_id("payment_method"),
            business_id=biz,
            client_id=client.id,
            type="card",
            brand=brand if isinstance(brand, str) else None,
            last4=last4 if isinstance(last4, str) else None,
            provider="stripe",
            provider_ref=pm_id,
            status="active",
        )
    )
    await db.flush()


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
