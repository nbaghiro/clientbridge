import contextlib
import hashlib
import logging
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from time import monotonic
from typing import Literal

from sqlalchemy import (
    BigInteger,
    Integer,
    Select,
    Subquery,
    and_,
    case,
    cast,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.db import transaction
from clientbridge.core.deployment import payment_domains
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import AppError, Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.locale import locale_for, message
from clientbridge.core.ratelimit import allow_action, connect_refresh_limiter
from clientbridge.core.scoping import scoped, scoped_update
from clientbridge.core.security import hash_token
from clientbridge.core.zones import zone
from clientbridge.integrations.stripe import (
    ACCOUNT_EVENTS,
    PAYMENT_EVENTS,
    PLAN_EVENTS,
    SETTLEMENT_CURRENCY,
    STRIPE_API_VERSION,
    ChargeFees,
    ConnectComponent,
    GatewayEvent,
    MissedEvent,
    PaymentGateway,
    PriceTerms,
    StripeResource,
    StripeTransaction,
    WebhookVersionError,
    period_timestamp,
)
from clientbridge.models.billing import Invoice, Line, Order
from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import (
    Frequency,
    GiftCard,
    Item,
    Package,
    Subscription,
    SubscriptionStatus,
)
from clientbridge.models.clients import Client
from clientbridge.models.ledger import Account, Entry
from clientbridge.models.payments import (
    Payment,
    PaymentKind,
    PaymentMethod,
    PaymentProvider,
    PaymentSetupLink,
    PaymentStatus,
)
from clientbridge.models.platform import Audit, Webhook
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.payments import (
    ConnectSessionOut,
    ConnectStatus,
    DetachResult,
    InvoicePaymentIn,
    InvoicePaymentOut,
    PaymentMethodOut,
    PaymentSetupLinkOut,
    PayoutContentsOut,
    PayoutOut,
    PayoutsOut,
    PayoutTransactionOut,
    PublicCredit,
    PublicPaymentSetup,
    RefundBlock,
    RefundOut,
    RefundPart,
    RefundPreview,
    RequirementErrorOut,
    SetupIntentOut,
    TipShareIn,
)
from clientbridge.services import ledger, plans
from clientbridge.services.business import (
    apply_account_status,
    has_merchant,
    kyc_status,
    merchant_account,
    requirement_errors,
)
from clientbridge.services.deliveries import delivery_key
from clientbridge.services.earnings import (
    cancel_returned_tips,
    claw_back,
    claw_back_purchase,
    ensure_earnings,
    ensure_order_earning,
    reverse_earnings,
    reverse_order_earning,
)
from clientbridge.services.inventory import assert_parent_stock, sync_parent_stock
from clientbridge.services.ledger import BUSINESS_CURRENCY
from clientbridge.services.lines import allocate, apply_totals, worker_shares
from clientbridge.services.notifications import Notifier, queued_notifier
from clientbridge.services.tax import tax_for_amount, tax_within

_log = logging.getLogger(__name__)
_ORPHAN_GRACE = timedelta(hours=1)


type WebhookNotice = Literal[
    "payment",
    "payment_failed",
    "refund",
    "refund_failed",
    "refund_stalled",
    "payment_disputed",
    "dispute_inquiry",
    "gift_card_issued",
    "subscription_past_due",
    "subscription_canceled",
]


@dataclass(frozen=True)
class WebhookOutcome:
    """The client notice a Stripe event queues in its own commit."""

    notify: WebhookNotice
    target_id: str
    episode: str | None = None  # a notice that may repeat, such as each failed membership invoice

    @property
    def key(self) -> str:
        base = delivery_key(f"stripe:{self.notify}", self.target_id)
        return base if self.episode is None else f"{base}:{self.episode}"


class RefundBlocked(Conflict):
    def __init__(self, message: str, block: RefundBlock) -> None:
        super().__init__(message, code=block)
        self.block: RefundBlock = block


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

    async def account_session(self, component: ConnectComponent) -> ConnectSessionOut:
        self._assert_admin()
        business = await self._locked_business()
        if business.stripe_account_id is None or not has_merchant(business):
            if component != "onboarding":
                raise Conflict("set up payments before managing your payment account")
            cmd = Command(self.db, self.principal)
            await self._ensure_merchant(business, cmd)
            self.db.add_all(cmd.audits)
            await self.db.commit()
        account_id = business.stripe_account_id
        assert account_id is not None
        secret = await self.gateway.create_account_session(account_id, component)
        cmd = Command(self.db, self.principal)
        cmd.record(
            "connect.session",
            entity_type="business",
            entity_id=business.id,
            changes={"component": component},
        )
        self.db.add_all(cmd.audits)
        # Single-use credentials must never enter command response storage.
        await self.db.commit()
        if component == "onboarding":
            await self._register_domains(account_id)
        return ConnectSessionOut(client_secret=secret)

    async def _register_domains(self, account_id: str) -> None:
        """Wallets show only on hosts registered on the account; a miss retries next session."""
        base_domain = get_settings().base_domain
        if not base_domain:
            return
        try:
            await self.gateway.register_payment_domains(account_id, payment_domains(base_domain))
        except Exception:
            _log.warning("payment domain registration failed for %s", account_id, exc_info=True)

    async def _ensure_merchant(self, business: Business, cmd: Command) -> str:
        """The business's account with the merchant configuration, reusing an account it has."""
        account_id = business.stripe_account_id
        if account_id is not None and has_merchant(business):
            return account_id
        if account_id is None:
            account_id = await self.gateway.create_connected_account(
                business_name=business.name,
                email=business.billing_email,
                url=get_settings().page_url(business.slug),
                configurations=("merchant",),
                idempotency_key=f"connected-account:{business.id}",
            )
            business.stripe_account_id = account_id
            cmd.record("connect.account_created", entity_type="business", entity_id=business.id)
        else:
            await self.gateway.add_merchant_configuration(
                account_id, business_name=business.name, email=business.billing_email
            )
            cmd.record("connect.merchant_added", entity_type="business", entity_id=business.id)
        await self.db.flush()
        # seed the KYC state from Stripe right away; the webhook keeps it in sync after
        apply_account_status(business, await self.gateway.get_account(account_id))
        return account_id

    async def refresh(self) -> ConnectStatus:
        """Read the account from Stripe now, for when its events are late or never came."""
        self._assert_admin()
        business = await self._business()
        if business.stripe_account_id is not None and await allow_action(
            business.id, "connect_refresh", connect_refresh_limiter
        ):
            locked = await self._locked_business()
            account = await self.gateway.get_account(business.stripe_account_id)
            apply_account_status(locked, account)
            await self.db.commit()
        return await self.status()

    async def status(self) -> ConnectStatus:
        self._assert_admin()
        business = await self._business()
        req = business.stripe_requirements

        def _due(key: str) -> list[str]:
            value = req.get(key)
            return [str(x) for x in value] if isinstance(value, list) else []

        reason = req.get("disabled_reason")
        deadline = req.get("current_deadline")
        available: int | None = None
        pending: int | None = None
        if business.stripe_account_id is not None and business.stripe_charges_enabled:
            try:
                balance = await self.gateway.get_balance(business.stripe_account_id, currency="cad")
                available, pending = balance.available_cents, balance.pending_cents
            except Exception:
                available = None
        return ConnectStatus(
            connected=merchant_account(business) is not None,
            charges_enabled=business.stripe_charges_enabled,
            payouts_enabled=business.stripe_payouts_enabled,
            kyc_status=kyc_status(business),
            disabled_reason=str(reason) if isinstance(reason, str) else None,
            currently_due=_due("currently_due"),
            past_due=_due("past_due"),
            requirement_errors=[
                RequirementErrorOut(requirement=e.requirement, code=e.code)
                for e in requirement_errors(business)
            ],
            current_deadline=datetime.fromtimestamp(deadline, UTC)
            if isinstance(deadline, int)
            else None,
            available_cents=available,
            pending_cents=pending,
        )

    async def payouts(self, after: str | None = None) -> PayoutsOut:
        self._assert_admin()
        business = await self._business()
        account = merchant_account(business)
        if account is None:
            return PayoutsOut()
        page = await self.gateway.list_payouts(account, after)
        try:
            payouts = [
                PayoutOut.model_validate(
                    {
                        "id": row["id"],
                        "amount_cents": row["amount"],
                        "arrival_at": _stamp(row, "arrival_date"),
                        "occurred_at": _stamp(row, "created"),
                        "status": row["status"],
                    }
                )
                for row in page.payouts
                if row.get("currency") == BUSINESS_CURRENCY.lower()
            ]
            return PayoutsOut(payouts=payouts, next_cursor=page.next_cursor)
        except (KeyError, ValueError, OverflowError, OSError) as exc:
            raise AppError(
                "invalid payout response", status_code=502, code="provider_unavailable"
            ) from exc

    async def payout_contents(self, payout_id: str, after: str | None) -> PayoutContentsOut:
        self._assert_admin()
        account = merchant_account(await self._business())
        if account is None:
            raise NotFound("connected account not found")
        if not (payout_id.startswith("po_") and payout_id[3:].isalnum() and payout_id.isascii()):
            raise NotFound("payout not found")
        payout = await self.gateway.retrieve(account, "payout", payout_id)
        if not isinstance(payout.get("automatic"), bool) or payout.get(
            "reconciliation_status"
        ) not in ("completed", "in_progress", "not_applicable"):
            raise AppError("invalid payout response", status_code=502, code="provider_unavailable")
        if (
            payout.get("automatic") is not True
            or payout.get("reconciliation_status") == "not_applicable"
        ):
            return PayoutContentsOut(status="unavailable")
        if payout.get("reconciliation_status") != "completed":
            return PayoutContentsOut(status="pending")
        page = await self.gateway.payout_transactions(account, payout_id, after)
        return PayoutContentsOut(
            status="available",
            next_cursor=page.next_cursor,
            transactions=[
                PayoutTransactionOut(
                    id=row.id,
                    source=row.source,
                    kind=row.type,
                    amount_cents=row.amount,
                    fee_cents=row.fee,
                    net_cents=row.net,
                    currency=row.currency.upper(),
                    occurred_at=datetime.fromtimestamp(row.created, UTC),
                )
                for row in page.transactions
                if row.currency == BUSINESS_CURRENCY.lower()
            ],
        )

    async def record_invoice_payment(
        self, invoice_id: str, data: InvoicePaymentIn, idempotency_key: str | None
    ) -> InvoicePaymentOut:
        """Record cash, a received e-Transfer or a cheque on an invoice, or charge a saved card."""
        self._assert_admin()
        business = await self._business()
        invoice = await self._invoice(invoice_id)
        if data.tendered_cents is not None and (
            data.method != "cash" or data.tendered_cents < data.amount_cents
        ):
            raise Unprocessable("cash handed over must cover the amount")
        if data.method == "card":
            return await self._charge_saved_card(business, invoice, data, idempotency_key)
        if data.payment_method_id is not None:
            raise Unprocessable("only a card payment takes a saved card")
        tz = zone(business.timezone)
        today = clock.today(tz)
        received = data.received_on or today
        if received > today:
            raise Unprocessable("a payment can't be received in the future")
        paid_at = (
            clock.now()
            if received == today
            else datetime.combine(received, time(12), tzinfo=tz).astimezone(UTC)
        )

        async def run(cmd: Command) -> InvoicePaymentOut:
            await _assert_room(self.db, invoice, data.amount_cents)
            await assert_parent_stock(self.db, self.biz, "invoice", invoice.id)
            payment = Payment(
                id=new_id("payment"),
                business_id=self.biz,
                client_id=invoice.client_id,
                kind="payment",
                invoice_id=invoice.id,
                amount_cents=data.amount_cents,
                currency=invoice.currency,
                method=data.method,
                provider="manual",
                reference=_blank_to_none(data.reference),
                note=_blank_to_none(data.note),
                tendered_cents=data.tendered_cents,
                status="succeeded",
                paid_at=paid_at,
            )
            self.db.add(payment)
            await self.db.flush()
            await ledger.post_payment(self.db, payment)
            await _sync_parent(self.db, payment)
            cmd.record("payment.record", entity_type="payment", entity_id=payment.id)
            if data.send_receipt:
                await queued_notifier(
                    self.db, self.biz, delivery_key("payment", payment.id)
                ).on_payment_succeeded(self.db, payment.id)
            return InvoicePaymentOut(
                payment_id=payment.id,
                status=payment.status,
                amount_cents=payment.amount_cents,
                change_cents=(data.tendered_cents or data.amount_cents) - data.amount_cents,
                balance_cents=await ledger.invoice_balance(self.db, invoice),
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment.record",
            run=run,
            response_model=InvoicePaymentOut,
            idempotency_key=idempotency_key,
            request={"invoice_id": invoice_id, "data": data},
        )

    async def _charge_saved_card(
        self,
        business: Business,
        invoice: Invoice,
        data: InvoicePaymentIn,
        idempotency_key: str | None,
    ) -> InvoicePaymentOut:
        if data.payment_method_id is None:
            raise Unprocessable("choose the saved card to charge")
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("set up card payments in Setup before taking payments")
        account_id = business.stripe_account_id
        client = await self._client(invoice.client_id)
        pm_ref = await self._saved_method_ref(data.payment_method_id, invoice.client_id)

        async def run(cmd: Command) -> InvoicePaymentOut:
            payment, client_secret = await open_card_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                invoice=invoice,
                client=client,
                amount=data.amount_cents,
                payment_method=pm_ref,
                idempotency_key=idempotency_key,
            )
            cmd.record("payment.intent", entity_type="payment", entity_id=payment.id)
            if data.send_receipt and payment.status == "succeeded":
                await queued_notifier(
                    self.db, self.biz, delivery_key("payment", payment.id)
                ).on_payment_succeeded(self.db, payment.id)
            return InvoicePaymentOut(
                payment_id=payment.id,
                status=payment.status,
                amount_cents=payment.amount_cents,
                change_cents=0,
                balance_cents=await ledger.invoice_balance(self.db, invoice),
                client_secret=client_secret,
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment.record",
            run=run,
            response_model=InvoicePaymentOut,
            idempotency_key=idempotency_key,
            request={"invoice_id": invoice.id, "data": data},
        )

    async def start_card_setup(
        self, client_id: str, idempotency_key: str | None = None
    ) -> SetupIntentOut:
        """A SetupIntent to save a client's card for later off-session charges (no charge now)."""
        self._assert_admin()
        business = await self._business()
        account_id = merchant_account(business)
        if account_id is None or not business.stripe_charges_enabled:
            raise Conflict("set up card payments in Setup before saving cards")
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
            request={"client_id": client_id},
        )

    async def create_pad_link(self, client_id: str) -> PaymentSetupLinkOut:
        self._assert_admin()
        business = await self._business()
        client = await self._client(client_id)
        account_id = merchant_account(business)
        if account_id is None or not business.stripe_charges_enabled:
            raise Conflict("set up payments before requesting bank authorization")
        await self.gateway.ensure_pad_capability(account_id)

        async def run(cmd: Command) -> PaymentSetupLinkOut:
            await self.db.execute(
                scoped(Client, self.biz).where(Client.id == client.id).with_for_update()
            )
            customer_id = await ensure_customer(self.db, self.gateway, account_id, client)
            now = clock.now()
            old = (
                (
                    await self.db.execute(
                        scoped(PaymentSetupLink, self.biz).where(
                            PaymentSetupLink.client_id == client.id,
                            PaymentSetupLink.revoked_at.is_(None),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for link in old:
                link.revoked_at = now
            token = secrets.token_urlsafe(32)
            link = PaymentSetupLink(
                id=new_id("payment_setup_link"),
                business_id=self.biz,
                client_id=client.id,
                account_id=account_id,
                customer_id=customer_id,
                purpose="pad_setup",
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                expires_at=now + timedelta(hours=24),
            )
            self.db.add(link)
            await self.db.flush()
            cmd.record("payment.pad_link", entity_type="client", entity_id=client.id)
            url = f"{get_settings().pay_base_url}/setup#token={token}"
            return PaymentSetupLinkOut(id=link.id, url=url, expires_at=link.expires_at)

        return await run_command(
            self.db,
            self.principal,
            action="payment.pad_link",
            run=run,
            response_model=PaymentSetupLinkOut,
        )

    async def revoke_pad_link(self, link_id: str) -> None:
        self._assert_admin()
        link = (
            await self.db.execute(
                scoped(PaymentSetupLink, self.biz).where(PaymentSetupLink.id == link_id)
            )
        ).scalar_one_or_none()
        if link is None:
            raise NotFound("authorization link not found")
        link.revoked_at = clock.now()
        await self.db.commit()

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
            billing = await self.db.scalar(
                scoped(Subscription, self.biz)
                .with_only_columns(Subscription.id)
                .where(Subscription.payment_method_id == pm.id, Subscription.status != "canceled")
                .limit(1)
            )
            if billing is not None:
                raise Conflict("a membership still bills this card", code="payment_method_in_use")
            await self.db.execute(
                update(Subscription)
                .where(Subscription.payment_method_id == pm.id)
                .values(payment_method_id=None)
            )
            await self.db.delete(pm)
            await self.db.flush()
            # the provider can't be undone, so it goes last, once the rows are sure to change
            if account_id is not None and provider_ref is not None:
                await self.gateway.detach_payment_method(account_id, payment_method_id=provider_ref)
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

        if pm.method == "bank_eft" and pm.mandate_status != "active":
            raise Conflict(
                "complete client bank authorization before making this method the default"
            )

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
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment_method.set_default",
            run=run,
            response_model=PaymentMethodOut,
        )

    async def refund_payment(
        self,
        payment_id: str,
        amount_cents: int | None,
        idempotency_key: str,
        reason: str | None = None,
        notify: bool = True,
    ) -> RefundOut:
        """Refund all or part of what's left on a payment, as a numbered credit note."""
        self._assert_admin()
        business = await self._business()
        payment = await self._payment(payment_id)
        if payment.kind == "refund":
            raise Conflict("a refund can't be refunded")
        if payment.status != "succeeded":
            raise RefundBlocked("only a succeeded payment can be refunded", "not_succeeded")
        if _disputed(payment):
            raise RefundBlocked(DISPUTED, "payment_disputed")
        by_hand = refunded_by_hand(payment)
        if not by_hand and (business.stripe_account_id is None or payment.provider_ref is None):
            raise Conflict("payment has no connected charge to refund")
        account_id = business.stripe_account_id

        async def run(cmd: Command) -> RefundOut:
            await self.db.execute(
                scoped(Payment, self.biz)
                .where(Payment.id == payment.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            # a dispute may have opened since the first read; it is current under the lock
            if _disputed(payment):
                raise RefundBlocked(DISPUTED, "payment_disputed")
            pending = (
                await self.db.execute(
                    scoped(Payment, self.biz)
                    .where(
                        Payment.parent_payment_id == payment.id,
                        Payment.kind == "refund",
                        Payment.status == "pending",
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if pending is not None:
                raise Conflict("a refund is still processing for this payment")
            whole_only = await self._whole_refund_only(payment)
            refunded = await _refunded_cents(self.db, payment)
            left = payment.amount_cents - refunded
            amount = left if amount_cents is None else amount_cents
            if left <= 0:
                raise RefundBlocked("this payment was already refunded", "already_refunded")
            if amount <= 0 or amount > left:
                raise Conflict("invalid refund amount")
            if whole_only and (refunded > 0 or amount != payment.amount_cents):
                raise RefundBlocked("this payment is refunded in full only", "whole_only")
            refund = await create_refund(
                self.db,
                self.gateway,
                payment,
                account_id,
                amount,
                key=f"refund_{payment.id}_{hash_token(idempotency_key)}",
                reason=reason,
                notify=notify,
            )
            cmd.record("payment.refund", entity_type="payment", entity_id=refund.id)
            return RefundOut(
                refund_id=refund.id, status=refund.status, credit_note=refund.credit_note
            )

        return await run_command(
            self.db,
            self.principal,
            action="payment.refund",
            run=run,
            response_model=RefundOut,
            idempotency_key=idempotency_key,
            request={"payment_id": payment_id, "amount_cents": amount_cents, "reason": reason},
        )

    async def refund_preview(self, payment_id: str, amount_cents: int | None) -> RefundPreview:
        """What a refund would reverse, before it is issued, from the same ledger maths."""
        self._assert_admin()
        payment = await self._payment(payment_id)
        if payment.kind == "refund":
            raise Conflict("a refund can't be refunded")
        refunded = await _refunded_cents(self.db, payment)
        left = max(0, payment.amount_cents - refunded)
        whole_only = False
        blocked: RefundBlock | None = None
        if payment.status != "succeeded":
            blocked = "not_succeeded"
        elif _disputed(payment):
            blocked = "payment_disputed"
        elif left <= 0:
            blocked = "already_refunded"
        else:
            try:
                whole_only = await self._whole_refund_only(payment)
            except RefundBlocked as exc:
                blocked = exc.block
            if whole_only and refunded > 0:
                blocked = "whole_only"
        amount = left if amount_cents is None or whole_only else amount_cents
        if blocked is None and (amount <= 0 or amount > left):
            raise Conflict("invalid refund amount")
        parts: dict[tuple[str, str], int] = {}
        if blocked is None:
            for leg in await ledger.refund_legs(self.db, payment, amount):
                key = (leg.category, leg.code)
                parts[key] = parts.get(key, 0) + leg.amount_cents
        return RefundPreview(
            payment_id=payment.id,
            amount_cents=payment.amount_cents,
            refunded_cents=refunded,
            left_cents=left,
            fee_cents=await ledger.payment_fee(self.db, payment),
            refund_cents=amount if blocked is None else 0,
            whole_only=whole_only,
            blocked=blocked,
            by_hand=refunded_by_hand(payment),
            next_credit_note=await next_credit_note(self.db, payment),
            parts=[
                RefundPart(category=category, code=code, cents=cents)
                for (category, code), cents in sorted(parts.items())
                if cents != 0
            ],
        )

    async def _whole_refund_only(self, payment: Payment) -> bool:
        """Whether this payment can only be refunded in full; raises when it can't be at all."""
        card = (
            await self.db.execute(
                scoped(GiftCard, self.biz)
                .where(GiftCard.payment_id == payment.id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if card is not None:
            if card.status == "expired":
                raise RefundBlocked("can't refund an expired gift card", "gift_card_expired")
            if await ledger.gift_card_balance(self.db, card) < card.initial_cents:
                raise RefundBlocked(
                    "can't refund a gift card that has already been partly redeemed",
                    "gift_card_redeemed",
                )
            return True
        pkg = (
            await self.db.execute(
                scoped(Package, self.biz).where(Package.payment_id == payment.id).with_for_update()
            )
        ).scalar_one_or_none()
        if pkg is not None:
            if pkg.status == "expired":
                raise RefundBlocked("can't refund an expired package", "package_expired")
            if await ledger.sessions_used(self.db, pkg) > 0:
                raise RefundBlocked(
                    "can't refund a package with sessions already used", "package_used"
                )
            return True
        if payment.booking_id is not None and payment.kind == "deposit":
            booking = await self.db.get(Booking, payment.booking_id)
            if booking is not None and booking.deposit_status == "forfeited":
                return True
            if booking is not None and await ledger.applied_invoices(self.db, booking):
                return True
        return False

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can manage payments"
        )

    async def _locked_business(self) -> Business:
        row = (
            await self.db.execute(
                select(Business)
                .where(Business.id == self.biz)
                .with_for_update(key_share=True)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("business not found")
        return row

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
                scoped(Client, self.biz, soft_delete=True)
                .where(Client.id == client_id)
                .with_for_update(read=True, key_share=True)
                .execution_options(populate_existing=True)
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


def _blank_to_none(value: str | None) -> str | None:
    return value.strip() or None if value is not None else None


async def invoice_credits(db: AsyncSession, invoice: Invoice) -> list[PublicCredit]:
    """What has paid the invoice down: each payment and applied deposit, oldest first."""
    rows = await db.execute(
        scoped(Entry, invoice.business_id)
        .add_columns(Payment.method)
        .join(Account, Account.id == Entry.account_id)
        .outerjoin(Payment, (Entry.source_type == "payment") & (Payment.id == Entry.source_id))
        .where(
            Entry.subject_type == "invoice",
            Entry.subject_id == invoice.id,
            Account.category == "receivable",
            Entry.amount_cents < 0,
            Entry.event.in_(("payment", "application")),
        )
        .order_by(Entry.occurred_at, Entry.id)
    )
    return [
        PublicCredit(
            kind="deposit" if entry.event == "application" else "payment",
            method=method,
            amount_cents=-entry.amount_cents,
            at=entry.occurred_at,
        )
        for entry, method in rows.tuples().all()
    ]


async def default_method_ref(db: AsyncSession, business_id: str, client_id: str) -> str | None:
    """The client's default active saved-card provider ref, or None if they have none on file."""
    pm = (
        await db.execute(
            scoped(PaymentMethod, business_id)
            .where(
                PaymentMethod.client_id == client_id,
                PaymentMethod.preferred.is_(True),
                (PaymentMethod.method != "bank_eft") | (PaymentMethod.mandate_status == "active"),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return pm.provider_ref if pm is not None else None


async def resolve_saved_method_ref(
    db: AsyncSession, business_id: str, payment_method_id: str | None, client_id: str
) -> str | None:
    """Resolve a saved-card selection (None, "default" or a card id) to its provider ref."""
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
    if pm.method == "bank_eft" and pm.mandate_status != "active":
        raise Conflict(
            "the client must complete bank authorization before this account can be charged"
        )
    return pm.provider_ref


async def assert_payable(db: AsyncSession, invoice: Invoice) -> int:
    """Check an invoice can take a payment and return its balance."""
    if invoice.status == "draft":
        raise Conflict("send the invoice before taking a payment")
    status, _ = await ledger.invoice_state(db, invoice)
    if status in ("paid", "void", "refunded"):
        raise Conflict(f"a {status} invoice can't be charged")
    balance = await ledger.invoice_balance(db, invoice)
    if balance <= 0:
        raise Conflict("nothing left to pay on this invoice")
    return balance


@dataclass(frozen=True)
class TipTerms:
    cents: int = 0
    split: tuple[tuple[str, int], ...] = ()

    def stored(self) -> list[dict[str, object]] | None:
        if self.cents <= 0:
            return None
        return [{"staff_id": staff_id, "cents": cents} for staff_id, cents in self.split]


NO_TIP = TipTerms()


def _tip_metadata(tip: TipTerms) -> dict[str, str]:
    """The tip on the intent, so a rebuilt row can post the same staff payables."""
    meta = {"tip_cents": str(tip.cents)}
    if tip.split:
        meta["tip_split"] = ",".join(f"{staff_id}:{cents}" for staff_id, cents in tip.split)
    return meta


def _tip_from_metadata(metadata: dict[str, object]) -> TipTerms:
    cents, split = metadata.get("tip_cents"), metadata.get("tip_split")
    parts = [part.split(":", 1) for part in split.split(",")] if isinstance(split, str) else []
    return TipTerms(
        cents=int(cents) if isinstance(cents, str) and cents.isdigit() else 0,
        split=tuple((staff_id, int(n)) for staff_id, n in parts if n.isdigit()),
    )


async def resolve_tip(
    db: AsyncSession,
    business_id: str,
    cents: int,
    split: list[TipShareIn] | None,
    lines: list[Line],
    fallback_staff_id: str,
) -> TipTerms:
    """Who a tip goes to: as given, else by line value to whoever did each line."""
    if cents <= 0:
        if split:
            raise Unprocessable("a tip split needs a tip")
        return NO_TIP
    if split:
        if sum(share.cents for share in split) != cents:
            raise Unprocessable("the tip split must add up to the tip")
        ids = {share.staff_id for share in split}
        found = await db.execute(
            scoped(Staff, business_id).with_only_columns(Staff.id).where(Staff.id.in_(ids))
        )
        if len(set(found.scalars().all())) != len(ids):
            raise NotFound("staff member not found")
        return TipTerms(cents, tuple((share.staff_id, share.cents) for share in split))
    weights: dict[str, int] = {}
    for line in lines:
        for staff_id, share in await worker_shares(db, line):
            if share > 0:
                weights[staff_id] = weights.get(staff_id, 0) + share
    if not weights:
        return TipTerms(cents, ((fallback_staff_id, cents),))
    parts = allocate(cents, list(weights.values()))
    return TipTerms(cents, tuple(zip(weights.keys(), parts, strict=True)))


async def _assert_room(db: AsyncSession, invoice: Invoice, amount: int) -> None:
    """Reject a charge that would overpay the invoice given pending payments; locks the invoice."""
    await db.execute(select(Invoice.id).where(Invoice.id == invoice.id).with_for_update())
    await db.refresh(invoice)
    balance = await assert_payable(db, invoice)
    if amount > balance:
        raise Conflict("that is more than the invoice still owes")
    pending = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount_cents - Payment.tip_cents), 0)).where(
                Payment.invoice_id == invoice.id,
                Payment.status == "pending",
                Payment.kind.in_(("payment", "deposit")),
            )
        )
    ).scalar_one()
    if amount > await ledger.invoice_balance(db, invoice) - int(pending):
        raise Conflict("this invoice already has a payment in progress", code="payment_in_progress")


async def _assert_order_room(
    db: AsyncSession, order: Order, amount: int, due: int | None = None
) -> None:
    """Reject a checkout while a payment is pending on the order; locks the order."""
    await db.execute(select(Order.id).where(Order.id == order.id).with_for_update())
    pending = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount_cents - Payment.tip_cents), 0)).where(
                Payment.order_id == order.id,
                Payment.status == "pending",
                Payment.kind.in_(("payment", "deposit")),
            )
        )
    ).scalar_one()
    if amount > (order.total_cents if due is None else due) - int(pending):
        raise Conflict("this order already has a checkout in progress")


async def cancel_order_intents(
    db: AsyncSession,
    gateway: PaymentGateway,
    account_id: str,
    order: Order,
    *,
    keep_tip: int | None = None,
) -> None:
    """Cancel the sale's open card intents, all of them or only those with a tip but keep_tip."""
    rows = await db.execute(
        scoped(Payment, order.business_id)
        .where(
            Payment.order_id == order.id,
            Payment.kind == "payment",
            Payment.provider == "stripe",
            Payment.status.in_(("pending", "failed")),
        )
        .with_for_update()
    )
    for payment in rows.scalars().all():
        if keep_tip is not None and payment.tip_cents == keep_tip:
            continue
        if payment.provider_ref is not None:
            try:
                await gateway.cancel_payment_intent(
                    account_id, payment_intent_id=payment.provider_ref
                )
            except AppError as exc:
                if payment.status == "pending":
                    raise Conflict(
                        "the card payment already went through", code="checkout_paid"
                    ) from exc
                continue  # a failed attempt Stripe already closed has nothing left to confirm
        payment.status = "canceled"
    await db.flush()


async def _order_attempt(db: AsyncSession, order: Order, amount: int) -> str:
    rows = await db.execute(
        scoped(Payment, order.business_id)
        .where(Payment.order_id == order.id, Payment.status.in_(("failed", "canceled")))
        .with_only_columns(func.count())
    )
    return f"{amount}_{rows.scalar_one()}"


async def _claim_order_room(
    db: AsyncSession,
    gateway: PaymentGateway,
    account_id: str,
    order: Order,
    intent_id: str,
    intent_amount: int,
    tip: TipTerms,
    due: int | None,
) -> None:
    """Supersede a checkout with another tip, then reserve the sale for the new intent."""
    try:
        await cancel_order_intents(db, gateway, account_id, order, keep_tip=tip.cents)
        await _assert_order_room(db, order, intent_amount - tip.cents, due)
    except Conflict:
        try:
            await gateway.cancel_payment_intent(account_id, payment_intent_id=intent_id)
        except AppError:
            _log.warning("could not cancel refused order intent %s", intent_id)
        raise


_STALE_INTENT_AGE = timedelta(hours=24)
_ABANDONED_INTENT_AGE = timedelta(hours=1)
_STALE_INTENT_BATCH = 200


async def run_cancel_stale_intents(db: AsyncSession, gateway: PaymentGateway, now: datetime) -> int:
    """Cancel card intents left unfinished: staff ones after a day, client ones after an hour."""
    desk_sale = select(Order.id).where(Order.id == Payment.order_id, Order.source == "pos")
    gift_card = select(GiftCard.id).where(GiftCard.payment_id == Payment.id)
    package = select(Package.id).where(Package.payment_id == Payment.id)
    staff_opened = and_(
        Payment.kind == "payment",
        desk_sale.exists() | gift_card.exists() | package.exists(),
        Payment.created_at <= now - _STALE_INTENT_AGE,
    )
    # an abandoned pay link or deposit form would otherwise hold the invoice or visit forever
    client_opened = and_(
        Payment.method == "card",
        Payment.invoice_id.is_not(None) | (Payment.kind == "deposit"),
        Payment.created_at <= now - _ABANDONED_INTENT_AGE,
    )
    rows = await db.execute(
        select(Payment, Business.stripe_account_id)
        .join(Business, Business.id == Payment.business_id)
        .where(
            Payment.provider == "stripe",
            Payment.status == "pending",
            Payment.provider_ref.is_not(None),
            Business.stripe_account_id.is_not(None),
            or_(staff_opened, client_opened),
        )
        # newest first, so an intent Stripe refuses to cancel never holds back the rest
        .order_by(Payment.created_at.desc(), Payment.id)
        .limit(_STALE_INTENT_BATCH)
        .with_for_update(of=Payment, skip_locked=True)
    )
    canceled = 0
    for payment, account_id in rows.tuples():
        if account_id is None or payment.provider_ref is None:
            continue
        try:
            await gateway.cancel_payment_intent(account_id, payment_intent_id=payment.provider_ref)
        except AppError:
            _log.warning("stale intent %s could not be canceled", payment.provider_ref)
            continue
        except Exception:
            _log.exception("canceling stale intent %s failed", payment.provider_ref)
            continue
        payment.status = "canceled"
        canceled += 1
    await db.commit()
    return canceled


async def ensure_customer(
    db: AsyncSession, gateway: PaymentGateway, account_id: str, client: Client
) -> str:
    """The client's Stripe Customer id, created once under a row lock."""
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
            account_id,
            name=locked.name,
            idempotency_key=f"customer:{locked.business_id}:{locked.id}",
        )
        await db.flush()
    assert locked.stripe_customer_id is not None
    return locked.stripe_customer_id


async def sync_customer(db: AsyncSession, gateway: PaymentGateway, client: Client) -> None:
    """Carry a client's new name to their Stripe Customer; the next edit retries a miss."""
    business = await db.get(Business, client.business_id)
    account_id = merchant_account(business) if business is not None else None
    if account_id is None or client.stripe_customer_id is None:
        return
    try:
        await gateway.update_customer(account_id, client.stripe_customer_id, name=client.name)
    except Exception:
        _log.warning("stripe customer update failed for client %s", client.id, exc_info=True)


async def ensure_subscription_price(
    db: AsyncSession,
    gateway: PaymentGateway,
    account_id: str,
    item: Item,
    *,
    interval_count: int,
    frequency: Frequency,
) -> str:
    """The item's Stripe recurring Price (tax included), replaced whenever its terms change."""
    tax = await tax_for_amount(db, item.business_id, item.price_cents, tax_class=item.tax_class)
    terms = PriceTerms(tax.total_cents, item.currency.upper(), interval_count, frequency)
    cached = item.stripe_price_id
    if cached is not None and await gateway.get_price(account_id, cached) == terms:
        return cached
    price_id = await gateway.create_price(
        account_id,
        amount_cents=terms.amount_cents,
        currency=item.currency,
        interval_count=interval_count,
        frequency=frequency,
        product_name=message(locale_for(), "stripe.subscription_product"),
    )
    item.stripe_price_id = price_id
    await db.flush()
    return price_id


type FeeMethod = Literal["card", "card_present", "acss_debit"]


def application_fee_cents(amount: int, method: FeeMethod, *, converted: bool) -> int:
    """Our fee, sized so Stripe's percentage plus ours stays within the ceiling."""
    settings = get_settings()
    stripe_bps = {
        "card": settings.stripe_card_bps,
        "card_present": settings.stripe_card_present_bps,
        "acss_debit": settings.stripe_acss_debit_bps,
    }[method]
    if converted:
        stripe_bps += settings.stripe_conversion_bps
    room = settings.platform_fee_ceiling_bps - stripe_bps
    return amount * max(0, min(room, settings.platform_fee_max_bps)) // 10000


def subscription_fee_percent(method: str) -> float:
    """The membership fee as Stripe's application_fee_percent, at a one-off charge's rate."""
    fee_method: FeeMethod = "acss_debit" if method == "bank_eft" else "card"
    return application_fee_cents(10000, fee_method, converted=False) / 100


async def charge_fee_cents(
    db: AsyncSession,
    gateway: PaymentGateway,
    account_id: str,
    business_id: str,
    amount: int,
    currency: str,
    payment_method: str | None,
) -> int:
    """The application fee for an online charge; every card is priced as a domestic card."""
    converted = ledger.supported(currency).lower() != SETTLEMENT_CURRENCY
    if await charge_method(db, business_id, payment_method) == "bank_eft":
        return application_fee_cents(amount, "acss_debit", converted=converted)
    return application_fee_cents(amount, "card", converted=converted)


async def charge_method(
    db: AsyncSession, business_id: str, payment_method: str | None
) -> Literal["card", "bank_eft"]:
    """How a charge is paid: a saved bank account debits by PAD, anything else is a card."""
    if payment_method is None:
        return "card"
    saved = await db.scalar(
        scoped(PaymentMethod, business_id)
        .with_only_columns(PaymentMethod.method)
        .where(PaymentMethod.provider_ref == payment_method)
    )
    return "bank_eft" if saved == "bank_eft" else "card"


async def pad_mandate(
    db: AsyncSession,
    gateway: PaymentGateway,
    account_id: str,
    business_id: str,
    payment_method: str | None,
) -> str | None:
    """The active mandate a saved bank account is debited under; Stripe needs it on the charge."""
    if payment_method is None:
        return None
    saved = await db.scalar(
        scoped(PaymentMethod, business_id).where(PaymentMethod.provider_ref == payment_method)
    )
    if saved is None or saved.method != "bank_eft":
        return None
    mandates = await db.scalars(
        scoped(PaymentSetupLink, business_id)
        .with_only_columns(PaymentSetupLink.mandate_ref)
        .where(
            PaymentSetupLink.client_id == saved.client_id,
            PaymentSetupLink.account_id == account_id,
            PaymentSetupLink.mandate_ref.is_not(None),
        )
        .order_by(PaymentSetupLink.id.desc())
    )
    for mandate_id in filter(None, mandates):
        mandate = await gateway.get_mandate(account_id, mandate_id)
        if mandate.payment_method_id == payment_method and mandate.status == "active":
            return mandate.id
    raise Conflict("the client must complete bank authorization before this account can be charged")


async def open_card_payment(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    invoice: Invoice,
    client: Client,
    amount: int,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
    tip: TipTerms | None = None,
    supersede: bool = False,
) -> tuple[Payment, str]:
    """Open a card PaymentIntent and pending Payment for an invoice; the caller commits."""
    await assert_parent_stock(db, business_id, "invoice", invoice.id)
    tip = tip or NO_TIP
    customer_id = await ensure_customer(db, gateway, account_id, client)
    if payment_method is not None:
        # Reserve room before charging a saved card, so a concurrent partial can't also charge.
        await _assert_room(db, invoice, amount - tip.cents)
    closed = await _closed_card_attempts(db, business_id, invoice.id, amount, tip.cents)
    attempt = idempotency_key or f"{amount}_{tip.cents}_{closed}"
    fee = await charge_fee_cents(
        db, gateway, account_id, business_id, amount, invoice.currency, payment_method
    )
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=invoice.currency,
        customer_id=customer_id,
        application_fee_cents=fee,
        metadata={"invoice_id": invoice.id, "business_id": business_id, **_tip_metadata(tip)},
        # A failed or canceled attempt bumps the key, so only a live attempt is ever replayed.
        idempotency_key=f"payment_{invoice.id}_{attempt}",
        payment_method=payment_method,
        mandate=await pad_mandate(db, gateway, account_id, business_id, payment_method),
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    if supersede:
        await _cancel_open_card_attempts(db, gateway, account_id, business_id, invoice.id)
    if (
        payment_method is None
    ):  # interactive: room is checked after the dedup (charge isn't yet made)
        await _assert_room(db, invoice, amount - tip.cents)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=client.id,
        kind="payment",
        invoice_id=invoice.id,
        amount_cents=amount,
        tip_cents=tip.cents,
        tip_split=tip.stored(),
        currency=invoice.currency,
        method=await charge_method(db, business_id, payment_method),
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


async def _closed_card_attempts(
    db: AsyncSession, business_id: str, invoice_id: str, amount: int, tip: int
) -> int:
    rows = await db.execute(
        scoped(Payment, business_id)
        .where(
            Payment.invoice_id == invoice_id,
            Payment.method == "card",
            Payment.amount_cents == amount,
            Payment.tip_cents == tip,
            Payment.status.in_(("failed", "canceled")),
        )
        .with_only_columns(func.count())
    )
    return int(rows.scalar_one())


async def _cancel_open_card_attempts(
    db: AsyncSession, gateway: PaymentGateway, account_id: str, business_id: str, invoice_id: str
) -> None:
    """Cancel the invoice's other open card intents; a declined one can still be confirmed."""
    await db.execute(select(Invoice.id).where(Invoice.id == invoice_id).with_for_update())
    rows = await db.execute(
        scoped(Payment, business_id).where(
            Payment.invoice_id == invoice_id,
            Payment.kind == "payment",
            Payment.method == "card",
            Payment.provider == "stripe",
            Payment.status.in_(("pending", "failed")),
        )
    )
    for payment in rows.scalars().all():
        if payment.provider_ref is not None:
            try:
                await gateway.cancel_payment_intent(
                    account_id, payment_intent_id=payment.provider_ref
                )
            except AppError:
                if payment.status == "pending":
                    raise
                continue  # a failed attempt Stripe already closed has nothing left to confirm
        payment.status = "canceled"
    await db.flush()


async def open_booking_deposit(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    booking: Booking,
    client: Client,
    amount: int,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
    supersede: bool = False,
) -> tuple[Payment, str]:
    """Open a deposit PaymentIntent and pending Payment for a booking; the caller commits."""
    customer_id = await ensure_customer(db, gateway, account_id, client)
    fee = await charge_fee_cents(
        db, gateway, account_id, business_id, amount, BUSINESS_CURRENCY, payment_method
    )
    attempt = idempotency_key or str(amount)
    if supersede and (closed := await _closed_deposit_attempts(db, business_id, booking.id)):
        attempt = f"{amount}_{closed}"
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=BUSINESS_CURRENCY,
        customer_id=customer_id,
        application_fee_cents=fee,
        metadata={"booking_id": booking.id, "business_id": business_id},
        idempotency_key=f"deposit_{booking.id}_{attempt}",
        payment_method=payment_method,
        mandate=await pad_mandate(db, gateway, account_id, business_id, payment_method),
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    if supersede and not await cancel_open_deposits(db, gateway, booking):
        await gateway.cancel_payment_intent(account_id, payment_intent_id=intent.id)
        raise Conflict("this deposit is already being paid", code="deposit_in_progress")
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=client.id,
        kind="deposit",
        booking_id=booking.id,
        amount_cents=amount,
        currency=BUSINESS_CURRENCY,
        method=await charge_method(db, business_id, payment_method),
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


async def _closed_deposit_attempts(db: AsyncSession, business_id: str, booking_id: str) -> int:
    rows = await db.execute(
        scoped(Payment, business_id)
        .where(
            Payment.booking_id == booking_id,
            Payment.kind == "deposit",
            Payment.status.in_(("failed", "canceled")),
        )
        .with_only_columns(func.count())
    )
    return int(rows.scalar_one())


async def open_entitlement_payment(
    db: AsyncSession,
    gateway: PaymentGateway,
    *,
    account_id: str,
    business_id: str,
    client: Client,
    amount: int,
    currency: str,
    entitlement_kind: str,
    entitlement_id: str,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[Payment, str]:
    """Open a PaymentIntent and pending Payment for a package or gift card; the caller commits."""
    customer_id = await ensure_customer(db, gateway, account_id, client)
    fee = await charge_fee_cents(
        db, gateway, account_id, business_id, amount, currency, payment_method
    )
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=currency,
        customer_id=customer_id,
        application_fee_cents=fee,
        metadata={f"{entitlement_kind}_id": entitlement_id, "business_id": business_id},
        # The entitlement id is new per request, so dedupe on the client's Idempotency-Key.
        idempotency_key=f"{entitlement_kind}_{idempotency_key or entitlement_id}",
        payment_method=payment_method,
        mandate=await pad_mandate(db, gateway, account_id, business_id, payment_method),
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
        method=await charge_method(db, business_id, payment_method),
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
    payment_method: str | None = None,
    idempotency_key: str | None = None,
    tip: TipTerms | None = None,
    due: int | None = None,
) -> tuple[Payment, str]:
    """Open a card PaymentIntent for a sale; the caller commits."""
    await assert_parent_stock(db, business_id, "order", order.id)
    tip = tip or NO_TIP
    customer_id = await ensure_customer(db, gateway, account_id, client) if client else None
    if payment_method is not None:
        await cancel_order_intents(db, gateway, account_id, order, keep_tip=tip.cents)
        await _assert_order_room(db, order, amount - tip.cents, due)
    fee = await charge_fee_cents(
        db, gateway, account_id, business_id, amount, order.currency, payment_method
    )
    attempt = idempotency_key or await _order_attempt(db, order, amount)
    intent = await gateway.create_payment_intent(
        account_id,
        amount_cents=amount,
        currency=order.currency,
        customer_id=customer_id,
        application_fee_cents=fee,
        metadata={"order_id": order.id, "business_id": business_id, **_tip_metadata(tip)},
        # A canceled attempt bumps the key, so a new checkout never replays a closed intent.
        idempotency_key=f"order_card_{order.id}_{attempt}",
        payment_method=payment_method,
        mandate=await pad_mandate(db, gateway, account_id, business_id, payment_method),
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing, intent.client_secret
    if payment_method is None:
        await _claim_order_room(db, gateway, account_id, order, intent.id, amount, tip, due)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=order.client_id,
        kind="payment",
        order_id=order.id,
        amount_cents=amount,
        tip_cents=tip.cents,
        tip_split=tip.stored(),
        currency=order.currency,
        method=await charge_method(db, business_id, payment_method),
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
    idempotency_key: str | None = None,
    tip: TipTerms | None = None,
    due: int | None = None,
) -> tuple[Payment, str]:
    """Open a Terminal PaymentIntent and pending Payment for a sale; the caller commits."""
    await assert_parent_stock(db, business_id, "order", order.id)
    tip = tip or NO_TIP
    # the card is read at the reader after the intent exists, so the domestic rate applies
    fee = application_fee_cents(
        amount,
        "card_present",
        converted=ledger.supported(order.currency).lower() != SETTLEMENT_CURRENCY,
    )
    customer_id = None
    if order.client_id is not None:
        client = await db.scalar(scoped(Client, business_id).where(Client.id == order.client_id))
        if client is None:
            raise NotFound("client not found")
        customer_id = await ensure_customer(db, gateway, account_id, client)
    attempt = idempotency_key or await _order_attempt(db, order, amount)
    intent = await gateway.create_terminal_payment_intent(
        account_id,
        amount_cents=amount,
        currency=order.currency,
        application_fee_cents=fee,
        metadata={"order_id": order.id, "business_id": business_id, **_tip_metadata(tip)},
        # A canceled attempt bumps the key, so a new checkout never replays a closed intent.
        idempotency_key=f"order_{order.id}_{attempt}",
        customer_id=customer_id,
    )
    existing = (
        await db.execute(select(Payment).where(Payment.provider_ref == intent.id))
    ).scalar_one_or_none()
    if existing is not None:  # a retry hit the same intent — don't mint a second pending row
        return existing, intent.client_secret
    await _claim_order_room(db, gateway, account_id, order, intent.id, amount, tip, due)
    payment = Payment(
        id=new_id("payment"),
        business_id=business_id,
        client_id=order.client_id,
        kind="payment",
        order_id=order.id,
        amount_cents=amount,
        tip_cents=tip.cents,
        tip_split=tip.stored(),
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


def refunded_by_hand(payment: Payment) -> bool:
    """Cash, cheques and e-Transfers go back outside Stripe; the refund only records it."""
    return payment.provider != "stripe"


def credit_note_number(document: str, n: int) -> str:
    """Credit notes count from 1 per invoice or sale: CN-1143-1, CN-S-1044-2."""
    return f"CN-{document}-{n}"


async def _credit_document(db: AsyncSession, payment: Payment) -> str:
    if payment.invoice_id is not None:
        invoice = await db.get(Invoice, payment.invoice_id)
        if invoice is not None and invoice.number is not None:
            return str(invoice.number)
    if payment.order_id is not None:
        order = await db.get(Order, payment.order_id)
        if order is not None and order.number is not None:
            return f"S-{order.number}"
    return f"P-{payment.id[-6:].upper()}"


async def create_refund(
    db: AsyncSession,
    gateway: PaymentGateway,
    payment: Payment,
    account_id: str | None,
    amount: int,
    *,
    key: str,
    reason: str | None = None,
    notify: bool = True,
    return_fee: bool = False,
) -> Payment:
    status: PaymentStatus = "succeeded"
    provider: PaymentProvider = "manual"
    reference: str | None = None
    if not refunded_by_hand(payment):
        if account_id is None or payment.provider_ref is None:
            raise Conflict("payment has no connected charge to refund")
        result = await gateway.refund(
            account_id,
            payment_intent_id=payment.provider_ref,
            amount_cents=amount,
            idempotency_key=key,
            refund_application_fee=return_fee,
        )
        status, provider, reference = refund_status(result.status), "stripe", result.id
        existing = await db.scalar(
            scoped(Payment, payment.business_id).where(
                Payment.provider_ref == reference, Payment.kind == "refund"
            )
        )
        if existing is not None:
            if existing.parent_payment_id != payment.id or existing.amount_cents != amount:
                raise Conflict("refund does not match the original payment")
            return existing
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
        provider=provider,
        provider_ref=reference,
        status=status,
        paid_at=clock.now() if status == "succeeded" else None,
        reason=reason,
        refund_notify=notify,
        credit_note=await next_credit_note(db, payment) if status == "succeeded" else None,
    )
    db.add(refund)
    await db.flush()
    if status == "succeeded":
        await _apply_refund(db, refund, payment)
    return refund


async def next_credit_note(db: AsyncSession, payment: Payment) -> str:
    """The number the next refund against this payment's invoice or sale gets."""
    document = await _credit_document(db, payment)
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"credit:{payment.business_id}:{document}", 0)
            )
        )
    )
    if payment.invoice_id is not None:
        same = Payment.invoice_id == payment.invoice_id
    elif payment.order_id is not None:
        same = Payment.order_id == payment.order_id
    else:
        same = Payment.parent_payment_id == payment.id
    issued = (
        await db.execute(
            scoped(Payment, payment.business_id)
            .with_only_columns(
                func.coalesce(
                    func.max(cast(func.split_part(Payment.credit_note, "-", -1), Integer)), 0
                )
            )
            .where(same, Payment.kind == "refund", Payment.credit_note.is_not(None))
        )
    ).scalar_one()
    return credit_note_number(await _credit_document(db, payment), int(issued) + 1)


