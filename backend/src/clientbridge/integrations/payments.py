"""Payment gateway adapter — the Stripe Connect boundary (see .docs/testing.md).

Production talks to Stripe; tests override `get_payment_gateway` with a recording fake, so the
onboarding / charge / webhook logic is covered without the network. Connected accounts are Custom
(the platform owns onboarding + compliance); charges are direct with an application fee (Phase 6b).
"""

from dataclasses import dataclass
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
class RefundResult:
    id: str
    status: str


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
    async def create_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str,
        application_fee_cents: int,
        metadata: dict[str, str],
    ) -> PaymentIntentResult: ...
    async def refund(
        self, account_id: str, *, payment_intent_id: str, amount_cents: int
    ) -> RefundResult: ...


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

    async def create_payment_intent(  # pragma: no cover
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str,
        application_fee_cents: int,
        metadata: dict[str, str],
    ) -> PaymentIntentResult:
        intent = await stripe.PaymentIntent.create_async(
            amount=amount_cents,
            currency=currency.lower(),
            customer=customer_id,
            application_fee_amount=application_fee_cents,
            metadata=metadata,
            stripe_account=account_id,
        )
        return PaymentIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    async def refund(  # pragma: no cover
        self, account_id: str, *, payment_intent_id: str, amount_cents: int
    ) -> RefundResult:
        refund = await stripe.Refund.create_async(
            payment_intent=payment_intent_id, amount=amount_cents, stripe_account=account_id
        )
        return RefundResult(id=str(refund.id), status=str(refund.status))

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
