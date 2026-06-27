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


class WebhookVerificationError(Exception):
    """A webhook payload's signature could not be verified."""


class PaymentGateway(Protocol):
    async def create_connected_account(self, *, business_name: str, email: str | None) -> str: ...
    async def create_account_link(
        self, account_id: str, *, refresh_url: str, return_url: str
    ) -> str: ...
    async def get_account(self, account_id: str) -> ConnectAccount: ...
    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent: ...


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

    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent:  # pragma: no cover
        try:
            event = stripe.Webhook.construct_event(  # type: ignore[no-untyped-call]
                payload, signature, self._webhook_secret
            )
        except Exception as exc:
            raise WebhookVerificationError(str(exc)) from exc
        obj = dict(event["data"]["object"])
        return GatewayEvent(
            id=str(event["id"]),
            type=str(event["type"]),
            data={str(k): v for k, v in obj.items()},
        )


def get_payment_gateway() -> PaymentGateway:
    s = get_settings()
    return StripeGateway(s.stripe_secret_key, s.stripe_webhook_secret, s.stripe_connect_country)