async def process_stripe_event(
    db: AsyncSession,
    gateway: PaymentGateway,
    payload: bytes,
    signature: str,
) -> None:
    """Verify, dedupe and apply a Stripe webhook, queueing its client notice in the same commit."""
    await apply_stripe_event(db, gateway, gateway.verify_webhook(payload, signature))


async def apply_stripe_event(
    db: AsyncSession,
    gateway: PaymentGateway,
    event: GatewayEvent,
) -> None:
    if not event.thin and event.api_version != STRIPE_API_VERSION:
        _log.warning(
            "rejected Stripe event %s (%s) rendered at API version %s; handlers parse %s",
            event.id,
            event.type,
            event.api_version,
            STRIPE_API_VERSION,
        )
        await _keep_unapplied(db, event)
        raise WebhookVersionError(str(event.api_version))
    record = await db.scalar(select(Webhook).where(Webhook.id == event.id).with_for_update())
    if record is not None and record.status != "failed":
        return
    if record is None:
        record = Webhook(
            id=event.id, provider="stripe", event=event.type, payload=event.data, status="pending"
        )
        db.add(record)
    else:
        record.status = "pending"
    try:
        async with transaction(db):
            outcome = await _dispatch(db, gateway, event)
            if outcome is not None and _still_news(outcome, event.created):
                await queue_payment_outcome(db, outcome)
            record.status = "processed"
            record.processed_at = clock.now()
            record.payload = None
    except Exception as exc:
        if _lost_event_race(exc):
            return
        if isinstance(exc, AppError) and exc.code == "retry_later":
            _log.info("stripe webhook %s (%s) deferred: %s", event.id, event.type, exc)
            await _keep_unapplied(db, event)
            raise
        await record_failed_delivery(db, event, exc)
        raise


