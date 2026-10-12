"""Stripe Connect adapter: Accounts v2 merchants, direct charges with an application fee."""

import json
import re
import unicodedata
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Concatenate, Literal, Protocol, cast

import stripe
from stripe.params import (
    AccountSessionCreateParamsComponents,
    AccountSessionCreateParamsComponentsAccountManagementFeatures,
)
from stripe.params.v2.core import (
    AccountCreateParams,
    AccountCreateParamsConfigurationMerchant,
    AccountCreateParamsDefaults,
    AccountCreateParamsDefaultsResponsibilities,
)

from clientbridge.core.config import get_settings
from clientbridge.core.errors import (
    CardDeclined,
    Conflict,
    PaymentActionRequired,
    PaymentsNotConfigured,
)
from clientbridge.models.catalog import Frequency

# snapshot payloads are parsed at this version; the Connect webhook endpoint must use it too
STRIPE_API_VERSION = "2026-09-30.endive"
# Stripe takes its fee from the business and owns negative balances; fixed at creation
RESPONSIBILITIES: AccountCreateParamsDefaultsResponsibilities = {
    "fees_collector": "stripe",
    "losses_collector": "stripe",
}
# connected accounts settle in this currency; a charge in another one pays Stripe's conversion fee
SETTLEMENT_CURRENCY = "cad"
ACCOUNT_EVENTS = (
    "v2.core.account[requirements].updated",
    "v2.core.account[configuration.merchant].capability_status_updated",
    "v2.core.account.closed",
)


def _missing(exc: stripe.InvalidRequestError) -> bool:
    return exc.code == "resource_missing"


def payment_descriptor(name: str) -> str | None:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    descriptor = re.sub(r"[<>\\'\"*]", "", ascii_name).upper()
    descriptor = " ".join(descriptor.split())[:22].rstrip()
    return descriptor if len(descriptor) >= 5 and re.search("[A-Z]", descriptor) else None


type ConnectComponent = Literal["onboarding", "account", "notices", "payments", "payouts"]


@dataclass(frozen=True)
class ConnectAccount:
    id: str
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool
    disabled_reason: str | None
    currently_due: list[str]
    eventually_due: list[str]
    past_due: list[str]
    pending_verification: list[str]
    card_status: str | None  # card_payments: active, pending, restricted, unsupported or rejected
    current_deadline: int | None = None  # unix time Stripe pauses payouts if currently_due stays


TERMS_REQUIREMENT = "identity.attestations.terms_of_service"
_UNFIXABLE = ("contact_stripe", "no_resolution")


def _dict(value: object) -> dict[str, object]:
    return cast(dict[str, object], value) if isinstance(value, dict) else {}


def _rows(value: object) -> list[dict[str, object]]:
    return [_dict(row) for row in value] if isinstance(value, list) else []


