"""Payment gateway adapter — the Stripe Connect boundary (see .docs/testing.md).

Production talks to Stripe; tests override `get_payment_gateway` with a recording fake, so the
onboarding / charge / webhook logic is covered without the network. Connected accounts are Custom
(the platform owns onboarding + compliance); charges are direct with an application fee (Phase 6b).
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import stripe

from clientbridge.core.config import get_settings


@dataclass(frozen=True)
class ConnectAccount:
    id: str
    charges_enabled: bool
    details_submitted: bool


@dataclass(frozen=True)
class GatewayEvent:
    id: str
    type: str
    data: dict[str, object]
    account: str | None = None  # the connected account a Connect event came from


@dataclass(frozen=True)
class PaymentIntentResult:
    id: str
    client_secret: str


@dataclass(frozen=True)
class SetupIntentResult:
    id: str
    client_secret: str


@dataclass(frozen=True)
class RefundResult:
    id: str
    status: str


@dataclass(frozen=True)
class SubscriptionResult:
    id: str
    status: str
    current_period_start: datetime
    current_period_end: datetime


class WebhookVerificationError(Exception):
    """A webhook payload's signature could not be verified."""


class PaymentGateway(Protocol):
    async def create_connected_account(self, *, business_name: str, email: str | None) -> str: ...
    async def create_account_link(
        self, account_id: str, *, refresh_url: str, return_url: str
    ) -> str: ...
    async def get_account(self, account_id: str) -> ConnectAccount: ...
    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent: ...

    # Direct charges on the connected account: the client is a Customer there, the platform takes
    # an application fee.
    async def create_customer(self, account_id: str, *, name: str, email: str | None) -> str: ...
    async def create_setup_intent(self, account_id: str, *, customer_id: str) -> SetupIntentResult:
        """Save a card for later off-session use, without charging now."""
        ...

    async def create_pad_setup_intent(
        self, account_id: str, *, customer_id: str
    ) -> SetupIntentResult:
        """Save a Canadian pre-authorized debit (ACSS) mandate for later off-session pulls."""
        ...

    async def create_price(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        interval_count: int,
        frequency: str,
    ) -> str:
        """A recurring Price for a subscription item; returns the price id."""
        ...

    async def create_subscription(
        self, account_id: str, *, customer_id: str, price_id: str, payment_method_id: str
    ) -> SubscriptionResult: ...
    async def cancel_subscription(self, account_id: str, *, subscription_id: str) -> None: ...

    async def create_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
        payment_method: str | None = None,
    ) -> PaymentIntentResult: ...
    async def refund(
        self, account_id: str, *, payment_intent_id: str, amount_cents: int, idempotency_key: str
    ) -> RefundResult: ...
    async def detach_payment_method(self, account_id: str, *, payment_method_id: str) -> None:
        """Detach a saved card from its Customer so it can no longer be charged."""
        ...

    # Stripe Terminal (in-person POS): the device fetches a connection token, then confirms a
    # card_present PaymentIntent we create with the platform's application fee.
    async def create_connection_token(self, account_id: str) -> str:
        """A short-lived secret the Terminal SDK exchanges to connect a reader."""
        ...

    async def create_terminal_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
    ) -> PaymentIntentResult:
        """A card_present PaymentIntent (no customer); the reader confirms, the webhook settles."""
        ...