def _lost_event_race(exc: Exception) -> bool:
    """A concurrent delivery of the same event won the race on the webhooks primary key."""
    return isinstance(exc, IntegrityError) and "webhooks_pkey" in str(exc.orig)


async def record_failed_delivery(db: AsyncSession, event: GatewayEvent, exc: Exception) -> None:
    """A delivery that raised keeps a failed row of its own, so dead events are visible."""
    _log.error("stripe webhook %s (%s) failed: %s", event.id, event.type, exc)
    await _keep_unapplied(db, event)


ACCOUNT_CLOSED = "v2.core.account.closed"
_OUR_VOID = "expired_order"  # we refund it in full and return our platform fee
_UNAPPLIED = "unapplied_payment"  # it reached an invoice that no longer owed it; refunded in full
_REPLAY_WINDOW = timedelta(days=7)
_REPLAY_PER_ACCOUNT = 100
_REPLAY_PER_RUN = 500
_REPLAYED: dict[str, StripeResource] = {
    "payment_intent": "payment_intent",
    "refund": "refund",
    "dispute": "dispute",
    "payout": "payout",
    "invoice": "invoice",
    "subscription": "subscription",
    "setup_intent": "setup_intent",
    "mandate": "mandate",
    "payment_method": "payment_method",
}


def _closed(business: Business) -> bool:
    return business.stripe_requirements.get("disabled_reason") == "closed"