def _unix(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


def merchant_capability(data: dict[str, object], *path: str) -> dict[str, object]:
    node = _dict(_dict(_dict(data.get("configuration")).get("merchant")).get("capabilities"))
    for key in path:
        node = _dict(node.get(key))
    return node


def _blocked_reason(data: dict[str, object]) -> str | None:
    if data.get("closed") is True:
        return "closed"
    cards = merchant_capability(data, "card_payments")
    status = cards.get("status")
    details = _rows(cards.get("status_details"))
    first = details[0] if details else {}
    # a pending capability with no_resolution is Stripe's own review, not a block
    unfixable = status == "restricted" and first.get("resolution") in _UNFIXABLE
    if status in ("unsupported", "rejected") or unfixable:
        code = first.get("code")
        return code if isinstance(code, str) else str(status)
    return None


def account_status_from(account_id: str, data: dict[str, object]) -> ConnectAccount:
    """Parse an Accounts v2 object (with merchant configuration and requirements) into KYC state."""
    card_status = merchant_capability(data, "card_payments").get("status")
    requirements = _dict(data.get("requirements"))
    due: dict[str, list[str]] = {"currently_due": [], "eventually_due": [], "past_due": []}
    pending: list[str] = []
    for entry in _rows(requirements.get("entries")):
        code = entry.get("description")
        if not isinstance(code, str):
            continue
        if entry.get("awaiting_action_from") == "stripe":
            if card_status == "pending":
                pending.append(code)
            continue
        status = _dict(entry.get("minimum_deadline")).get("status")
        if isinstance(status, str) and status in due:
            due[status].append(code)
    owed = [*due["currently_due"], *due["eventually_due"], *due["past_due"]]
    deadline = _dict(_dict(requirements.get("summary")).get("minimum_deadline")).get("time")
    return ConnectAccount(
        id=account_id,
        charges_enabled=card_status == "active",
        payouts_enabled=merchant_capability(data, "stripe_balance", "payouts").get("status")
        == "active",
        details_submitted=not any(code.startswith(TERMS_REQUIREMENT) for code in owed),
        disabled_reason=_blocked_reason(data),
        currently_due=due["currently_due"],
        eventually_due=due["eventually_due"],
        past_due=due["past_due"],
        pending_verification=pending,
        card_status=card_status if isinstance(card_status, str) else None,
        current_deadline=_unix(deadline),
    )


@dataclass(frozen=True)
class GatewayEvent:
    id: str
    type: str
    data: dict[str, object]
    account: str | None = None  # the connected account a Connect event came from or is about
    created: datetime | None = None  # when Stripe raised it: the success time of a succeeded event
    api_version: str | None = None
    thin: bool = False  # an unversioned v2 notification; the handler fetches what it needs


THIN_EVENT = "v2.core.event"


def event_from(event: dict[str, object]) -> GatewayEvent:
    """A verified webhook body as a GatewayEvent; a thin event names the account it is about."""
    if event.get("object") == THIN_EVENT:
        related = _dict(event.get("related_object"))
        related_id = related.get("id")
        about_account = related.get("type") == "v2.core.account" and isinstance(related_id, str)
        return GatewayEvent(
            id=str(event["id"]),
            type=str(event["type"]),
            data={"related_object": related},
            account=str(related_id) if about_account else None,
            thin=True,
        )
    obj = _dict(_dict(event.get("data")).get("object"))
    account = event.get("account")
    version = event.get("api_version")
    created = event.get("created")
    return GatewayEvent(
        id=str(event["id"]),
        type=str(event["type"]),
        data=obj,
        account=str(account) if account else None,
        api_version=version if isinstance(version, str) else None,
        created=datetime.fromtimestamp(created, tz=UTC) if isinstance(created, int) else None,
    )


@dataclass(frozen=True)
class PostalAddress:
    line1: str
    city: str
    province: str
    postal_code: str
    line2: str | None = None


@dataclass(frozen=True)
class PaymentIntentResult:
    id: str
    client_secret: str


@dataclass(frozen=True)
class SetupIntentResult:
    id: str
    client_secret: str


@dataclass(frozen=True)
class SetupIntentState:
    id: str
    client_secret: str
    status: str
    customer_id: str | None
    payment_method: dict[str, object] | None
    mandate_id: str | None
    verification_url: str | None = None


@dataclass(frozen=True)
class MandateState:
    id: str
    status: str
    payment_method_id: str


@dataclass(frozen=True)
class ChargeFees:
    processing_fee_cents: int
    application_fee_cents: int
    available_at: datetime | None


@dataclass(frozen=True)
class RefundResult:
    id: str
    status: str


@dataclass(frozen=True)
class PriceTerms:
    amount_cents: int
    currency: str
    interval_count: int
    frequency: str


@dataclass(frozen=True)
class SubscriptionResult:
    id: str
    status: str
    current_period_start: datetime
    current_period_end: datetime


class WebhookVerificationError(Exception):
    """A webhook payload's signature could not be verified."""


class WebhookVersionError(Exception):
    """A webhook payload was rendered at an API version the handlers do not parse."""


class PaymentGateway(Protocol):
    async def create_connected_account(
        self,
        *,
        business_name: str,
        email: str | None,
        url: str | None = None,
        idempotency_key: str | None = None,
    ) -> str: ...
    async def create_account_link(
        self, account_id: str, *, refresh_url: str, return_url: str
    ) -> str: ...
    async def create_account_session(self, account_id: str, component: ConnectComponent) -> str: ...

    async def get_account(self, account_id: str) -> ConnectAccount: ...
    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent: ...

    async def create_customer(self, account_id: str, *, name: str, email: str | None) -> str: ...
    async def create_setup_intent(self, account_id: str, *, customer_id: str) -> SetupIntentResult:
        """Save a card for later off-session use, without charging now."""
        ...

    async def create_pad_setup_intent(
        self,
        account_id: str,
        *,
        customer_id: str,
        idempotency_key: str,
        interval_description: str,
        email: str | None = None,
    ) -> SetupIntentResult:
        """Save a Canadian pre-authorized debit (ACSS) mandate for later off-session pulls."""
        ...

    async def ensure_pad_capability(self, account_id: str) -> None: ...

    async def get_setup_intent(self, account_id: str, setup_intent_id: str) -> SetupIntentState: ...
    async def get_mandate(self, account_id: str, mandate_id: str) -> MandateState: ...

    async def create_price(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        interval_count: int,
        frequency: Frequency,
        product_name: str,
    ) -> str:
        """A recurring Price for a subscription item; returns the price id."""
        ...

    async def get_price(self, account_id: str, price_id: str) -> PriceTerms: ...

    async def create_subscription(
        self,
        account_id: str,
        *,
        customer_id: str,
        price_id: str,
        payment_method_id: str,
        idempotency_key: str | None = None,
    ) -> SubscriptionResult: ...
    async def cancel_subscription(self, account_id: str, *, subscription_id: str) -> None: ...

    async def create_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str | None,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
        payment_method: str | None = None,
    ) -> PaymentIntentResult: ...
    async def cancel_payment_intent(self, account_id: str, *, payment_intent_id: str) -> None:
        """Cancel an unconfirmed intent; Conflict when it already went through."""
        ...

    async def refund(
        self,
        account_id: str,
        *,
        payment_intent_id: str,
        amount_cents: int,
        idempotency_key: str,
        refund_application_fee: bool = False,
    ) -> RefundResult: ...
    async def get_payment_fees(
        self, account_id: str, *, payment_intent_id: str
    ) -> ChargeFees | None:
        """Stripe's processing fee + our application fee off the charge's balance transaction."""
        ...

    async def get_invoice_payment_intent(self, account_id: str, *, invoice_id: str) -> str | None:
        """The PaymentIntent that paid a subscription invoice (no longer on the invoice itself)."""
        ...

    async def get_balance_cents(self, account_id: str, *, currency: str) -> int:
        """The connected account's available + pending balance in one currency."""
        ...

    async def detach_payment_method(self, account_id: str, *, payment_method_id: str) -> None:
        """Detach a saved card from its Customer so it can no longer be charged."""
        ...

    async def get_card_country(self, account_id: str, *, payment_method_id: str) -> str | None:
        """The issuing country of a saved card, which decides Stripe's international surcharge."""
        ...

    async def create_connection_token(self, account_id: str) -> str:
        """A short-lived secret the Terminal SDK exchanges to connect a reader."""
        ...

    async def create_terminal_location(
        self, account_id: str, *, display_name: str, address: PostalAddress
    ) -> str:
        """A Terminal Location at a Canadian street address for the reader; returns its id."""
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