class StripeGateway:
    def __init__(self, secret_key: str, webhook_secret: str, country: str) -> None:
        stripe.api_key = secret_key
        self._webhook_secret = webhook_secret
        self._country = country

    async def create_connected_account(  # pragma: no cover - real Stripe, faked in tests
        self, *, business_name: str, email: str | None
    ) -> str:
        account = await stripe.Account.create_async(
            type="custom",
            country=self._country,
            email=email,  # type: ignore[arg-type]  # Stripe email is optional; stub types it str
            business_profile={"name": business_name},
            capabilities={
                "card_payments": {"requested": True},
                "transfers": {"requested": True},
            },
        )
        return str(account.id)

    async def create_account_link(  # pragma: no cover
        self, account_id: str, *, refresh_url: str, return_url: str
    ) -> str:
        link = await stripe.AccountLink.create_async(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
        return str(link.url)

    async def get_account(self, account_id: str) -> ConnectAccount:  # pragma: no cover
        account = await stripe.Account.retrieve_async(account_id)
        return ConnectAccount(
            id=str(account.id),
            charges_enabled=bool(account.charges_enabled),
            details_submitted=bool(account.details_submitted),
        )

    async def create_customer(  # pragma: no cover
        self, account_id: str, *, name: str, email: str | None
    ) -> str:
        customer = await stripe.Customer.create_async(
            name=name,
            email=email,  # type: ignore[arg-type]  # optional at Stripe; stub types it str
            stripe_account=account_id,
        )
        return str(customer.id)

    async def create_setup_intent(  # pragma: no cover
        self, account_id: str, *, customer_id: str
    ) -> SetupIntentResult:
        intent = await stripe.SetupIntent.create_async(
            customer=customer_id, usage="off_session", stripe_account=account_id
        )
        return SetupIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    async def create_pad_setup_intent(  # pragma: no cover
        self, account_id: str, *, customer_id: str
    ) -> SetupIntentResult:
        intent = await stripe.SetupIntent.create_async(
            customer=customer_id,
            usage="off_session",
            payment_method_types=["acss_debit"],
            payment_method_options={
                "acss_debit": {
                    "currency": "cad",
                    "mandate_options": {
                        "payment_schedule": "interval",
                        "transaction_type": "personal",
                    },
                }
            },
            stripe_account=account_id,
        )
        return SetupIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    async def create_price(  # pragma: no cover
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        interval_count: int,
        frequency: str,
    ) -> str:
        price = await stripe.Price.create_async(
            unit_amount=amount_cents,
            currency=currency.lower(),
            recurring={"interval": frequency, "interval_count": interval_count},  # type: ignore[typeddict-item]
            product_data={"name": "Subscription"},
            stripe_account=account_id,
        )
        return str(price.id)

    async def create_subscription(  # pragma: no cover
        self, account_id: str, *, customer_id: str, price_id: str, payment_method_id: str
    ) -> SubscriptionResult:
        sub = await stripe.Subscription.create_async(
            customer=customer_id,
            items=[{"price": price_id}],
            default_payment_method=payment_method_id,
            stripe_account=account_id,
        )
        return SubscriptionResult(
            id=str(sub.id),
            status=str(sub.status),
            # top-level period fields aren't in the stub (newer API versions moved them); the
            # dict accessor reads them off the live object.
            current_period_start=datetime.fromtimestamp(int(sub["current_period_start"]), tz=UTC),
            current_period_end=datetime.fromtimestamp(int(sub["current_period_end"]), tz=UTC),
        )

    async def cancel_subscription(  # pragma: no cover
        self, account_id: str, *, subscription_id: str
    ) -> None:
        await stripe.Subscription.cancel_async(subscription_id, stripe_account=account_id)

    async def create_payment_intent(  # pragma: no cover
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
        payment_method: str | None = None,
    ) -> PaymentIntentResult:
        # a saved payment_method → charge it off-session now; else return a client_secret to confirm
        extra: dict[str, object] = (
            {"payment_method": payment_method, "confirm": True, "off_session": True}
            if payment_method
            else {}
        )
        intent = await stripe.PaymentIntent.create_async(
            amount=amount_cents,
            currency=currency.lower(),
            customer=customer_id,
            application_fee_amount=application_fee_cents,
            metadata=metadata,
            stripe_account=account_id,
            idempotency_key=idempotency_key,
            **extra,  # type: ignore[arg-type]  # Stripe kwargs are loosely typed
        )
        return PaymentIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    async def refund(  # pragma: no cover
        self, account_id: str, *, payment_intent_id: str, amount_cents: int, idempotency_key: str
    ) -> RefundResult:
        refund = await stripe.Refund.create_async(
            payment_intent=payment_intent_id,
            amount=amount_cents,
            stripe_account=account_id,
            idempotency_key=idempotency_key,
        )
        return RefundResult(id=str(refund.id), status=str(refund.status))

    async def detach_payment_method(  # pragma: no cover
        self, account_id: str, *, payment_method_id: str
    ) -> None:
        await stripe.PaymentMethod.detach_async(payment_method_id, stripe_account=account_id)

    async def create_connection_token(self, account_id: str) -> str:  # pragma: no cover
        token = await stripe.terminal.ConnectionToken.create_async(stripe_account=account_id)
        return str(token.secret)

    async def create_terminal_payment_intent(  # pragma: no cover
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
    ) -> PaymentIntentResult:
        intent = await stripe.PaymentIntent.create_async(
            amount=amount_cents,
            currency=currency.lower(),
            payment_method_types=["card_present"],
            application_fee_amount=application_fee_cents,
            metadata=metadata,
            stripe_account=account_id,
            idempotency_key=idempotency_key,
        )
        return PaymentIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent:  # pragma: no cover
        try:
            event = stripe.Webhook.construct_event(  # type: ignore[no-untyped-call]
                payload, signature, self._webhook_secret
            )
        except Exception as exc:
            raise WebhookVerificationError(str(exc)) from exc
        obj = dict(event["data"]["object"])
        account = event.get("account")
        return GatewayEvent(
            id=str(event["id"]),
            type=str(event["type"]),
            data={str(k): v for k, v in obj.items()},
            account=str(account) if account else None,
        )


def get_payment_gateway() -> PaymentGateway:
    s = get_settings()
    return StripeGateway(s.stripe_secret_key, s.stripe_webhook_secret, s.stripe_connect_country)