async def run_replay_missed_events(db: AsyncSession, gateway: PaymentGateway) -> int:
    """Apply events Stripe couldn't deliver, from each object's current state at our version."""
    connected = [
        b
        for b in await db.scalars(
            select(Business).where(Business.stripe_account_id.isnot(None)).order_by(Business.id)
        )
        if not _closed(b)
    ]
    for business in connected:
        if merchant_account(business) is not None and kyc_status(business) != "enabled":
            await _resync_account(db, gateway, business)
    accounts: list[str | None] = [None, *(b.stripe_account_id for b in connected)]
    since, budget, applied = clock.now() - _REPLAY_WINDOW, _REPLAY_PER_RUN, 0
    for account in accounts:
        if budget <= 0:
            break
        try:
            missed = await gateway.undelivered_events(
                account, since=since, limit=_REPLAY_PER_ACCOUNT
            )
        except Exception:
            _log.exception("listing undelivered stripe events failed for %s", account)
            continue
        for event in missed:
            if budget <= 0:
                break
            if not await _awaits_replay(db, event):
                continue  # already applied or not ours to apply, so it costs no budget
            budget -= 1
            applied += await _replay(db, gateway, event)
    return applied


async def _awaits_replay(db: AsyncSession, missed: MissedEvent) -> bool:
    wanted = PLAN_EVENTS if missed.account is None else PAYMENT_EVENTS
    if missed.type not in wanted or missed.object_type not in _REPLAYED:
        return False
    applied = await db.scalar(
        select(Webhook.id).where(Webhook.id == missed.id, Webhook.status == "processed")
    )
    return applied is None


async def _locked_by_account(db: AsyncSession, account_id: str) -> Business | None:
    """The account's business, locked so an older read of it never lands after a newer one."""
    return await db.scalar(
        select(Business)
        .where(Business.stripe_account_id == account_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )


async def _resync_account(db: AsyncSession, gateway: PaymentGateway, business: Business) -> None:
    """Re-read an account from Stripe: thin account events can't be listed as undelivered."""
    assert business.stripe_account_id is not None
    try:
        locked = await _locked_by_account(db, business.stripe_account_id)
        if locked is not None:
            apply_account_status(locked, await gateway.get_account(business.stripe_account_id))
        await db.commit()
    except Exception:
        await db.rollback()
        _log.warning("re-reading stripe account %s failed", business.stripe_account_id)


async def _replay(db: AsyncSession, gateway: PaymentGateway, missed: MissedEvent) -> int:
    resource = _REPLAYED[missed.object_type]
    try:
        current = await gateway.retrieve(missed.account, resource, missed.object_id)
        event_type = _type_for_state(missed.type, current)
        if event_type is None:
            return 0
        event = GatewayEvent(
            id=missed.id,
            type=event_type,
            data=current,
            account=missed.account,
            created=missed.created,
            api_version=STRIPE_API_VERSION,
        )
        await apply_stripe_event(db, gateway, event)
    except AppError as exc:
        if exc.code != "retry_later":
            _log.warning("replaying stripe event %s failed: %s", missed.id, exc)
        return 0
    except Exception:
        _log.exception("replaying stripe event %s failed", missed.id)
        return 0
    return 1


def _type_for_state(event_type: str, current: dict[str, object]) -> str | None:
    """The event an object's current state stands for, so a replay never applies stale news."""
    status = current.get("status")
    if event_type.startswith("payment_intent."):
        if status in ("succeeded", "canceled"):
            return f"payment_intent.{status}"
        failed = status == "requires_payment_method" and current.get("last_payment_error")
        return "payment_intent.payment_failed" if failed else None
    if event_type.startswith("payout."):
        return f"payout.{status}" if status in ("paid", "failed", "canceled") else "payout.created"
    if event_type.startswith("setup_intent."):
        if status == "succeeded":
            return "setup_intent.succeeded"
        failed = status == "requires_payment_method" and current.get("last_setup_error")
        return "setup_intent.setup_failed" if failed else None
    return event_type


async def _keep_unapplied(db: AsyncSession, event: GatewayEvent) -> None:
    """Hold an event we didn't apply, with its payload, so it outlives Stripe's retries."""
    now = clock.now()
    await db.execute(
        insert(Webhook)
        .values(
            id=event.id,
            provider="stripe",
            event=event.type,
            payload=event.data,
            status="failed",
            processed_at=now,
        )
        .on_conflict_do_update(
            index_elements=["id"],
            set_={"status": "failed", "processed_at": now},
            where=(Webhook.status != "processed"),
        )
    )
    await db.commit()


async def _update_payment_method(
    db: AsyncSession, account_id: str | None, data: dict[str, object]
) -> None:
    """Stripe auto-updated a saved card (a reissue or a new expiry); refresh what we show of it."""
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
    if isinstance(card.get("exp_month"), int):
        pm.exp_month = card["exp_month"]
    if isinstance(card.get("exp_year"), int):
        pm.exp_year = card["exp_year"]
    await db.flush()


def refund_status(status: object) -> PaymentStatus:
    match status:
        case str("succeeded" | "failed" | "canceled" as terminal):
            return terminal
        case _:
            return "pending"


async def _reconcile_refund(
    db: AsyncSession, data: dict[str, object], account_id: str | None
) -> WebhookOutcome | None:
    refund_id, intent, amount = data.get("id"), data.get("payment_intent"), data.get("amount")
    if not isinstance(refund_id, str) or not isinstance(intent, str):
        return None
    if not isinstance(amount, int) or amount <= 0:
        return None
    biz = await _business_for_account(db, account_id)
    if account_id is not None and biz is None:
        return None
    payment = (
        await db.execute(
            _stripe_payments(biz)
            .where(Payment.provider_ref == intent, Payment.kind != "refund")
            .with_for_update()
        )
    ).scalar_one_or_none()
    if payment is not None and payment.status == "pending":
        raise AppError("refunded charge not settled yet", status_code=503, code="retry_later")
    if payment is None or payment.status != "succeeded":
        return None
    status = refund_status(data.get("status"))
    refund = (
        await db.execute(
            scoped(Payment, payment.business_id)
            .where(Payment.provider_ref == refund_id, Payment.kind == "refund")
            .with_for_update()
        )
    ).scalar_one_or_none()
    if refund is not None:
        if refund.parent_payment_id != payment.id or refund.amount_cents != amount:
            raise Conflict("refund does not match the original payment")
        if refund.status == "succeeded":
            if status in ("failed", "canceled"):
                refund.status = status
                await _unapply_refund(db, refund, payment)
                return WebhookOutcome("refund_failed", refund.id)
            return None
        if refund.status in ("failed", "canceled") and status == "pending":
            return None
        stalled = refund.status == "pending" and status in ("failed", "canceled")
        refund.status = status
        if stalled:
            # a refund that never reached the client still has to, so staff learn it failed
            await db.flush()
            return WebhookOutcome("refund_stalled", refund.id)
    else:
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
            status=status,
        )
        db.add(refund)
    if status != "succeeded":
        await db.flush()
        return None
    refund.paid_at = _stamp(data, "created") or clock.now()
    refund.credit_note = refund.credit_note or await next_credit_note(db, payment)
    await db.flush()
    await _apply_refund(db, refund, payment)
    return WebhookOutcome("refund", refund.id)


async def _record_dispute(
    db: AsyncSession, data: dict[str, object], account: str | None = None
) -> str | None:
    """A chargeback was opened — book the pulled funds + fee and return the disputed payment."""
    if _inquiry(data) or data.get("status") == "prevented":
        # no funds are withdrawn for an inquiry, nor for a dispute the card network prevented
        return None
    payment = await _disputed_payment(db, data, account)
    if payment is None:
        return None
    amount = data.get("amount")
    txns = data.get("balance_transactions")
    fee = sum(
        int(t["fee"])
        for t in (txns if isinstance(txns, list) else [])
        if isinstance(t, dict)
        and isinstance(t.get("fee"), int)
        and (not isinstance(t.get("amount"), int) or int(t["amount"]) < 0)
    )
    await ledger.post_dispute(
        db,
        payment,
        dispute_id=str(data.get("id")),
        amount=amount if isinstance(amount, int) else payment.amount_cents,
        fee=fee,
    )
    if payment.dispute_status in ("won", "lost"):
        return None
    _track_dispute(payment, data)
    reason = data.get("reason")
    payment.dispute_reason = reason if isinstance(reason, str) else None
    evidence = data.get("evidence_details")
    due = evidence.get("due_by") if isinstance(evidence, dict) else None
    payment.dispute_respond_by = datetime.fromtimestamp(due, UTC) if isinstance(due, int) else None
    await db.flush()
    return payment.id


def _track_dispute(payment: Payment, data: dict[str, object]) -> None:
    """Mirror Stripe's dispute status on the charge so the app can show the case."""
    if payment.dispute_status in ("won", "lost"):
        return
    status = data.get("status")
    match status:
        case str("won" | "lost" | "under_review" as settled):
            payment.dispute_status = settled
        case "needs_response":
            payment.dispute_status = "needs_response"
        case _:
            # a status we don't know withdrew nothing we booked, so it never blocks a refund
            _log.warning("dispute %s has status %s", data.get("id"), status)


async def _update_dispute(
    db: AsyncSession, data: dict[str, object], account: str | None = None
) -> str | None:
    """Track the case; an inquiry escalated to a chargeback is booked now, as the funds leave."""
    payment = await _disputed_payment(db, data, account)
    if payment is None:
        return None
    first = payment.dispute_status is None
    recorded = await _record_dispute(db, data, account)
    return recorded if first else None


DISPUTED = "a disputed payment can't be refunded unless the dispute is won"
DISPUTES = ("du_", "dp_")  # Stripe's dispute ids; older disputes carry dp_


def _disputed(payment: Payment) -> bool:
    return payment.dispute_status in ("needs_response", "under_review", "lost")


def _inquiry(data: dict[str, object]) -> bool:
    status = data.get("status")
    return isinstance(status, str) and status.startswith("warning_")


async def _close_dispute(
    db: AsyncSession, data: dict[str, object], account: str | None = None
) -> None:
    payment = await _disputed_payment(db, data, account)
    if payment is None:
        return
    await _record_dispute(db, data, account)
    if payment.dispute_status is not None:
        _track_dispute(payment, data)
        await db.flush()
    dispute_id, amount = str(data.get("id")), data.get("amount")
    if data.get("status") == "won":
        await ledger.close_dispute(db, payment, dispute_id, returned_fee=_returned_fee(data))
    elif data.get("status") == "lost":
        lost = amount if isinstance(amount, int) else payment.amount_cents
        await _give_back(
            db,
            payment,
            dispute_id,
            lambda: ledger.lose_dispute(db, payment, dispute_id=dispute_id, amount=lost),
        )
        back, back_net = _credits(data)
        await ledger.reinstate_dispute(db, payment, dispute_id, amount=back, net=back_net)
        if lost + await _refunded_cents(db, payment) >= payment.amount_cents:
            await _reverse_entitlement(db, payment)
        await _claw_back_package(db, payment)


def _credits(data: dict[str, object]) -> tuple[int, int]:
    """The amount and net of the dispute's positive balance transactions (funds reinstated)."""
    txns = data.get("balance_transactions")
    credits = [
        (int(t["amount"]), int(t["net"]))
        for t in (txns if isinstance(txns, list) else [])
        if isinstance(t, dict)
        and isinstance(t.get("amount"), int)
        and int(t["amount"]) > 0
        and isinstance(t.get("net"), int)
    ]
    return sum(amount for amount, _ in credits), sum(net for _, net in credits)


def _returned_fee(data: dict[str, object]) -> int:
    """The fee Stripe gave back with the reinstated funds (a negative fee on a credit)."""
    txns = data.get("balance_transactions")
    return -sum(
        int(t["fee"])
        for t in (txns if isinstance(txns, list) else [])
        if isinstance(t, dict)
        and isinstance(t.get("amount"), int)
        and int(t["amount"]) > 0
        and isinstance(t.get("fee"), int)
        and int(t["fee"]) < 0
    )


async def _refresh_account(
    db: AsyncSession, gateway: PaymentGateway, account_id: str | None, *, closed: bool = False
) -> None:
    """Mirror a connected account's current state after Stripe reports a change to it."""
    if account_id is None:
        return
    business = await _locked_by_account(db, account_id)
    if business is None:
        return
    try:
        apply_account_status(business, await gateway.get_account(account_id))
    except Exception:
        if not closed:
            raise
        # a closed account may no longer be readable; the event alone says it takes nothing
        _log.warning("closed stripe account %s could not be read", account_id, exc_info=True)
        business.stripe_charges_enabled = business.stripe_payouts_enabled = False
        business.stripe_requirements = {**business.stripe_requirements, "disabled_reason": "closed"}
    await db.flush()