def _keyed[**P, R](
    method: Callable[Concatenate["StripeGateway", P], Coroutine[object, object, R]],
) -> Callable[Concatenate["StripeGateway", P], CoroutineType[object, object, R]]:
    async def call(self: "StripeGateway", /, *args: P.args, **kwargs: P.kwargs) -> R:
        if not self.configured:
            raise PaymentsNotConfigured("card payments are not set up on this server")
        return await method(self, *args, **kwargs)

    return call


class StripeGateway:
    def __init__(
        self, secret_key: str, webhook_secret: str, country: str, thin_webhook_secret: str = ""
    ) -> None:
        self.configured = bool(secret_key)
        stripe.api_key = secret_key
        stripe.api_version = STRIPE_API_VERSION
        self._client = stripe.StripeClient(
            secret_key, stripe_version=STRIPE_API_VERSION, base_addresses={"api": stripe.api_base}
        )
        self._webhook_secret = webhook_secret
        self._thin_webhook_secret = thin_webhook_secret
        self._country = country

    @_keyed
    async def create_connected_account(
        self,
        *,
        business_name: str,
        email: str | None,
        url: str | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        # Prefill what we already have; Stripe collects the rest in embedded onboarding.
        merchant: AccountCreateParamsConfigurationMerchant = {
            "capabilities": {
                "card_payments": {"requested": True},
                "link_payments": {"requested": True},
            }
        }
        descriptor = payment_descriptor(business_name)
        if descriptor is not None:
            prefix = descriptor[:10].rstrip()
            merchant["statement_descriptor"] = (
                {"descriptor": descriptor, "prefix": prefix}
                if re.search("[A-Z]", prefix)
                else {"descriptor": descriptor}
            )
        if email is not None:
            merchant["support"] = {"email": email}
        defaults: AccountCreateParamsDefaults = {
            "currency": SETTLEMENT_CURRENCY,
            "locales": ["en-CA"],
            "responsibilities": RESPONSIBILITIES,
        }
        if url is not None:
            defaults["profile"] = {"business_url": url}
        params: AccountCreateParams = {
            "display_name": business_name,
            "dashboard": "none",
            "identity": {"country": self._country.lower()},
            "configuration": {"merchant": merchant},
            "defaults": defaults,
            "include": ["configuration.merchant", "requirements"],
        }
        if email is not None:
            params["contact_email"] = email
        account = await self._client.v2.core.accounts.create_async(
            params, {"idempotency_key": idempotency_key} if idempotency_key else None
        )
        return str(account.id)

    @_keyed
    async def create_account_link(
        self, account_id: str, *, refresh_url: str, return_url: str
    ) -> str:
        link = await self._client.v2.core.account_links.create_async(
            {
                "account": account_id,
                "use_case": {
                    "type": "account_onboarding",
                    "account_onboarding": {
                        "refresh_url": refresh_url,
                        "return_url": return_url,
                    },
                },
            }
        )
        return str(link.url)

    @_keyed
    async def create_account_session(self, account_id: str, component: ConnectComponent) -> str:
        components: AccountSessionCreateParamsComponents = {}
        # Stripe collects requirements, so its user authentication stays on
        account_features: AccountSessionCreateParamsComponentsAccountManagementFeatures = {
            "external_account_collection": True,
            "disable_stripe_user_authentication": False,
        }
        if component == "onboarding":
            components["account_onboarding"] = {"enabled": True, "features": account_features}
        elif component == "account":
            components["account_management"] = {"enabled": True, "features": account_features}
            components["account_onboarding"] = {"enabled": True, "features": account_features}
        elif component == "notices":
            components["notification_banner"] = {"enabled": True, "features": account_features}
        elif component == "payments":
            components["payments"] = {
                "enabled": True,
                "features": {
                    "dispute_management": True,
                    "refund_management": False,
                    "capture_payments": False,
                },
            }
        else:
            components["payouts"] = {
                "enabled": True,
                "features": {
                    "edit_payout_schedule": False,
                    "instant_payouts": False,
                    "standard_payouts": False,
                    "external_account_collection": False,
                },
            }
        session = await stripe.AccountSession.create_async(
            account=account_id, components=components
        )
        return str(session.client_secret)

    @_keyed
    async def get_account(self, account_id: str) -> ConnectAccount:  # pragma: no cover
        account = await self._client.v2.core.accounts.retrieve_async(
            account_id, {"include": ["configuration.merchant", "requirements"]}
        )
        return account_status_from(str(account.id), account.to_dict())

    @_keyed
    async def create_customer(self, account_id: str, *, name: str, email: str | None) -> str:
        params: CustomerCreateParams = {"name": name, "stripe_account": account_id}
        if email is not None:
            params["email"] = email
        customer = await stripe.Customer.create_async(**params)
        return str(customer.id)

    @_keyed
    async def create_setup_intent(self, account_id: str, *, customer_id: str) -> SetupIntentResult:
        intent = await stripe.SetupIntent.create_async(
            customer=customer_id, usage="off_session", stripe_account=account_id
        )
        return SetupIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    @_keyed
    async def create_pad_setup_intent(
        self,
        account_id: str,
        *,
        customer_id: str,
        idempotency_key: str,
        interval_description: str,
        email: str | None = None,
    ) -> SetupIntentResult:
        if email is not None:
            await stripe.Customer.modify_async(customer_id, email=email, stripe_account=account_id)
        intent = await stripe.SetupIntent.create_async(
            customer=customer_id,
            usage="off_session",
            allowed_payment_method_types=["acss_debit"],
            payment_method_options={
                "acss_debit": {
                    "currency": "cad",
                    "mandate_options": {
                        "payment_schedule": "interval",
                        "interval_description": interval_description,
                        "default_for": ["invoice", "subscription"],
                        "transaction_type": "personal",
                    },
                }
            },
            stripe_account=account_id,
            idempotency_key=idempotency_key,
        )
        # Stripe drops an allowed type the account cannot take instead of failing the request
        if "acss_debit" not in intent.payment_method_types:
            raise Conflict(
                "complete the Canadian pre-authorized debit requirements in payments setup"
            )
        return SetupIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    @_keyed
    async def ensure_pad_capability(self, account_id: str) -> None:
        try:
            account = await self._client.v2.core.accounts.update_async(
                account_id,
                {
                    "configuration": {
                        "merchant": {"capabilities": {"acss_debit_payments": {"requested": True}}}
                    },
                    "include": ["configuration.merchant"],
                },
            )
        except stripe.InvalidRequestError as exc:
            raise Conflict(
                "enable Canadian pre-authorized debit on the platform "
                "and complete the business's payments setup"
            ) from exc
        if merchant_capability(account.to_dict(), "acss_debit_payments").get("status") != "active":
            raise Conflict(
                "complete the Canadian pre-authorized debit requirements in payments setup"
            )

    @_keyed
    async def get_setup_intent(self, account_id: str, setup_intent_id: str) -> SetupIntentState:
        intent = await stripe.SetupIntent.retrieve_async(
            setup_intent_id, expand=["payment_method"], stripe_account=account_id
        )
        pm = intent.payment_method
        mandate = intent.mandate
        action = intent.next_action
        verify = (
            action.verify_with_microdeposits
            if action is not None and action.type == "verify_with_microdeposits"
            else None
        )
        return SetupIntentState(
            id=str(intent.id),
            client_secret=str(intent.client_secret),
            status=str(intent.status),
            customer_id=intent.customer if isinstance(intent.customer, str) else None,
            payment_method={
                "id": pm.id,
                "type": pm.type,
                "customer": pm.customer,
                "acss_debit": {"last4": pm.acss_debit.last4, "bank_name": pm.acss_debit.bank_name}
                if pm.acss_debit is not None
                else {},
            }
            if isinstance(pm, stripe.PaymentMethod)
            else None,
            mandate_id=mandate if isinstance(mandate, str) else None,
            verification_url=verify.hosted_verification_url if verify is not None else None,
        )

    @_keyed
    async def get_mandate(self, account_id: str, mandate_id: str) -> MandateState:
        mandate = await stripe.Mandate.retrieve_async(mandate_id, stripe_account=account_id)
        return MandateState(
            id=str(mandate.id),
            status=str(mandate.status),
            payment_method_id=str(mandate.payment_method),
        )

    @_keyed
    async def create_price(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        interval_count: int,
        frequency: Frequency,
        product_name: str,
    ) -> str:
        price = await stripe.Price.create_async(
            unit_amount=amount_cents,
            currency=currency.lower(),
            recurring={"interval": frequency, "interval_count": interval_count},
            product_data={"name": product_name},
            stripe_account=account_id,
        )
        return str(price.id)

    async def get_price(self, account_id: str, price_id: str) -> PriceTerms:  # pragma: no cover
        price = await stripe.Price.retrieve_async(price_id, stripe_account=account_id)
        recurring = price.recurring
        return PriceTerms(
            amount_cents=price.unit_amount or 0,
            currency=price.currency.upper(),
            interval_count=recurring.interval_count if recurring else 0,
            frequency=recurring.interval if recurring else "",
        )

    @_keyed
    async def create_subscription(
        self,
        account_id: str,
        *,
        customer_id: str,
        price_id: str,
        payment_method_id: str,
        idempotency_key: str | None = None,
    ) -> SubscriptionResult:
        sub = await stripe.Subscription.create_async(
            customer=customer_id,
            items=[{"price": price_id}],
            default_payment_method=payment_method_id,
            stripe_account=account_id,
            idempotency_key=idempotency_key,
        )
        return SubscriptionResult(
            id=str(sub.id),
            status=str(sub.status),
            current_period_start=datetime.fromtimestamp(_period_of(sub, "start"), tz=UTC),
            current_period_end=datetime.fromtimestamp(_period_of(sub, "end"), tz=UTC),
        )

    @_keyed
    async def cancel_subscription(  # pragma: no cover
        self, account_id: str, *, subscription_id: str
    ) -> None:
        try:
            await stripe.Subscription.cancel_async(subscription_id, stripe_account=account_id)
        except stripe.InvalidRequestError as exc:
            if _missing(exc):
                raise Conflict("this subscription is not on the business's Stripe account") from exc
            raise

    @_keyed
    async def create_payment_intent(
        self,
        account_id: str,
        *,
        amount_cents: int,
        currency: str,
        customer_id: str | None,
        application_fee_cents: int,
        metadata: dict[str, str],
        idempotency_key: str,
        payment_method: str | None = None,
    ) -> PaymentIntentResult:
        # a saved payment_method → charge it off-session now; else return a client_secret to confirm
        params: PaymentIntentCreateParams = {
            "amount": amount_cents,
            "currency": currency.lower(),
            "application_fee_amount": application_fee_cents,
            "metadata": metadata,
            "stripe_account": account_id,
            "idempotency_key": idempotency_key,
        }
        if payment_method:
            params.update(payment_method=payment_method, confirm=True, off_session=True)
        if customer_id is not None:  # a walk-in sale has no Customer
            params["customer"] = customer_id
        try:
            intent = await stripe.PaymentIntent.create_async(**params)
        except stripe.CardError as exc:  # off-session decline / 3DS → a 402 the client can act on
            if exc.code == "authentication_required":
                raise PaymentActionRequired("this card requires authentication") from exc
            raise CardDeclined("the card was declined") from exc
        except stripe.InvalidRequestError as exc:
            if _missing(exc) and exc.param in ("payment_method", "customer"):
                raise Conflict(
                    "the saved payment method is not on the business's Stripe account"
                ) from exc
            raise
        return PaymentIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    @_keyed
    async def cancel_payment_intent(self, account_id: str, *, payment_intent_id: str) -> None:
        try:
            await stripe.PaymentIntent.cancel_async(payment_intent_id, stripe_account=account_id)
        except stripe.InvalidRequestError as exc:  # processing or succeeded: it can't be undone
            raise Conflict("this invoice already has a payment in progress") from exc

    @_keyed
    async def refund(
        self,
        account_id: str,
        *,
        payment_intent_id: str,
        amount_cents: int,
        idempotency_key: str,
        refund_application_fee: bool = False,
    ) -> RefundResult:
        try:
            refund = await stripe.Refund.create_async(
                payment_intent=payment_intent_id,
                amount=amount_cents,
                refund_application_fee=refund_application_fee,
                stripe_account=account_id,
                idempotency_key=idempotency_key,
            )
        except stripe.InvalidRequestError as exc:
            if _missing(exc):
                raise Conflict("this payment is not on the business's Stripe account") from exc
            raise
        return RefundResult(id=str(refund.id), status=str(refund.status))

    @_keyed
    async def detach_payment_method(self, account_id: str, *, payment_method_id: str) -> None:
        await stripe.PaymentMethod.detach_async(payment_method_id, stripe_account=account_id)

    @_keyed
    async def get_payment_fees(
        self, account_id: str, *, payment_intent_id: str
    ) -> ChargeFees | None:
        intent = await stripe.PaymentIntent.retrieve_async(
            payment_intent_id,
            expand=["latest_charge.balance_transaction"],
            stripe_account=account_id,
        )
        charge = getattr(intent, "latest_charge", None)
        if isinstance(charge, str):
            charge = await stripe.Charge.retrieve_async(
                charge, expand=["balance_transaction"], stripe_account=account_id
            )
        txn = getattr(charge, "balance_transaction", None) if charge else None
        if isinstance(txn, str):
            txn = await stripe.BalanceTransaction.retrieve_async(txn, stripe_account=account_id)
        if not txn:  # the balance transaction lands shortly after the charge; retry then
            return None
        details = [(str(d.type), int(d.amount)) for d in txn.fee_details]
        return ChargeFees(
            processing_fee_cents=sum(a for t, a in details if t != "application_fee"),
            application_fee_cents=sum(a for t, a in details if t == "application_fee"),
            available_at=datetime.fromtimestamp(int(txn.available_on), tz=UTC),
        )

    @_keyed
    async def get_invoice_payment_intent(self, account_id: str, *, invoice_id: str) -> str | None:
        payments = await stripe.InvoicePayment.list_async(
            invoice=invoice_id, stripe_account=account_id
        )
        for row in payments.data:
            intent = row.payment.payment_intent if row.status == "paid" else None
            if intent is not None:
                return intent if isinstance(intent, str) else str(intent.id)
        return None

    @_keyed
    async def get_balance_cents(self, account_id: str, *, currency: str) -> int:
        balance = await stripe.Balance.retrieve_async(stripe_account=account_id)
        funds = [*balance["available"], *balance["pending"]]
        return sum(int(f["amount"]) for f in funds if str(f["currency"]) == currency.lower())

    @_keyed
    async def get_card_country(  # pragma: no cover
        self, account_id: str, *, payment_method_id: str
    ) -> str | None:
        method = await stripe.PaymentMethod.retrieve_async(
            payment_method_id, stripe_account=account_id
        )
        return method.card.country if method.card is not None else None

    @_keyed
    async def create_connection_token(self, account_id: str) -> str:  # pragma: no cover
        token = await stripe.terminal.ConnectionToken.create_async(stripe_account=account_id)
        return str(token.secret)

    @_keyed
    async def create_terminal_location(  # pragma: no cover
        self, account_id: str, *, display_name: str, address: PostalAddress
    ) -> str:
        fields: stripe.params.terminal.LocationCreateParamsAddress = {
            "line1": address.line1,
            "city": address.city,
            "state": address.province,
            "postal_code": address.postal_code,
            "country": "CA",
        }
        if address.line2 is not None:
            fields["line2"] = address.line2
        location = await stripe.terminal.Location.create_async(
            display_name=display_name, address=fields, stripe_account=account_id
        )
        return str(location.id)

    @_keyed
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
        intent = await stripe.PaymentIntent.create_async(
            amount=amount_cents,
            currency=currency.lower(),
            allowed_payment_method_types=["card_present"],
            application_fee_amount=application_fee_cents,
            metadata=metadata,
            stripe_account=account_id,
            idempotency_key=idempotency_key,
        )
        if "card_present" not in intent.payment_method_types:
            raise Conflict("complete payments setup before taking in-person card payments")
        return PaymentIntentResult(id=str(intent.id), client_secret=str(intent.client_secret))

    def verify_webhook(self, payload: bytes, signature: str) -> GatewayEvent:
        try:
            event = json.loads(payload)
        except ValueError as exc:
            raise WebhookVerificationError("the payload is not JSON") from exc
        if not isinstance(event, dict):
            raise WebhookVerificationError("the payload is not an event")
        # the Connect endpoint and the thin event destination each sign with their own secret
        secret = (
            self._thin_webhook_secret if event.get("object") == THIN_EVENT else self._webhook_secret
        )
        if not secret:
            raise WebhookVerificationError("no signing secret is configured for this event")
        try:
            stripe.WebhookSignature.verify_header(
                payload.decode(), signature, secret, stripe.Webhook.DEFAULT_TOLERANCE
            )
        except Exception as exc:
            raise WebhookVerificationError(str(exc)) from exc
        return event_from(cast(dict[str, object], event))


def period_timestamp(sub: dict[str, object], edge: str) -> int | None:
    """A subscription's current period edge: on its first item since the basil API version."""
    items = sub.get("items")
    rows = items.get("data") if isinstance(items, dict) else None
    first = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}
    ts = first.get(f"current_period_{edge}", sub.get(f"current_period_{edge}"))
    return ts if isinstance(ts, int) else None


def _period_of(sub: stripe.Subscription, edge: str) -> int:
    ts = period_timestamp(sub.to_dict(), edge)
    if ts is None:
        raise ValueError(f"subscription {sub.id} has no current_period_{edge}")
    return ts


def get_payment_gateway() -> PaymentGateway:
    s = get_settings()
    return StripeGateway(
        s.stripe_secret_key,
        s.stripe_webhook_secret,
        s.stripe_connect_country,
        s.stripe_thin_webhook_secret,
    )