async def _disputed_payment(
    db: AsyncSession, data: dict[str, object], account: str | None = None
) -> Payment | None:
    intent = data.get("payment_intent")
    if not isinstance(intent, str):
        return None
    owner = await _business_for_account(db, account)
    if account is not None and owner is None:
        return None
    return (
        await db.execute(
            _stripe_payments(owner)
            .where(Payment.provider_ref == intent, Payment.kind != "refund")
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _dispatch(
    db: AsyncSession, gateway: PaymentGateway, event: GatewayEvent
) -> WebhookOutcome | None:
    if event.type in ACCOUNT_EVENTS:
        closed = event.type == ACCOUNT_CLOSED
        await _refresh_account(db, gateway, event.account, closed=closed)
    elif event.account is None and event.type in PLAN_EVENTS:
        # a platform subscription bills the business itself; it is never a client membership
        await plans.apply_subscription_event(db, gateway, event)
    elif event.type == "payment_intent.succeeded":
        settled = await _settle_payment(
            db, gateway, event.data, account=event.account, occurred_at=event.created
        )
        if settled is None:
            return None
        if settled.gift_card_id is not None:
            return WebhookOutcome("gift_card_issued", settled.gift_card_id)
        return WebhookOutcome("payment", settled.payment_id)
    elif event.type == "payment_intent.payment_failed":
        failed = await _fail_payment(db, str(event.data.get("id")), account=event.account)
        return WebhookOutcome("payment_failed", failed) if failed is not None else None
    elif event.type == "payment_intent.canceled":
        await _fail_payment(db, str(event.data.get("id")), status="canceled", account=event.account)
    elif event.type in ("payout.created", "payout.paid"):
        await _record_payout(db, event.account, event.data, paid=event.type == "payout.paid")
    elif event.type in ("payout.failed", "payout.canceled"):
        await _fail_payout(db, event.account, event.data, event.created)
    elif event.type in ("setup_intent.succeeded", "setup_intent.setup_failed"):
        await _reconcile_pad_setup(db, gateway, event.account, str(event.data.get("id")))
    elif event.type == "mandate.updated":
        await _reconcile_pad_mandate(db, gateway, event.account, str(event.data.get("id")))
    elif event.type == "payment_method.attached":
        await _record_payment_method(db, event.account, event.data)
    elif event.type == "payment_method.automatically_updated":
        await _update_payment_method(db, event.account, event.data)
    elif event.type in ("refund.created", "refund.failed", "refund.updated"):
        return await _reconcile_refund(db, event.data, event.account)
    elif event.type == "charge.dispute.created" and _inquiry(event.data):
        asked = await _disputed_payment(db, event.data, event.account)
        if asked is not None and event.data.get("status") == "warning_needs_response":
            return WebhookOutcome("dispute_inquiry", asked.id)
    elif event.type == "charge.dispute.created":
        disputed = await _record_dispute(db, event.data, event.account)
        return WebhookOutcome("payment_disputed", disputed) if disputed is not None else None
    elif event.type in ("charge.dispute.updated", "charge.dispute.funds_withdrawn"):
        escalated = await _update_dispute(db, event.data, event.account)
        return WebhookOutcome("payment_disputed", escalated) if escalated is not None else None
    elif event.type in ("charge.dispute.closed", "charge.dispute.funds_reinstated"):
        await _close_dispute(db, event.data, event.account)
        if event.data.get("status") == "lost":
            await _end_disputed_membership(db, gateway, event.data, event.account)
    elif event.type == "customer.subscription.updated":
        ended = await _expire_subscription(db, gateway, event.data, event.account)
        return WebhookOutcome("subscription_canceled", ended) if ended is not None else None
    elif event.type == "customer.subscription.deleted":
        canceled = await _cancel_subscription(db, gateway, event.data, event.account)
        return WebhookOutcome("subscription_canceled", canceled) if canceled is not None else None
    elif event.type == "invoice.payment_succeeded":
        recorded = await _record_recurring_payment(db, gateway, event.data, event.account)
        return WebhookOutcome("payment", recorded) if recorded is not None else None
    elif event.type == "invoice.payment_failed":
        return await _subscription_past_due(db, gateway, event.data, event.account)
    return None


async def _settle_payment(
    db: AsyncSession,
    gateway: PaymentGateway,
    intent: dict[str, object],
    *,
    account: str | None = None,
    occurred_at: datetime | None = None,
) -> _Settled | None:
    intent_id = str(intent.get("id"))
    owner = await _business_for_account(db, account)
    payment = (
        (
            await db.execute(
                _stripe_payments(owner).where(
                    Payment.provider_ref == intent_id, Payment.provider == "stripe"
                )
            )
        ).scalar_one_or_none()
        if account is None or owner is not None
        else None
    )
    if payment is None:
        biz = _metadata_business(intent)
        if biz is None:
            return None
        if not await _owns_account(db, biz, account):
            _log.error("intent %s claims business %s from account %s", intent_id, biz, account)
            return None
        payment = await _payment_from_intent(db, intent)
        if payment is None:
            if _entitlement_purchase(intent) and _abandoned(intent):
                await _refund_orphan(db, gateway, intent, biz)
                return None
            _assert_not_ours(intent)
            return None
    order = None
    if payment.order_id is not None:
        order = await db.scalar(
            scoped(Order, payment.business_id)
            .where(Order.id == payment.order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    expired_order = order is not None and order.status == "void"
    if payment.status not in ("pending", "failed") and not (
        expired_order and payment.status == "canceled"
    ):
        return None
    if order is not None and order.source == "online" and not expired_order:
        try:
            await assert_parent_stock(db, payment.business_id, "order", order.id)
        except Conflict as exc:
            if exc.code != "out_of_stock":
                raise
            order.status, expired_order = "void", True
    unapplied = await _unapplied(db, payment)
    fees = await _fees(db, gateway, payment.business_id, intent_id)
    payment.status = "succeeded"
    payment.paid_at = occurred_at or clock.now()
    await db.flush()
    await ledger.post_payment(db, payment, available_at=fees.available_at)
    await ledger.post_fees(db, payment, fees)
    if unapplied:
        await _refund_late(
            db,
            gateway,
            payment,
            key=f"unapplied:{payment.id}",
            reason=_UNAPPLIED,
            action="payment.late_invoice_refund",
        )
        return None
    if expired_order:
        await _refund_late(
            db,
            gateway,
            payment,
            key=f"expired-order:{payment.id}",
            reason=_OUR_VOID,
            action="payment.late_order_refund",
        )
        return None

    await _sync_parent(db, payment)
    if payment.booking_id is not None and payment.kind == "deposit":
        await _settle_booking_deposit(db, gateway, payment.booking_id)
    gift_card_id = await _settle_entitlement(db, payment)
    return _Settled(payment.id, gift_card_id)


async def _unapplied(db: AsyncSession, payment: Payment) -> bool:
    """A card payment settling on an invoice that was voided or paid another way since."""
    if payment.invoice_id is None or payment.kind != "payment":
        return False
    invoice = await db.scalar(
        scoped(Invoice, payment.business_id)
        .where(Invoice.id == payment.invoice_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if invoice is None:
        return False
    status, _ = await ledger.invoice_state(db, invoice)
    if status in ("void", "refunded"):
        return True
    return payment.amount_cents - payment.tip_cents > await ledger.invoice_balance(db, invoice)


async def _refund_late(
    db: AsyncSession,
    gateway: PaymentGateway,
    payment: Payment,
    *,
    key: str,
    reason: str,
    action: str,
) -> None:
    """Give back in full a charge that settled after what it paid for was gone."""
    account_id = await db.scalar(
        select(Business.stripe_account_id).where(Business.id == payment.business_id)
    )
    refund = await create_refund(
        db,
        gateway,
        payment,
        account_id,
        payment.amount_cents,
        key=key,
        reason=reason,
        return_fee=True,
    )
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=payment.business_id,
            action=action,
            entity_type="payment",
            entity_id=payment.id,
            changes={"refund_id": refund.id, "status": refund.status},
        )
    )
    await db.flush()


async def _fees(
    db: AsyncSession, gateway: PaymentGateway, business_id: str, intent_id: str
) -> ChargeFees:
    account_id = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == business_id))
    ).scalar_one_or_none()
    if account_id is None:
        return ChargeFees(0, 0, None)
    fees = await gateway.get_payment_fees(account_id, payment_intent_id=intent_id)
    if fees is None:  # booking the charge gross would never be corrected; let Stripe retry
        raise AppError("charge fees not visible yet", status_code=503, code="retry_later")
    return fees


async def _give_back(
    db: AsyncSession, payment: Payment, key: str, book: Callable[[], Awaitable[None]]
) -> None:
    """Book money leaving a payment; a deposit first takes back its forfeit and applications."""
    booking_id = payment.booking_id if payment.kind == "deposit" else None
    reopened = await _reverse_booking_deposit(db, booking_id, key) if booking_id else []
    await book()
    if booking_id:
        await _booking_deposit_refunded(db, booking_id)
    for invoice_id in reopened:
        await sync_invoice(db, invoice_id)
    await _sync_parent(db, payment)


async def _apply_refund(db: AsyncSession, refund: Payment, payment: Payment) -> None:
    """Book a refund and roll its parent back."""
    await _give_back(
        db,
        payment,
        refund.id,
        lambda: ledger.post_refund(db, refund, payment, unapplied=refund.reason == _UNAPPLIED),
    )
    if refund.reason in (_OUR_VOID, _UNAPPLIED):
        await ledger.post_fee_return(db, payment, refund.id)
    if await _fully_refunded(db, payment):
        await _reverse_entitlement(db, payment)
    await _claw_back_package(db, payment)
    await queued_notifier(db, refund.business_id, delivery_key("refund", refund.id)).on_refund(
        db, refund.id
    )


async def _unapply_refund(db: AsyncSession, refund: Payment, payment: Payment) -> None:
    """Stripe failed a refund it had marked succeeded: the money is back, so is the credit."""
    await db.flush()
    await cancel_returned_tips(db, refund, payment)
    await ledger.reverse_refund(db, refund, payment)
    returned = await ledger.journal_for(db, payment.business_id, f"fee_return:{refund.id}")
    if returned is not None:
        await ledger.reverse(
            db, payment.business_id, returned, ref=f"fee_return:{refund.id}:failed"
        )
    if payment.booking_id is not None and payment.kind == "deposit":
        reapplied = await _restore_booking_deposit(db, payment.booking_id, refund.id)
        if reapplied is not None:
            await sync_invoice(db, reapplied)
    await _sync_parent(db, payment)
    if not await _fully_refunded(db, payment):
        await _restore_entitlement(db, payment)
    await _claw_back_package(db, payment)


async def _sync_parent(db: AsyncSession, payment: Payment) -> None:
    if payment.invoice_id is not None:
        await sync_invoice(db, payment.invoice_id)
    if payment.order_id is not None:
        await sync_order(db, payment.order_id)


async def _settle_entitlement(db: AsyncSession, payment: Payment) -> str | None:
    """Activate a pending package or gift card once its purchase settles; returns a gift card id."""
    if payment.invoice_id or payment.order_id or payment.booking_id:
        return None
    # deferred: entitlements imports this module's builders, so a top-level import would cycle.
    from clientbridge.services import entitlements

    await entitlements.activate_purchased_package(db, payment.business_id, payment.id)
    return await entitlements.activate_purchased_gift_card(db, payment.business_id, payment.id)


async def _settle_booking_deposit(
    db: AsyncSession, gateway: PaymentGateway, booking_id: str
) -> None:
    from clientbridge.services import bookings  # deferred: booking imports this module

    invoice_id = await bookings.settle_deposit(db, gateway, booking_id)
    if invoice_id is not None:
        await sync_invoice(db, invoice_id)


async def _reverse_booking_deposit(db: AsyncSession, booking_id: str, key: str) -> list[str]:
    from clientbridge.services import bookings  # deferred: booking imports this module

    return await bookings.reverse_deposit(db, booking_id, key)


async def _restore_booking_deposit(db: AsyncSession, booking_id: str, key: str) -> str | None:
    from clientbridge.services import bookings  # deferred: booking imports this module

    return await bookings.restore_deposit(db, booking_id, key)


async def _booking_deposit_refunded(db: AsyncSession, booking_id: str) -> None:
    from clientbridge.services import bookings  # deferred: booking imports this module

    await bookings.deposit_refunded(db, booking_id)


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
    # deferred: entitlements imports this module's builders, so a top-level import would cycle.
    from clientbridge.services import entitlements

    await entitlements.void_purchased_package(db, payment.business_id, payment.id)
    await entitlements.void_purchased_gift_card(db, payment.business_id, payment.id)


async def _claw_back_package(db: AsyncSession, payment: Payment) -> None:
    if payment.invoice_id or payment.order_id or payment.booking_id:
        return
    await claw_back_purchase(db, payment)


async def _restore_entitlement(db: AsyncSession, payment: Payment) -> None:
    """Reactivate a package/gift card voided by a refund that then failed."""
    if payment.invoice_id or payment.order_id or payment.booking_id:
        return
    # deferred: entitlements imports this module's builders, so a top-level import would cycle.
    from clientbridge.services import entitlements

    await entitlements.restore_purchased_package(db, payment.business_id, payment.id)
    await entitlements.restore_purchased_gift_card(db, payment.business_id, payment.id)


async def sync_order(db: AsyncSession, order_id: str) -> None:
    order = await db.get(Order, order_id)
    if order is None:
        return
    status, paid_at = await ledger.order_state(db, order)
    await sync_parent_stock(db, order.business_id, "order", order.id, status)
    if status == "paid":
        await ensure_order_earning(db, order)
        await ensure_earnings(db, order, occurred_at=paid_at)
    else:
        await reverse_order_earning(db, order)
        if order.paid_at is not None:
            await reverse_earnings(db, order)
        if status in ("refunded", "void"):
            await ledger.reverse_order_redemptions(db, order)
    await claw_back(db, order)
    await _sync_visits(db, order, status, paid_at)
    order.paid_at = (order.paid_at or paid_at) if paid_at else None
    if order.source == "online":
        if status == "paid" and order.pickup_status is None and order.picked_up_at is None:
            order.pickup_status = "unfulfilled"
        elif status in ("refunded", "void") and order.pickup_status != "picked_up":
            order.pickup_status = None
        await db.flush()


async def complete_when_done(db: AsyncSession, slot: Slot) -> None:
    """Mark the slot completed once none of its bookings is still pending or confirmed."""
    await db.flush()
    left = await db.scalar(
        select(func.count(Booking.id)).where(
            Booking.slot_id == slot.id,
            Booking.status.in_(("pending", "confirmed")),
            Booking.deleted_at.is_(None),
        )
    )
    if not left:
        slot.status = "completed"


async def close_settled_visit(
    db: AsyncSession, booking: Booking, action: str, **changes: str
) -> None:
    """A confirmed visit that has started and is now paid or billed is done."""
    await db.execute(
        select(Booking)
        .where(Booking.id == booking.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    slot = await db.get(Slot, booking.slot_id)
    if booking.status != "confirmed" or slot is None or slot.starts_at > clock.now():
        return
    booking.status, booking.completed_at = "completed", clock.now()
    if booking.deposit_status == "pending":
        booking.deposit_status = "none"
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=booking.business_id,
            action=action,
            entity_type="booking",
            entity_id=booking.id,
            changes=dict(changes),
        )
    )
    await complete_when_done(db, slot)


async def _sync_visits(
    db: AsyncSession, order: Order, status: str, paid_at: datetime | None
) -> None:
    """Visits on a paid sale read as charged, and a confirmed one that has started is done."""
    rows = await db.execute(scoped(Booking, order.business_id).where(Booking.order_id == order.id))
    for booking in rows.scalars().all():
        booking.charged_at = (paid_at or clock.now()) if status == "paid" else None
        if status == "paid":
            await close_settled_visit(db, booking, "booking.complete_on_payment", order_id=order.id)
        if (
            status == "paid"
            and booking.deposit_status == "collected"
            and await ledger.deposit_held(db, booking) == 0
        ):
            booking.deposit_status = "applied"
    await db.flush()


async def _payment_from_intent(db: AsyncSession, intent: dict[str, object]) -> Payment | None:
    """Rebuild the pending row for our own intent whose command never committed."""
    metadata = intent.get("metadata")
    if not isinstance(metadata, dict):
        return None
    biz, amount, currency = (
        metadata.get("business_id"),
        intent.get("amount"),
        intent.get("currency"),
    )
    if not isinstance(biz, str) or not isinstance(amount, int) or amount <= 0:
        return None
    tip = _tip_from_metadata(metadata)
    kind: PaymentKind = "payment"
    client_id: str | None
    target: dict[str, str | None] = {"invoice_id": None, "order_id": None, "booking_id": None}
    if isinstance(invoice_id := metadata.get("invoice_id"), str):
        invoice = (
            await db.execute(scoped(Invoice, biz).where(Invoice.id == invoice_id))
        ).scalar_one_or_none()
        if invoice is None:
            return None
        target["invoice_id"], client_id = invoice.id, invoice.client_id
    elif isinstance(order_id := metadata.get("order_id"), str):
        order = (
            await db.execute(scoped(Order, biz).where(Order.id == order_id))
        ).scalar_one_or_none()
        if order is None:
            return None
        target["order_id"], client_id = order.id, order.client_id
    elif isinstance(booking_id := metadata.get("booking_id"), str):
        booking = (
            await db.execute(scoped(Booking, biz).where(Booking.id == booking_id))
        ).scalar_one_or_none()
        if booking is None:
            return None
        target["booking_id"], client_id, kind = booking.id, booking.client_id, "deposit"
    else:
        return None  # a package or gift card purchase has no row to settle into
    payment = Payment(
        id=new_id("payment"),
        business_id=biz,
        client_id=client_id,
        kind=kind,
        amount_cents=amount,
        tip_cents=tip.cents,
        tip_split=tip.stored(),
        currency=currency.upper() if isinstance(currency, str) else BUSINESS_CURRENCY,
        method="card",
        provider="stripe",
        provider_ref=str(intent.get("id")),
        status="pending",
        **target,
    )
    db.add(payment)
    await db.flush()
    return payment


def _assert_not_ours(intent: dict[str, object]) -> None:
    """An intent whose command hasn't committed yet must be retried by Stripe."""
    if _metadata_business(intent) is not None:
        raise AppError("payment not recorded yet", status_code=503, code="retry_later")


def _metadata_business(intent: dict[str, object]) -> str | None:
    metadata = intent.get("metadata")
    biz = metadata.get("business_id") if isinstance(metadata, dict) else None
    return biz if isinstance(biz, str) and biz else None


def _abandoned(intent: dict[str, object]) -> bool:
    """Past the grace window its purchase command would have committed in, if it ever will."""
    opened = _stamp(intent, "created")
    return opened is not None and clock.now() - opened > _ORPHAN_GRACE


def _entitlement_purchase(intent: dict[str, object]) -> bool:
    metadata = intent.get("metadata")
    return isinstance(metadata, dict) and any(
        isinstance(metadata.get(key), str) for key in ("gift_card_id", "package_id")
    )


async def _owns_account(db: AsyncSession, business_id: str, account: str | None) -> bool:
    if account is None:
        return True
    owned = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == business_id))
    ).scalar_one_or_none()
    return owned == account


async def _refund_orphan(
    db: AsyncSession, gateway: PaymentGateway, intent: dict[str, object], business_id: str
) -> None:
    """An off-session purchase whose command never committed: nothing to activate, so refund."""
    intent_id, amount = str(intent.get("id")), intent.get("amount")
    account_id = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == business_id))
    ).scalar_one_or_none()
    if account_id is None or not isinstance(amount, int) or amount <= 0:
        return
    refunded = await db.execute(
        scoped(Audit, business_id)
        .with_only_columns(Audit.id)
        .where(
            Audit.entity_type == "payment_intent",
            Audit.entity_id == intent_id,
            Audit.action == "payment.orphan_refunded",
        )
    )
    if refunded.scalar_one_or_none() is not None:
        return
    await gateway.refund(
        account_id,
        payment_intent_id=intent_id,
        amount_cents=amount,
        idempotency_key=f"orphan_{intent_id}",
        refund_application_fee=True,  # the orphan is our fault, so the platform fee goes back too
    )
    _log.error("payment.orphan_refunded business=%s %s %s", business_id, intent_id, amount)
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=business_id,
            action="payment.orphan_refunded",
            entity_type="payment_intent",
            entity_id=intent_id,
            changes={"amount_cents": amount, "metadata": intent.get("metadata")},
        )
    )
    await db.flush()


async def _fail_payment(
    db: AsyncSession,
    intent_id: str,
    *,
    status: PaymentStatus = "failed",
    account: str | None = None,
) -> str | None:
    """Flag a pending charge failed/canceled; return its id (to notify on) when it transitioned."""
    owner = await _business_for_account(db, account)
    if account is not None and owner is None:
        return None
    payment = (
        await db.execute(
            _stripe_payments(owner).where(
                Payment.provider_ref == intent_id, Payment.provider == "stripe"
            )
        )
    ).scalar_one_or_none()
    if payment is not None and payment.status == "pending":
        payment.status = status  # a canceled intent frees the invoice's pending room to retry
        await db.flush()
        return payment.id
    return None


async def sync_invoice(db: AsyncSession, invoice_id: str) -> None:
    """Move stock and earnings for an invoice by its current ledger status."""
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None or invoice.status in ("draft", "void"):
        return
    status, _ = await ledger.invoice_state(db, invoice)
    await sync_parent_stock(db, invoice.business_id, "invoice", invoice.id, status)
    if status == "paid":
        await ensure_earnings(db, invoice)
    else:
        await reverse_earnings(db, invoice)
    await claw_back(db, invoice)


async def _record_payout(
    db: AsyncSession, account_id: str | None, data: dict[str, object], *, paid: bool = False
) -> None:
    biz = await _business_for_account(db, account_id)
    amount = data.get("amount")
    if biz is None or not isinstance(amount, int):
        return
    currency = data.get("currency")
    cur = currency.upper() if isinstance(currency, str) else BUSINESS_CURRENCY
    payout_id = str(data.get("id"))
    if cur != BUSINESS_CURRENCY:
        await _refuse_currency(db, biz, "payout.refused", payout_id, cur, amount)
        return
    arrival_at = _stamp(data, "arrival_date")
    await ledger.post_payout(
        db,
        biz,
        payout_id=payout_id,
        amount=amount,
        currency=cur,
        arrival_at=arrival_at,
        occurred_at=_stamp(data, "created") or clock.now(),
    )
    if paid or data.get("status") == "paid":
        await ledger.arrive_payout(
            db,
            biz,
            payout_id=payout_id,
            amount=amount,
            currency=cur,
            arrival_at=arrival_at or clock.now(),
        )


async def _refuse_currency(
    db: AsyncSession, business_id: str, action: str, entity_id: str, currency: str, amount: int
) -> None:
    """A Stripe object in a currency the books don't take: audited once, never booked."""
    refused = await db.scalar(
        scoped(Audit, business_id)
        .with_only_columns(Audit.id)
        .where(
            Audit.entity_type == "business",
            Audit.entity_id == business_id,
            Audit.action == action,
            Audit.changes["id"].astext == entity_id,
        )
        .limit(1)
    )
    if refused is not None:
        return
    _log.error("%s business=%s %s %s %s", action, business_id, entity_id, currency, amount)
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=business_id,
            action=action,
            entity_type="business",
            entity_id=business_id,
            changes={"id": entity_id, "currency": currency, "amount_cents": amount},
        )
    )
    await db.flush()


async def _fail_payout(
    db: AsyncSession, account_id: str | None, data: dict[str, object], failed_at: datetime | None
) -> None:
    biz = await _business_for_account(db, account_id)
    if biz is None:
        return
    payout_id = str(data.get("id"))
    if await ledger.journal_for(db, biz, f"payout:{payout_id}") is None:
        await _record_payout(db, account_id, data)  # so a retried `payout.created` stays reversed
    await ledger.fail_payout(db, biz, payout_id, occurred_at=failed_at or clock.now())


def _stripe_payments(business_id: str | None) -> Select[tuple[Payment]]:
    # an event without a connected account (the platform's own) matches by the global Stripe id
    return scoped(Payment, business_id) if business_id is not None else select(Payment)


async def _business_for_account(db: AsyncSession, account_id: str | None) -> str | None:
    if account_id is None:
        return None
    return (
        await db.execute(select(Business.id).where(Business.stripe_account_id == account_id))
    ).scalar_one_or_none()


async def _record_payment_method(
    db: AsyncSession, account_id: str | None, data: dict[str, object]
) -> None:
    """Record a saved card from a SetupIntent, deduped by provider ref."""
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
            scoped(PaymentMethod, biz).where(PaymentMethod.client_id == client.id).limit(1)
        )
    ).scalar_one_or_none()
    pm_type = data.get("type")
    if pm_type in ("acss_debit", "us_bank_account"):  # a PAD / bank mandate, not a card
        kind, mandate = "bank_eft", "pending"
        detail = data.get(pm_type)
    else:
        kind, mandate = "card", "none"
        detail = data.get("card")
    detail = detail if isinstance(detail, dict) else {}
    brand = detail.get("bank_name") if kind == "bank_eft" else detail.get("brand")
    last4 = detail.get("last4")
    exp_month, exp_year = detail.get("exp_month"), detail.get("exp_year")
    bank_name = detail.get("bank_name")
    billing = data.get("billing_details")
    holder = billing.get("name") if isinstance(billing, dict) else None
    db.add(
        PaymentMethod(
            id=new_id("payment_method"),
            business_id=biz,
            client_id=client.id,
            method=kind,
            brand=brand if isinstance(brand, str) else None,
            last4=last4 if isinstance(last4, str) else None,
            provider_ref=pm_id,
            preferred=has_card is None,  # first method on file becomes the default
            mandate_status=mandate,
            exp_month=exp_month if isinstance(exp_month, int) else None,
            exp_year=exp_year if isinstance(exp_year, int) else None,
            holder_name=holder if isinstance(holder, str) else None,
            bank_name=bank_name if isinstance(bank_name, str) else None,
        )
    )
    await db.flush()


_SUB_STATUS: dict[str, SubscriptionStatus] = {
    "active": "active",
    "trialing": "active",
    "past_due": "past_due",
    "unpaid": "past_due",
    "incomplete": "past_due",
    "incomplete_expired": "canceled",
    "paused": "paused",
    "canceled": "canceled",
}


def map_subscription_status(stripe_status: str) -> SubscriptionStatus:
    """Map a Stripe subscription status to ours; unknown statuses read as past_due."""
    return _SUB_STATUS.get(stripe_status, "past_due")


async def _find_subscription(db: AsyncSession, provider_ref: str) -> Subscription | None:
    # provider_ref (the Stripe subscription id) is globally unique → no tenant scope needed.
    return (
        await db.execute(select(Subscription).where(Subscription.provider_ref == provider_ref))
    ).scalar_one_or_none()


def _paid_at(invoice: dict[str, object]) -> datetime:
    """When Stripe marked a subscription invoice paid, not when its webhook reached us."""
    transitions = invoice.get("status_transitions")
    paid = _stamp(transitions, "paid_at") if isinstance(transitions, dict) else None
    return paid or clock.now()


def _stamp(data: dict[str, object], key: str) -> datetime | None:
    """A unix timestamp on a Stripe object (`created`, `arrival_date`), when it carries one."""
    value = data.get(key)
    return datetime.fromtimestamp(value, tz=UTC) if isinstance(value, int) else None


def _period(data: dict[str, object], edge: str) -> datetime | None:
    ts = period_timestamp(data, edge)
    return datetime.fromtimestamp(ts, tz=UTC) if ts is not None else None


def _invoice_details(invoice: dict[str, object]) -> dict[str, object]:
    parent = invoice.get("parent")
    details = parent.get("subscription_details") if isinstance(parent, dict) else None
    return details if isinstance(details, dict) else {}


def _invoice_subscription(invoice: dict[str, object]) -> str | None:
    sub = _invoice_details(invoice).get("subscription")
    return sub if isinstance(sub, str) else None


async def _await_membership(db: AsyncSession, account: str | None, metadata: object) -> None:
    """Stripe bills a new membership before our row commits; ask it to retry until it does."""
    # only a membership carries its client; a plan subscription names the business alone
    if account is None or not isinstance(metadata, dict) or "client_id" not in metadata:
        return
    business_id = metadata.get("business_id")
    if not isinstance(business_id, str):
        return
    ours = await db.scalar(
        select(Business.id).where(Business.id == business_id, Business.stripe_account_id == account)
    )
    if ours is not None:
        raise AppError("membership not recorded yet", status_code=503, code="retry_later")


async def _update_subscription(
    db: AsyncSession, gateway: PaymentGateway, data: dict[str, object], account: str | None
) -> Subscription | None:
    sub_id = data.get("id")
    if not isinstance(sub_id, str):
        return None
    sub = await db.scalar(
        select(Subscription)
        .where(Subscription.provider_ref == sub_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if sub is None:
        await _await_membership(db, account, data.get("metadata"))
        return None
    account = await db.scalar(
        select(Business.stripe_account_id).where(Business.id == sub.business_id)
    )
    if account is None:
        raise Conflict("subscription has no connected account")
    current = await gateway.retrieve(account, "subscription", sub_id)
    status = current.get("status")
    if not isinstance(status, str):
        raise AppError("subscription status unavailable", status_code=503, code="retry_later")
    sub.status = map_subscription_status(status)
    end = _period(current, "end")
    if end is not None:
        sub.current_period_end = end
    await db.flush()
    return sub


async def _expire_subscription(
    db: AsyncSession, gateway: PaymentGateway, data: dict[str, object], account: str | None
) -> str | None:
    """An update that ends a membership, such as a first payment never approved, is a cancel."""
    sub_id = data.get("id")
    was = (
        await db.scalar(select(Subscription.status).where(Subscription.provider_ref == sub_id))
        if isinstance(sub_id, str)
        else None
    )
    sub = await _update_subscription(db, gateway, data, account)
    ended = sub is not None and was not in (None, "canceled") and sub.status == "canceled"
    return sub.id if sub is not None and ended else None


async def _cancel_subscription(
    db: AsyncSession, gateway: PaymentGateway, data: dict[str, object], account: str | None
) -> str | None:
    sub = await _update_subscription(db, gateway, data, account)
    return sub.id if sub is not None and sub.status == "canceled" else None


async def _subscription_past_due(
    db: AsyncSession, gateway: PaymentGateway, data: dict[str, object], account: str | None
) -> WebhookOutcome | None:
    sub_id, invoice_id = _invoice_subscription(data), data.get("id")
    if sub_id is None:
        return None
    metadata = _invoice_details(data).get("metadata")
    sub = await _update_subscription(db, gateway, {"id": sub_id, "metadata": metadata}, account)
    if sub is None or sub.status != "past_due":
        return None
    episode = invoice_id if isinstance(invoice_id, str) else None
    return WebhookOutcome("subscription_past_due", sub.id, episode=episode)


async def end_memberships_at_period_end(
    db: AsyncSession, gateway: PaymentGateway, cmd: Command, business_id: str, client_ids: list[str]
) -> None:
    """An archived client's memberships run out the period already paid for, then stop."""
    account_id = await db.scalar(
        select(Business.stripe_account_id).where(Business.id == business_id)
    )
    if account_id is None:
        return
    rows = await db.scalars(
        scoped(Subscription, business_id).where(
            Subscription.client_id.in_(client_ids),
            Subscription.status != "canceled",
            Subscription.provider_ref.is_not(None),
        )
    )
    for sub in rows.all():
        assert sub.provider_ref is not None
        await gateway.cancel_subscription(
            account_id, subscription_id=sub.provider_ref, at_period_end=True
        )
        cmd.record(
            "subscription.cancel_at_period_end", entity_type="subscription", entity_id=sub.id
        )


async def keep_memberships(
    db: AsyncSession, gateway: PaymentGateway, cmd: Command, business_id: str, client_id: str
) -> None:
    """A restored client's memberships renew again, undoing the end their archive scheduled."""
    account_id = await db.scalar(
        select(Business.stripe_account_id).where(Business.id == business_id)
    )
    if account_id is None:
        return
    rows = await db.scalars(
        scoped(Subscription, business_id).where(
            Subscription.client_id == client_id,
            Subscription.status != "canceled",
            Subscription.provider_ref.is_not(None),
        )
    )
    for sub in rows.all():
        assert sub.provider_ref is not None
        await gateway.keep_subscription(account_id, subscription_id=sub.provider_ref)
        cmd.record("subscription.keep", entity_type="subscription", entity_id=sub.id)


async def _end_disputed_membership(
    db: AsyncSession, gateway: PaymentGateway, data: dict[str, object], account: str | None = None
) -> None:
    """A lost chargeback on a membership charge ends it, so the card is not billed again."""
    payment = await _disputed_payment(db, data, account)
    if payment is None or payment.invoice_id is None:
        return
    sub = await db.scalar(
        scoped(Subscription, payment.business_id)
        .join(Line, Line.item_id == Subscription.item_id)
        .where(
            Line.invoice_id == payment.invoice_id,
            Subscription.client_id == payment.client_id,
            Subscription.status != "canceled",
        )
        .with_for_update(of=Subscription)
    )
    if sub is None:
        return
    account = await db.scalar(
        select(Business.stripe_account_id).where(Business.id == sub.business_id)
    )
    if sub.provider_ref is not None and account is not None:
        with contextlib.suppress(Conflict):  # already gone from Stripe
            await gateway.cancel_subscription(account, subscription_id=sub.provider_ref)
    sub.status = "canceled"
    db.add(
        Audit(
            id=new_id("audit"),
            business_id=sub.business_id,
            action="subscription.cancel",
            entity_type="subscription",
            entity_id=sub.id,
            changes={"dispute": str(data.get("id"))},
        )
    )
    await db.flush()


async def _recurring_method(db: AsyncSession, sub: Subscription) -> str:
    if sub.payment_method_id is None:
        return "card"
    pm = await db.get(PaymentMethod, sub.payment_method_id)
    if pm is None:
        return "card"
    return pm.method


async def _paid_outside_stripe(
    db: AsyncSession, sub: Subscription, invoice_id: str, amount: object
) -> None:
    """A renewal marked paid with no Stripe payment behind it: noted once, never booked."""
    if not isinstance(amount, int) or amount <= 0:
        return
    changes: dict[str, object] = {"invoice": invoice_id, "amount_cents": amount}
    noted = await db.scalar(
        scoped(Audit, sub.business_id)
        .with_only_columns(Audit.id)
        .where(
            Audit.action == "subscription.paid_outside_stripe",
            Audit.entity_id == sub.id,
            Audit.changes.contains({"invoice": invoice_id}),
        )
    )
    if noted is None:
        db.add(
            Audit(
                id=new_id("audit"),
                business_id=sub.business_id,
                action="subscription.paid_outside_stripe",
                entity_type="subscription",
                entity_id=sub.id,
                changes=changes,
            )
        )
        await db.flush()


async def _record_recurring_payment(
    db: AsyncSession, gateway: PaymentGateway, data: dict[str, object], account: str | None
) -> str | None:
    """Record a recurring charge as a paid invoice and payment, deduped on the Stripe id."""
    sub_id, invoice_id = _invoice_subscription(data), data.get("id")
    if sub_id is None or not isinstance(invoice_id, str):
        return None
    sub = await _find_subscription(db, sub_id)
    if sub is None:
        await _await_membership(db, account, _invoice_details(data).get("metadata"))
        return None
    account_id = (
        await db.execute(select(Business.stripe_account_id).where(Business.id == sub.business_id))
    ).scalar_one_or_none()
    if account_id is None:
        return None
    invoice_paid = await gateway.get_invoice_payment(account_id, invoice_id=invoice_id)
    if invoice_paid is None:
        await _paid_outside_stripe(db, sub, invoice_id, data.get("amount_paid"))
        return None
    ref, paid = invoice_paid.intent_id, invoice_paid.amount_cents
    seen = (
        await db.execute(select(Payment.id).where(Payment.provider_ref == ref))
    ).scalar_one_or_none()
    if seen is not None:  # already recorded — a re-delivery of the same charge
        return None
    currency = data.get("currency")
    cur = currency.upper() if isinstance(currency, str) else BUSINESS_CURRENCY
    if cur != BUSINESS_CURRENCY:
        await _refuse_currency(db, sub.business_id, "payment.refused", ref, cur, paid)
        return None
    invoice_id = await _recurring_invoice(db, sub, cur, data, paid)
    payment = Payment(
        id=new_id("payment"),
        business_id=sub.business_id,
        client_id=sub.client_id,
        kind="payment",
        invoice_id=invoice_id,
        amount_cents=paid,
        currency=cur,
        method=await _recurring_method(db, sub),
        provider="stripe",
        provider_ref=ref,
        status="succeeded",
        paid_at=_paid_at(data),
    )
    db.add(payment)
    await db.flush()
    fees = await _fees(db, gateway, sub.business_id, ref)
    await ledger.post_payment(db, payment, available_at=fees.available_at)
    await ledger.post_fees(db, payment, fees)
    await _sync_parent(db, payment)
    return payment.id


def subscription_terms(item: Item, client_id: str) -> dict[str, str]:
    """Whose membership it is and the tax class its price was set at, copied to each renewal."""
    return {"business_id": item.business_id, "client_id": client_id, "tax_class": item.tax_class}


def _period_start(invoice: dict[str, object]) -> datetime | None:
    lines = invoice.get("lines")
    rows = lines.get("data") if isinstance(lines, dict) else None
    first = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}
    period = first.get("period")
    return _stamp(period, "start") if isinstance(period, dict) else None


async def _recurring_invoice(
    db: AsyncSession, sub: Subscription, currency: str, data: dict[str, object], paid: int
) -> str | None:
    """An invoice for one subscription period, split from what Stripe charged, not today's price."""
    item = await db.get(Item, sub.item_id)
    if item is None:
        return None
    terms = _invoice_details(data).get("metadata")
    tax_class = terms.get("tax_class") if isinstance(terms, dict) else None
    at = _period_start(data) or _paid_at(data)
    # the price is tax-inclusive, so a registration change moves the split, never the amount
    result = await tax_within(
        db,
        sub.business_id,
        paid,
        tax_class=tax_class if isinstance(tax_class, str) else item.tax_class,
        at=at,
    )
    base = paid - result.tax_total_cents
    invoice = Invoice(
        id=new_id("invoice"),
        business_id=sub.business_id,
        client_id=sub.client_id,
        status="sent",
        currency=currency,
        issued_at=at,
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
        unit_amount_cents=base,
        amount_cents=base,
        tax_class=tax_class if isinstance(tax_class, str) else item.tax_class,
        tax_amount_cents=result.tax_total_cents,
        position=0,
    )
    db.add(line)
    apply_totals(invoice, result)
    await db.flush()
    await ledger.post_invoice(db, invoice, result)
    return invoice.id


async def cancel_open_deposits(db: AsyncSession, gateway: PaymentGateway, booking: Booking) -> bool:
    """Cancel the visit's unpaid deposit intents; False when one has already gone through."""
    business = await db.get(Business, booking.business_id)
    account_id = business.stripe_account_id if business is not None else None
    rows = await db.execute(
        scoped(Payment, booking.business_id)
        .where(
            Payment.booking_id == booking.id,
            Payment.kind == "deposit",
            Payment.status.in_(("pending", "failed")),
        )
        .with_for_update()
    )
    canceled = True
    for payment in rows.scalars().all():
        if payment.provider == "stripe" and payment.provider_ref and account_id is not None:
            try:
                await gateway.cancel_payment_intent(
                    account_id, payment_intent_id=payment.provider_ref
                )
            except AppError:
                canceled = False
                continue
        payment.status = "canceled"
    await db.flush()
    return canceled


async def refund_deposit(db: AsyncSession, gateway: PaymentGateway, booking: Booking) -> int:
    """Refund what is left of a visit's settled deposit, for a cancel the policy allows."""
    business = await db.get(Business, booking.business_id)
    if business is None or business.stripe_account_id is None:
        raise Conflict("contact the business to refund this deposit")
    deposits = (
        (
            await db.execute(
                scoped(Payment, booking.business_id)
                .where(
                    Payment.booking_id == booking.id,
                    Payment.kind == "deposit",
                    Payment.status == "succeeded",
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if await booking_refund_status(db, booking) == "pending":
        return 0
    if any(payment.provider != "stripe" or payment.provider_ref is None for payment in deposits):
        raise Conflict("contact the business to refund this deposit")
    total = 0
    for payment in deposits:
        if _disputed(payment):
            continue  # the dispute decides where this deposit goes; the cancel still stands
        refunded = await _refunded_cents(db, payment)
        left = payment.amount_cents - refunded
        if left <= 0 or payment.provider_ref is None:
            continue
        attempts = await db.scalar(
            scoped(Payment, booking.business_id)
            .with_only_columns(func.count())
            .where(Payment.parent_payment_id == payment.id, Payment.kind == "refund")
        )
        refund = await create_refund(
            db,
            gateway,
            payment,
            business.stripe_account_id,
            left,
            key=f"refund_{payment.id}_{attempts or 0}",
        )
        if refund.status == "succeeded":
            total += left
    return total


async def refund_online_order(db: AsyncSession, gateway: PaymentGateway, order: Order) -> int:
    business = await db.get(Business, order.business_id)
    if business is None or business.stripe_account_id is None:
        raise Conflict("this order cannot be refunded online")
    payments = (
        (
            await db.execute(
                scoped(Payment, order.business_id)
                .where(
                    Payment.order_id == order.id,
                    Payment.kind == "payment",
                    Payment.status == "succeeded",
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if await has_pending_order_refund(db, order):
        raise Conflict("a refund is already being processed")
    if any(
        payment.provider_ref is None or payment.provider != "stripe" or _disputed(payment)
        for payment in payments
    ):
        raise Conflict("contact the business to refund this payment")
    total = 0
    for payment in payments:
        refunded = await _refunded_cents(db, payment)
        left = payment.amount_cents - refunded
        if left <= 0:
            continue
        if payment.provider_ref is None or payment.provider != "stripe":
            raise Conflict("contact the business to refund this payment")
        attempts = await db.scalar(
            scoped(Payment, order.business_id)
            .with_only_columns(func.count())
            .where(Payment.parent_payment_id == payment.id, Payment.kind == "refund")
        )
        refund = await create_refund(
            db,
            gateway,
            payment,
            business.stripe_account_id,
            left,
            key=f"refund_{payment.id}_{attempts or 0}",
        )
        if refund.status == "succeeded":
            total += left
    return total


async def has_pending_order_refund(db: AsyncSession, order: Order) -> bool:
    return (
        await db.execute(
            scoped(Payment, order.business_id)
            .where(
                Payment.order_id == order.id, Payment.kind == "refund", Payment.status == "pending"
            )
            .limit(1)
        )
    ).scalar_one_or_none() is not None


class PublicPaymentSetupService:
    def __init__(self, db: AsyncSession, gateway: PaymentGateway) -> None:
        self.db = db
        self.gateway = gateway

    async def resolve(self, token: str) -> PaymentSetupLink:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        link = (
            await self.db.execute(
                select(PaymentSetupLink)
                .where(
                    PaymentSetupLink.token_hash == token_hash,
                    PaymentSetupLink.purpose == "pad_setup",
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if link is None or link.revoked_at is not None or link.expires_at <= clock.now():
            raise NotFound("authorization link expired or unavailable; request a new link")
        business = await self.db.get(Business, link.business_id)
        client = (
            await self.db.execute(
                scoped(Client, link.business_id, soft_delete=True).where(
                    Client.id == link.client_id
                )
            )
        ).scalar_one_or_none()
        if (
            business is None
            or client is None
            or business.stripe_account_id != link.account_id
            or client.stripe_customer_id != link.customer_id
        ):
            raise NotFound("authorization link unavailable; request a new link")
        return link

    async def view(self, token: str, *, payer_email: str | None = None) -> PublicPaymentSetup:
        """The setup page; the payer's email starts the mandate and goes only to Stripe."""
        link = await self.resolve(token)
        if payer_email is not None and link.setup_intent_id is None:
            client = await self.db.get(Client, link.client_id)
            if client is None:
                raise NotFound("authorization link unavailable; request a new link")
            intent = await self.gateway.create_pad_setup_intent(
                link.account_id,
                customer_id=link.customer_id,
                idempotency_key=f"pad_setup_{link.id}",
                email=payer_email,
            )
            link.setup_intent_id = intent.id
            link.expires_at = clock.now() + timedelta(days=10)
            await self.db.flush()
        secret: str | None = None
        verify: str | None = None
        if link.setup_intent_id is not None:
            state = await self.gateway.get_setup_intent(link.account_id, link.setup_intent_id)
            if state.id != link.setup_intent_id or state.customer_id != link.customer_id:
                raise Conflict("bank setup does not match this client")
            link.setup_status = state.status
            if state.status == "succeeded":
                await _reconcile_pad_setup(self.db, self.gateway, link.account_id, state.id)
            elif payer_email is not None and state.status not in ("canceled", "processing"):
                secret = state.client_secret
            if state.verification_url and state.verification_url.startswith("https://"):
                verify = state.verification_url
        business = await self.db.get(Business, link.business_id)
        client = await self.db.get(Client, link.client_id)
        assert business is not None and client is not None
        from clientbridge.services.public import public_brand

        result = PublicPaymentSetup(
            brand=public_brand(business),
            business_name=business.name,
            client_name=client.name,
            expires_at=link.expires_at,
            status=link.setup_status,
            stripe_account_id=link.account_id,
            client_secret=secret,
            verification_url=verify,
        )
        await self.db.commit()
        return result


async def _reconcile_pad_setup(
    db: AsyncSession, gateway: PaymentGateway, account_id: str | None, intent_id: str
) -> None:
    if account_id is None:
        return
    link = (
        await db.execute(
            select(PaymentSetupLink)
            .where(
                PaymentSetupLink.account_id == account_id,
                PaymentSetupLink.setup_intent_id == intent_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if link is None:
        return
    business = await db.get(Business, link.business_id)
    client = (
        await db.execute(
            scoped(Client, link.business_id, soft_delete=True).where(Client.id == link.client_id)
        )
    ).scalar_one_or_none()
    if (
        business is None
        or client is None
        or business.stripe_account_id != account_id
        or client.stripe_customer_id != link.customer_id
    ):
        return
    state = await gateway.get_setup_intent(account_id, intent_id)
    if state.customer_id != link.customer_id or state.id != link.setup_intent_id:
        return
    link.setup_status = "processing" if state.status == "succeeded" else state.status
    pm = state.payment_method
    if (
        state.status != "succeeded"
        or pm is None
        or pm.get("type") != "acss_debit"
        or state.mandate_id is None
        or pm.get("customer") != link.customer_id
    ):
        return
    mandate = await gateway.get_mandate(account_id, state.mandate_id)
    if mandate.payment_method_id != pm.get("id") or (
        link.revoked_at is not None and mandate.status == "active"
    ):
        return
    link.mandate_ref = mandate.id
    await _record_payment_method(db, account_id, pm)
    method = (
        await db.execute(
            scoped(PaymentMethod, link.business_id).where(
                PaymentMethod.client_id == link.client_id,
                PaymentMethod.provider_ref == mandate.payment_method_id,
            )
        )
    ).scalar_one_or_none()
    if method is not None:
        method.mandate_status = (
            "active"
            if mandate.status == "active"
            else "revoked"
            if mandate.status == "inactive"
            else "pending"
        )
        link.setup_status = (
            "succeeded"
            if method.mandate_status == "active"
            else "revoked"
            if method.mandate_status == "revoked"
            else "processing"
        )
        await db.flush()


async def _reconcile_pad_mandate(
    db: AsyncSession, gateway: PaymentGateway, account_id: str | None, mandate_id: str
) -> None:
    if account_id is None:
        return
    link = (
        await db.execute(
            select(PaymentSetupLink).where(
                PaymentSetupLink.account_id == account_id,
                PaymentSetupLink.mandate_ref == mandate_id,
            )
        )
    ).scalar_one_or_none()
    if link is not None and link.setup_intent_id is not None:
        await _reconcile_pad_setup(db, gateway, account_id, link.setup_intent_id)


async def booking_refund_status(
    db: AsyncSession, booking: Booking
) -> Literal["pending", "failed"] | None:
    statuses = (
        (
            await db.execute(
                scoped(Payment, booking.business_id)
                .with_only_columns(Payment.status)
                .where(
                    Payment.booking_id == booking.id,
                    Payment.kind == "refund",
                )
            )
        )
        .scalars()
        .all()
    )
    if "pending" in statuses:
        return "pending"
    if booking.deposit_status != "refunded" and any(
        status in ("failed", "canceled") for status in statuses
    ):
        return "failed"
    return None


async def queue_payment_outcome(db: AsyncSession, outcome: WebhookOutcome) -> None:
    model = (
        GiftCard
        if outcome.notify == "gift_card_issued"
        else Subscription
        if outcome.notify in ("subscription_past_due", "subscription_canceled")
        else Payment
    )
    target = await db.get(model, outcome.target_id)
    if target is None:
        raise NotFound("notification source not found")
    await notify_payment_outcome(queued_notifier(db, target.business_id, outcome.key), db, outcome)


def _still_news(outcome: WebhookOutcome, occurred_at: datetime | None) -> bool:
    """A notice about something a day old reads as noise; an issued gift card is still owed."""
    return outcome.notify == "gift_card_issued" or (
        occurred_at is None or occurred_at >= clock.now() - timedelta(days=1)
    )


async def _notify_recovery(
    db: AsyncSession, outcome: WebhookOutcome, occurred_at: datetime | None
) -> None:
    undated = occurred_at is None and outcome.notify != "gift_card_issued"
    if not undated and _still_news(outcome, occurred_at):
        await queue_payment_outcome(db, outcome)


async def recover_stripe_source(
    db: AsyncSession,
    gateway: PaymentGateway,
    business_id: str,
    account_id: str,
    source: str,
    occurred_at: datetime | None,
    last_at: datetime | None = None,
) -> list[str]:
    outcome = None
    refs: list[str] = []
    if source.startswith(("ch_", "py_")):
        charge = await gateway.retrieve(account_id, "charge", source)
        intent_id = charge.get("payment_intent")
        if not isinstance(intent_id, str):
            return []
        known = await db.scalar(
            scoped(Payment, business_id).where(Payment.provider_ref == intent_id)
        )
        if known is None:
            invoice = await gateway.invoice_for_payment(account_id, intent_id)
            if invoice is not None:
                recorded = await _record_recurring_payment(db, gateway, invoice, None)
                if recorded is not None:
                    outcome = WebhookOutcome("payment", recorded)
        intent = await gateway.retrieve(account_id, "payment_intent", intent_id)
        if intent.get("status") == "succeeded":
            settled = await _settle_payment(
                db, gateway, intent, account=account_id, occurred_at=occurred_at
            )
            if settled is not None:
                outcome = (
                    WebhookOutcome("gift_card_issued", settled.gift_card_id)
                    if settled.gift_card_id
                    else WebhookOutcome("payment", settled.payment_id)
                )
        payment = await db.scalar(
            scoped(Payment, business_id).where(Payment.provider_ref == intent_id)
        )
        if payment is not None:
            # Stripe returns an application fee as an adjustment on the charge, not the refund
            refunds = await db.scalars(
                scoped(Payment, business_id)
                .with_only_columns(Payment.id)
                .where(Payment.parent_payment_id == payment.id, Payment.kind == "refund")
            )
            refs = [
                f"payment:{payment.id}",
                f"fee:{payment.id}",
                *(f"fee_return:{refund}{end}" for refund in refunds for end in ("", ":failed")),
            ]
    elif source.startswith(("re_", "pyr_")):
        refund = await gateway.retrieve(account_id, "refund", source)
        outcome = await _reconcile_refund(db, refund, account_id)
        payment = await db.scalar(
            scoped(Payment, business_id).where(Payment.provider_ref == source)
        )
        if payment is not None:
            refs = [f"refund:{payment.id}", f"refund:{payment.id}:failed"]
    elif source.startswith("po_"):
        payout = await gateway.retrieve(account_id, "payout", source)
        await _record_payout(db, account_id, payout)
        if payout.get("status") in ("failed", "canceled"):
            await _fail_payout(db, account_id, payout, last_at)
        refs = [f"payout:{source}", f"payout:{source}:failed"]
    elif source.startswith(DISPUTES):
        dispute = await gateway.retrieve(account_id, "dispute", source)
        if dispute.get("status") in ("won", "lost"):
            await _close_dispute(db, dispute, account_id)
        else:
            disputed = await _update_dispute(db, dispute, account_id)
            if disputed is not None:
                outcome = WebhookOutcome("payment_disputed", disputed)
        refs = list(
            await db.scalars(
                scoped(Entry, business_id)
                .where(
                    or_(
                        *(
                            (Entry.ref == f"{kind}:{source}")
                            | Entry.ref.startswith(f"{kind}:{source}:", autoescape=True)
                            for kind in ("dispute", "dispute_fee")
                        )
                    )
                )
                .with_only_columns(Entry.ref)
                .distinct()
            )
        ) or [f"dispute:{source}"]
    if outcome is not None:
        await _notify_recovery(db, outcome, occurred_at)
    return refs


async def notify_payment_outcome(
    notifier: Notifier, db: AsyncSession, outcome: WebhookOutcome
) -> None:
    match outcome.notify:
        case "payment":
            await notifier.on_payment_succeeded(db, outcome.target_id)
        case "gift_card_issued":
            await notifier.on_gift_card_issued(db, outcome.target_id)
        case "payment_failed":
            await notifier.on_payment_failed(db, outcome.target_id)
        case "refund":
            pass
        case "refund_failed":
            await notifier.on_refund_failed(db, outcome.target_id)
        case "refund_stalled":
            await notifier.on_refund_failed(db, outcome.target_id, client_told=False)
        case "payment_disputed":
            await notifier.on_payment_disputed(db, outcome.target_id)
        case "dispute_inquiry":
            await notifier.on_dispute_inquiry(db, outcome.target_id)
        case "subscription_past_due":
            await notifier.on_subscription_past_due(db, outcome.target_id)
        case "subscription_canceled":
            await notifier.on_subscription_canceled(db, outcome.target_id)


async def _alert_daily(
    db: AsyncSession, business_id: str, action: str, changes: dict[str, object]
) -> None:
    """An hourly job repeats the same trouble; alert on a change, else once a day."""
    previous = await db.scalar(
        scoped(Audit, business_id)
        .where(
            Audit.entity_type == "business",
            Audit.entity_id == business_id,
            Audit.action == action,
        )
        .order_by(Audit.id.desc())
        .limit(1)
    )
    if (
        previous is None
        or previous.changes != changes
        or previous.created_at <= clock.now() - timedelta(days=1)
    ):
        db.add(_drift(business_id, action, changes))


def _drift(business_id: str, action: str, changes: dict[str, object]) -> Audit:
    _log.error("ledger drift %s business=%s %s", action, business_id, changes)
    return Audit(
        id=new_id("audit"),
        business_id=business_id,
        action=action,
        entity_type="business",
        entity_id=business_id,
        changes=changes,
    )


_FINDINGS = ("ledger.transaction_drift", "ledger.transaction_failed")
_DEFER_LIMIT = timedelta(hours=24)
_RECONCILE_OVERLAP = timedelta(days=1)
_BALANCE_SETTLE_WINDOW = timedelta(hours=2)
_RECONCILE_BUDGET = timedelta(minutes=10)


def source_findings(business_id: str) -> Select[tuple[Audit]]:
    return scoped(Audit, business_id).where(
        Audit.entity_type == "stripe_source", Audit.action.in_(_FINDINGS)
    )


def _finding_notes(business_id: str, action: str) -> Select[tuple[Audit]]:
    return scoped(Audit, business_id).where(Audit.entity_type == "audit", Audit.action == action)


def _resolution(business_id: str, finding_id: str) -> Audit:
    return Audit(
        id=new_id("audit"),
        business_id=business_id,
        action="ledger.drift_resolved",
        entity_type="audit",
        entity_id=finding_id,
        changes={},
    )


async def _source_drift(
    db: AsyncSession,
    business_id: str,
    source: str,
    changes: dict[str, object] | None,
    action: str = "ledger.transaction_drift",
) -> int:
    await db.execute(
        select(
            func.pg_advisory_xact_lock(func.hashtextextended(f"drift:{business_id}:{source}", 0))
        )
    )
    previous = await db.scalar(
        source_findings(business_id)
        .where(Audit.entity_id == source)
        .order_by(Audit.id.desc())
        .limit(1)
    )
    resolved = (
        await db.scalar(
            _finding_notes(business_id, "ledger.drift_resolved")
            .where(Audit.entity_id == previous.id)
            .limit(1)
        )
        if previous is not None
        else None
    )
    active = previous if previous is not None and resolved is None else None
    if changes is None:
        if active is not None:
            db.add(_resolution(business_id, active.id))
        return 0
    if active is not None and active.action == action and active.changes == changes:
        acknowledged = await db.scalar(
            _finding_notes(business_id, "ledger.drift_acknowledged")
            .where(Audit.entity_id == active.id)
            .limit(1)
        )
        return int(acknowledged is None)
    if active is not None and active.action != action:
        db.add(_resolution(business_id, active.id))
    finding = _drift(business_id, action, changes)
    finding.entity_type = "stripe_source"
    finding.entity_id = source
    db.add(finding)
    return 1


def _active_findings(business_id: str) -> Subquery:
    latest = (
        source_findings(business_id)
        .where(Audit.entity_id != "balance")
        .order_by(Audit.entity_id, Audit.id.desc())
        .distinct(Audit.entity_id)
        .subquery()
    )
    resolved = (
        _finding_notes(business_id, "ledger.drift_resolved")
        .where(Audit.entity_id == latest.c.id)
        .exists()
    )
    return select(latest).where(~resolved).subquery()


async def _orphan_transactions(
    db: AsyncSession,
    gateway: PaymentGateway,
    business_id: str,
    account_id: str,
    source: str,
    transactions: list[dict[str, object]],
) -> list[str]:
    resource: StripeResource
    if source.startswith(("ch_", "py_")):
        resource = "charge"
    elif source.startswith(("re_", "pyr_")):
        resource = "refund"
    else:
        return []
    obj = await gateway.retrieve(account_id, resource, source)
    intent = obj.get("payment_intent")
    if not isinstance(intent, str):
        return []
    audit = await db.scalar(
        scoped(Audit, business_id).where(
            Audit.entity_type == "payment_intent",
            Audit.entity_id == intent,
            Audit.action == "payment.orphan_refunded",
        )
    )
    if audit is None:
        return []
    refs = []
    for raw in transactions:
        row = StripeTransaction.model_validate(raw)
        if row.currency != BUSINESS_CURRENCY.lower():
            raise ValueError("orphan transaction currency does not match business")
        if _fee_return(raw):
            stamp = datetime.fromtimestamp(row.created, UTC)
            refs.append(
                await ledger.post_orphan(db, business_id, row.id, intent, 0, 0, -row.net, stamp)
            )
            continue
        details = raw.get("fee_details")
        if not isinstance(details, list):
            raise ValueError("orphan transaction has no fee breakdown")
        processing, application = 0, 0
        for fee in details:
            if not isinstance(fee, dict) or not isinstance(fee.get("amount"), int):
                raise ValueError("invalid orphan transaction fee")
            if fee.get("type") == "application_fee":
                application += int(fee["amount"])
            elif fee.get("type") in ("stripe_fee", "payment_method_passthrough_fee", "tax"):
                processing += int(fee["amount"])
            else:
                raise ValueError("unsupported orphan transaction fee")
        if processing + application != row.fee or row.amount - row.fee != row.net:
            raise ValueError("orphan transaction fees do not reconcile")
        refs.append(
            await ledger.post_orphan(
                db,
                business_id,
                row.id,
                intent,
                row.amount,
                processing,
                application,
                datetime.fromtimestamp(row.created, UTC),
            )
        )
    return refs


_STRIPE_FEES = ("stripe_fee", "tax_fee", "stripe_fx_fee")
_SECONDARY = ("refund_failure", "adjustment")  # Stripe's source filter leaves these out


def _fee_return(row: dict[str, object]) -> bool:
    """An application fee Stripe returned with a refund, posted on the charge as its source."""
    return row.get("type") == "adjustment" and row.get("reporting_category") == "fee"


def _stripe_fee(row: dict[str, object]) -> bool:
    """A fee Stripe charged the account on its own, such as Connect fees or tax on its fees."""
    kind = row.get("type")
    return kind in _STRIPE_FEES or (kind != "adjustment" and row.get("reporting_category") == "fee")


async def _source_history(
    gateway: PaymentGateway, account_id: str, source: str
) -> list[dict[str, object]]:
    """Every transaction of one source, newest first, including the ones its filter misses."""
    rows = await gateway.balance_transactions(account_id, source=source)
    created = [at for row in rows if isinstance(at := row.get("created"), int)]
    if not created:
        return rows
    seen = {row.get("id") for row in rows}
    for kind in _SECONDARY:
        for row in await gateway.balance_transactions(account_id, since=min(created), kind=kind):
            if row.get("source") == source and row.get("id") not in seen:
                seen.add(row.get("id"))
                rows.append(row)
    return sorted(rows, key=lambda row: _created(row), reverse=True)


def _created(row: dict[str, object]) -> int:
    at = row.get("created")
    return at if isinstance(at, int) else 0


def _by_source(rows: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    """Stripe lists newest first; each source's transactions come back oldest first."""
    sources: dict[str, list[dict[str, object]]] = {}
    for row in reversed(rows):
        source = row.get("source")
        source = source if isinstance(source, str) else str(row.get("id"))
        sources.setdefault(source, []).append(row)
    return sources


def _stripe_net(transactions: list[dict[str, object]]) -> int:
    return sum(
        net
        for row in transactions
        if isinstance(net := row.get("net"), int)
        and row.get("currency") == BUSINESS_CURRENCY.lower()
    )


async def _source_changes(
    db: AsyncSession,
    gateway: PaymentGateway,
    business_id: str,
    account_id: str,
    source: str,
    transactions: list[dict[str, object]],
) -> dict[str, object] | None:
    refs: list[str] = []
    for row in [row for row in transactions if _stripe_fee(row)]:
        identity, net, stamp = row.get("id"), row.get("net"), _stamp(row, "created")
        if row.get("currency") != BUSINESS_CURRENCY.lower():
            continue
        if not isinstance(identity, str) or not isinstance(net, int) or stamp is None:
            raise ValueError("stripe fee transaction is incomplete")
        refs.append(await ledger.post_stripe_fee(db, business_id, identity, net, stamp))
    others = [row for row in transactions if not _stripe_fee(row)]
    if others:
        recovered = await recover_stripe_source(
            db,
            gateway,
            business_id,
            account_id,
            source,
            _stamp(others[0], "created"),
            _stamp(others[-1], "created"),
        )
        refs += recovered or await _orphan_transactions(
            db, gateway, business_id, account_id, source, others
        )
        if await _pending_refund(db, business_id, source):
            return None  # Stripe debits a pending refund at once; we book it when it settles
    expected = _stripe_net(transactions)
    actual = await db.scalar(
        scoped(Entry, business_id)
        .join(Account, Entry.account_id == Account.id)
        .where(
            Account.category == "stripe",
            Account.owner_type == "business",
            Account.owner_id == business_id,
            Entry.ref.in_(refs),
        )
        .with_only_columns(func.coalesce(func.sum(Entry.amount_cents), 0))
    )
    if refs and actual == expected:
        return None
    return {
        "source": source,
        "transaction_ids": [row.get("id") for row in transactions],
        "ledger_cents": int(actual or 0),
        "stripe_cents": expected,
    }


def _pending_refunds(business_id: str) -> Select[tuple[Payment]]:
    return scoped(Payment, business_id).where(
        Payment.kind == "refund",
        Payment.provider == "stripe",
        Payment.status == "pending",
        Payment.provider_ref.is_not(None),
    )


async def _pending_refund(db: AsyncSession, business_id: str, source: str) -> bool:
    if not source.startswith(("re_", "pyr_")):
        return False
    found = await db.scalar(
        _pending_refunds(business_id)
        .with_only_columns(Payment.id)
        .where(Payment.provider_ref == source)
    )
    return found is not None


async def _reconcile_source(
    db: AsyncSession,
    gateway: PaymentGateway,
    business_id: str,
    account_id: str,
    source: str,
    transactions: list[dict[str, object]],
    *,
    windowed: bool,
) -> int:
    try:
        changes = await _source_changes(db, gateway, business_id, account_id, source, transactions)
        if changes is not None and windowed and isinstance(transactions[0].get("source"), str):
            # the window can hold only a source's later transactions, so compare its whole history
            history = _by_source(await _source_history(gateway, account_id, source))
            if history.get(source):
                transactions = history[source]
                changes = await _source_changes(
                    db, gateway, business_id, account_id, source, transactions
                )
        drifted = await _source_drift(db, business_id, source, changes)
        await db.commit()
        return drifted
    except Exception as exc:
        await db.rollback()
        action = "ledger.transaction_failed"
        if isinstance(exc, AppError) and exc.code == "retry_later":
            created = _stamp(transactions[0], "created")
            if created is not None and created > clock.now() - _DEFER_LIMIT:
                return 0
            action = "ledger.transaction_drift"
        else:
            _log.exception("stripe transaction recovery failed for %s", source)
        failure: dict[str, object] = {
            "source": source,
            "transaction_ids": [row.get("id") for row in transactions],
            "ledger_cents": 0,
            "stripe_cents": _stripe_net(transactions),
        }
        drifted = await _source_drift(db, business_id, source, failure, action)
        await db.commit()
        return drifted


async def _reconciled_through(db: AsyncSession, business_id: str) -> dict[str, object]:
    cursor = await db.scalar(
        scoped(Audit, business_id)
        .where(
            Audit.entity_type == "business",
            Audit.entity_id == business_id,
            Audit.action == "ledger.reconciled",
        )
        .order_by(Audit.id.desc())
        .limit(1)
    )
    return cursor.changes if cursor is not None else {}


async def reconcile_stripe_transactions(
    db: AsyncSession, gateway: PaymentGateway, business_id: str, account_id: str
) -> int:
    """Check the transactions since the last run, with a day's overlap, and every open finding."""
    cursor = await _reconciled_through(db, business_id)
    last = cursor.get("created")
    since = last - int(_RECONCILE_OVERLAP.total_seconds()) if isinstance(last, int) else None
    rows = await gateway.balance_transactions(account_id, since=since)
    sources = _by_source(rows)
    open_sources = [
        *await db.scalars(select(_active_findings(business_id).c.entity_id)),
        *await db.scalars(_pending_refunds(business_id).with_only_columns(Payment.provider_ref)),
    ]
    for source in [source for source in open_sources if source and source not in sources]:
        history = _by_source(await _source_history(gateway, account_id, source))
        if history.get(source):
            sources[source] = history[source]
    drifted = 0
    for source, transactions in sorted(
        sources.items(), key=lambda pair: (not pair[0].startswith(("ch_", "py_")), pair[0])
    ):
        drifted += await _reconcile_source(
            db, gateway, business_id, account_id, source, transactions, windowed=since is not None
        )
    newest = max(
        ((at, str(row.get("id"))) for row in rows if isinstance(at := row.get("created"), int)),
        default=None,
    )
    moved = {"transaction_id": newest[1], "created": newest[0]} if newest is not None else cursor
    if moved != cursor or not cursor:
        db.add(
            Audit(
                id=new_id("audit"),
                business_id=business_id,
                action="ledger.reconciled",
                entity_type="business",
                entity_id=business_id,
                changes=moved,
            )
        )
    await db.commit()
    return drifted


async def _reconcile_balance(
    db: AsyncSession, gateway: PaymentGateway, business_id: str, account_id: str
) -> int:
    active = _active_findings(business_id)
    explained = await db.scalar(
        select(
            func.coalesce(
                func.sum(
                    cast(active.c.changes["stripe_cents"].astext, BigInteger)
                    - cast(active.c.changes["ledger_cents"].astext, BigInteger)
                ),
                0,
            )
        )
    )
    ours = await ledger.balance(
        db, business_id, owner_type="business", owner_id=business_id, category="stripe"
    )
    pending = await db.scalar(
        _pending_refunds(business_id)
        .where(Payment.currency == BUSINESS_CURRENCY)
        .with_only_columns(func.coalesce(func.sum(Payment.amount_cents), 0))
    )
    theirs = await gateway.get_balance_cents(account_id, currency=BUSINESS_CURRENCY)
    residual = theirs - ours - int(explained or 0) + int(pending or 0)
    if residual and not await _unsettled_last_run(db, business_id):
        # a charge whose webhook is still on its way shows here once; drift is what stays
        db.add(
            Audit(
                id=new_id("audit"),
                business_id=business_id,
                action="ledger.balance_unsettled",
                entity_type="stripe_source",
                entity_id="balance",
                changes={"residual_cents": residual},
            )
        )
        return 0
    return await _source_drift(
        db, business_id, "balance", {"residual_cents": residual} if residual else None
    )


async def _unsettled_last_run(db: AsyncSession, business_id: str) -> bool:
    """Whether the previous hourly run already saw the balance off, so this one confirms it."""
    seen = await db.scalar(
        scoped(Audit, business_id)
        .with_only_columns(Audit.id)
        .where(
            Audit.action == "ledger.balance_unsettled",
            Audit.created_at >= clock.now() - _BALANCE_SETTLE_WINDOW,
        )
        .limit(1)
    )
    return seen is not None


async def run_reconcile_payments(
    db: AsyncSession, gateway: PaymentGateway, *, budget: timedelta = _RECONCILE_BUDGET
) -> int:
    """Repair provider sources and check balances: new businesses first, then a turn each hour."""
    hour = clock.now().strftime("%Y%m%d%H")
    ids = list(
        await db.scalars(
            select(Business.id)
            .outerjoin(
                Audit,
                (Audit.business_id == Business.id)
                & (Audit.entity_type == "business")
                & (Audit.entity_id == Business.id)
                & (Audit.action == "ledger.reconciled"),
            )
            .group_by(Business.id)
            # the order turns each hour, so a business the budget missed is near the front next time
            .order_by(
                func.max(Audit.id).is_(None).desc(),
                case(
                    (func.max(Audit.id).is_(None), Business.id),
                    else_=func.md5(func.concat(Business.id, hour)),
                ),
                Business.id,
            )
        )
    )
    started = monotonic()
    drifted = 0
    for index, identity in enumerate(ids):
        if index and monotonic() - started >= budget.total_seconds():
            _log.warning("ledger reconciliation stopped with %d businesses left", len(ids) - index)
            break
        try:
            business = await db.get(Business, identity)
            if business is None:
                continue
            found = 0
            account_id = None if _closed(business) else merchant_account(business)
            if account_id is not None:
                # a lost account event would otherwise leave a paused account looking enabled
                await _resync_account(db, gateway, business)
                found += await reconcile_stripe_transactions(db, gateway, identity, account_id)
                found += await _reconcile_balance(db, gateway, identity, account_id)
            stale = await ledger.stale_accounts(db, identity)
            if stale:
                found += 1
                await _alert_daily(db, identity, "ledger.cache_drift", {"account_ids": stale})
            await db.commit()
            drifted += found
        except Exception as exc:
            await db.rollback()
            _log.warning("ledger reconciliation failed for %s", identity, exc_info=True)
            changes: dict[str, object] = {"error": type(exc).__name__}
            await _alert_daily(db, identity, "ledger.reconciliation_failed", changes)
            await db.commit()
            drifted += 1
    return drifted
