"""Plan, and with --apply create, the Stripe sandbox objects the demo needs, via the Stripe CLI."""

import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast
from urllib.parse import parse_qs, urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.deployment import payment_domains
from clientbridge.core.errors import Unprocessable
from clientbridge.core.locale import SOURCE_LOCALE
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import (
    ACCOUNT_EVENTS,
    PLAN_EVENTS,
    RESPONSIBILITIES,
    STRIPE_API_VERSION,
    PostalAddress,
    account_status_from,
    merchant_capability,
    payment_descriptor,
)
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod
from clientbridge.services.business import apply_account_status, postal_address
from clientbridge.services.plans import (
    PLAN_CURRENCY,
    PLAN_PRICES,
    PLAN_TAX_CODE,
    PlanPrice,
    product_names,
)

TAG = "clientbridge"
DOMAIN = re.compile(r"[a-z0-9-]+(\.[a-z0-9-]+)+")
WEBHOOK_KEY = "connect_webhook"
PLATFORM_WEBHOOK_KEY = "platform_webhook"
PORTAL_KEY = "portal"
PORTAL_FEATURES: dict[str, object] = {
    "customer_update": {"enabled": True, "allowed_updates": ["email", "address"]},
    "invoice_history": {"enabled": True},
    "payment_method_update": {"enabled": True},
    "subscription_cancel": {"enabled": True, "mode": "at_period_end"},
    # the portal cannot manage the seat item, so plan changes go through the app
    "subscription_update": {"enabled": False},
}
DESTINATION_KEY = "account_events"
DEMO_TAG = "clientbridge_demo"
WEBHOOK_EVENTS = (
    "charge.dispute.closed",
    "charge.dispute.created",
    "charge.dispute.funds_reinstated",
    "charge.dispute.funds_withdrawn",
    "charge.dispute.updated",
    "customer.subscription.deleted",
    "customer.subscription.updated",
    "invoice.payment_failed",
    "invoice.payment_succeeded",
    "mandate.updated",
    "payment_intent.canceled",
    "payment_intent.payment_failed",
    "payment_intent.succeeded",
    "payment_method.attached",
    "payment_method.automatically_updated",
    "payout.canceled",
    "payout.created",
    "payout.failed",
    "payout.paid",
    "refund.created",
    "refund.updated",
    "setup_intent.setup_failed",
    "setup_intent.succeeded",
)
CAPABILITIES = ("card_payments", "link_payments", "acss_debit_payments")
ACCOUNT_INCLUDE = ["configuration.merchant", "defaults", "requirements"]
# Stripe's documented v2 test values: 1901-01-01 and SIN 000000000 verify, address_full_match passes
TEST_INDIVIDUAL: dict[str, object] = {
    "date_of_birth": {"day": 1, "month": 1, "year": 1901},
    "id_numbers": [{"type": "ca_sin", "value": "000000000"}],
}
ONBOARDING_STEPS = (
    "Stripe collects the rest of KYC itself, so finish onboarding once per demo business: sign in "
    "as its owner, open Settings > Getting paid and complete the embedded form",
    "test values: SMS code 000-000, bank transit 11000 institution 000 account 000123456789, "
    "and accept the service agreement",
)
TEST_CARDS = {"visa": "pm_card_visa", "mastercard": "pm_card_mastercard", "amex": "pm_card_amex"}
CLIENT_TAG = "clientbridge_demo_client"

DASHBOARD_STEPS = (
    "Connect platform profile and the Connect onboarding questionnaire (Settings > Connect)",
    "platform business details, public name, support email and statement descriptor "
    "(the API cannot update the platform's own account)",
    "Connect branding for connected accounts: icon, logo, colours (Settings > Connect > Branding)",
    "payment methods for connected accounts: cards, Link, Apple Pay, Google Pay and "
    "Canadian pre-authorized debit (Settings > Connect > Payment methods)",
    "Terminal and Tap to Pay: enable Terminal for the platform and Tap to Pay on iPhone/Android "
    "for Canada; real-device testing needs the Apple entitlement",
    "the sandbox default API version, which `stripe listen` uses for snapshot payloads unless "
    f"--latest; handlers parse {STRIPE_API_VERSION} (thin account events are unversioned)",
    "Connect email settings: which payment and payout emails Stripe sends to connected accounts",
    "Billing customer emails for plan subscriptions: receipts, failed payments and upcoming "
    "renewals (Settings > Billing > Subscriptions and emails)",
    "Smart Retries for failed plan payments, cancelling the subscription after the last retry "
    "(Settings > Billing > Revenue recovery)",
    "Stripe Tax for plan subscriptions: the platform's head office address and its GST/HST and "
    "QST registrations (Settings > Tax); plan Checkout enables automatic tax",
)

type Runner = Callable[[Sequence[str]], str]
type Json = dict[str, object]
type Action = Literal["create", "update", "keep", "blocked"]


@dataclass(frozen=True)
class DemoBusiness:
    id: str
    name: str
    email: str
    first_name: str
    last_name: str
    phone: str
    city: str
    province: str
    postal_code: str
    product_description: str
    primary_color: str
    url: str | None = None


DEMO_BUSINESSES = (
    DemoBusiness(
        id="bz_birchbark",
        name="Birchbark Pet Studio",
        email="hello@birchbarkpets.ca",
        first_name="Hannah",
        last_name="Wong",
        phone="+16045550123",
        city="Victoria",
        province="BC",
        postal_code="V8W 1A1",
        product_description="Pet grooming and daycare",
        primary_color="#2E4A3F",
        url="https://birchbarkpets.ca",
    ),
    DemoBusiness(
        id="bz_demo_second",
        name="Cedar Coast Pet Care",
        email="owner@cedarcoast.example.test",
        first_name="Rowan",
        last_name="Ellis",
        phone="+16045550199",
        city="Vancouver",
        province="BC",
        postal_code="V6B 1A1",
        product_description="Pet care for tenant isolation checks",
        primary_color="#35576B",
    ),
)


@dataclass(frozen=True)
class Step:
    action: Action
    target: str
    detail: str
    method: Literal["post", "delete", ""] = ""
    path: str = ""
    params: tuple[str, ...] = ()
    account: str | None = None
    idempotency: str | None = None


def form(params: Mapping[str, object], prefix: str = "") -> list[str]:
    pairs: list[str] = []
    for key, value in params.items():
        name = f"{prefix}[{key}]" if prefix else key
        if isinstance(value, Mapping):
            pairs += form(cast(Mapping[str, object], value), name)
        elif isinstance(value, list | tuple):
            pairs += [f"{name}[]={item}" for item in value]
        elif isinstance(value, bool):
            pairs.append(f"{name}={str(value).lower()}")
        else:
            pairs.append(f"{name}={value}")
    return pairs


def _map(value: object) -> Mapping[str, object]:
    return cast(Mapping[str, object], value) if isinstance(value, dict) else {}


def _strings(value: object) -> list[str]:
    return [str(v) for v in value] if isinstance(value, list) else []


def parse_config(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            values["project"] = line[1:-1]
        elif "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip("'\"")
    return values


def safety_problems(
    config: Mapping[str, str],
    platform: Mapping[str, object],
    balance: Mapping[str, object],
    *,
    env: str,
    expected_account: str | None,
    env_api_key: str,
) -> list[str]:
    problems: list[str] = []
    if env != "dev":
        problems.append(f"ENV is {env!r}; this script runs only with ENV=dev")
    if not config.get("test_mode_api_key"):
        problems.append("the Stripe CLI has no test-mode key; run `stripe login`")
    if env_api_key and not env_api_key.startswith(("sk_test_", "rk_test_")):
        problems.append("STRIPE_API_KEY in the environment is not a test-mode key")
    if balance.get("livemode") is not False:
        problems.append("the CLI did not answer in test mode")
    account = str(platform.get("id", ""))
    if account != config.get("account_id"):
        problems.append("the platform account does not match the CLI profile")
    if expected_account is not None and account != expected_account:
        problems.append(f"the CLI is authenticated to {account}, not {expected_account}")
    name = config.get("display_name", "")
    if expected_account is None and TAG not in name.lower():
        problems.append(
            f"the CLI is authenticated to {name!r} ({account}), which is not named Clientbridge; "
            "pass --project-name for a Clientbridge sandbox, or --account to confirm this one"
        )
    return problems


def platform_warnings(platform: Mapping[str, object], country: str) -> list[str]:
    warnings: list[str] = []
    if platform.get("country") != country:
        warnings.append(
            f"the platform is in {platform.get('country')}, but STRIPE_CONNECT_COUNTRY is "
            f"{country}; Clientbridge is a Canadian platform"
        )
    profile = _map(platform.get("business_profile"))
    if TAG not in str(profile.get("name") or "").lower():
        warnings.append("the platform's public business name is not Clientbridge (Dashboard)")
    return warnings


def webhook_url_problem(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return "the webhook URL must be public https; use `stripe listen` locally"
    if parsed.hostname in (None, "localhost", "127.0.0.1", "0.0.0.0"):
        return "the webhook URL must be a public host; use `stripe listen` locally"
    if not parsed.path.endswith("/webhooks/stripe"):
        return "the webhook URL must end in /webhooks/stripe"
    return None


def _is_connect(endpoint: Mapping[str, object]) -> bool:
    # `connect` is create-only; a Connect endpoint reads back with the platform's application
    return endpoint.get("application") is not None


def _plan_endpoint(
    endpoints: Sequence[Mapping[str, object]],
    url: str | None,
    *,
    key: str,
    connect: bool,
    events: Sequence[str],
    target: str,
    description: str,
) -> Step:
    ours = [e for e in endpoints if _map(e.get("metadata")).get(TAG) == key]
    if url is None:
        detail = "no --webhook-url; forward locally with `stripe listen` (printed below)"
        return Step("keep", target, f"{len(ours)} registered; {detail}")
    problem = webhook_url_problem(url)
    if problem is not None:
        return Step("blocked", target, problem)
    found = ours or [e for e in endpoints if e.get("url") == url and _is_connect(e) == connect]
    if len(found) > 1:
        ids = ", ".join(str(e.get("id")) for e in found)
        return Step("blocked", target, f"several endpoints match ({ids}); delete the extras")
    params = {
        "url": url,
        "enabled_events": list(events),
        "description": description,
        "metadata": {TAG: key},
    }
    if not found:
        scope = "Connect" if connect else "platform"
        return Step(
            "create",
            target,
            f"{url} for {len(events)} {scope} events at {STRIPE_API_VERSION}",
            "post",
            "/v1/webhook_endpoints",
            tuple(form({**params, "connect": connect, "api_version": STRIPE_API_VERSION})),
        )
    endpoint = found[0]
    endpoint_id = str(endpoint.get("id"))
    if _is_connect(endpoint) != connect or endpoint.get("api_version") != STRIPE_API_VERSION:
        return Step(
            "blocked",
            target,
            f"{endpoint_id} is connect={_is_connect(endpoint)} at "
            f"{endpoint.get('api_version')}; both are fixed at creation, so delete it in the "
            f"Dashboard and rerun to create one at {STRIPE_API_VERSION}",
        )
    changes: list[str] = []
    if endpoint.get("url") != url:
        changes.append("url")
    if set(_strings(endpoint.get("enabled_events"))) != set(events):
        changes.append("events")
    if endpoint.get("status") != "enabled":
        changes.append("enable")
    if _map(endpoint.get("metadata")).get(TAG) != key:
        changes.append("metadata")
    if not changes:
        return Step("keep", target, f"{endpoint_id} is current")
    return Step(
        "update",
        target,
        f"{endpoint_id}: {', '.join(changes)}",
        "post",
        f"/v1/webhook_endpoints/{endpoint_id}",
        tuple(form({**params, "disabled": False})),
    )


def plan_webhook(endpoints: Sequence[Mapping[str, object]], url: str | None) -> Step:
    return _plan_endpoint(
        endpoints,
        url,
        key=WEBHOOK_KEY,
        connect=True,
        events=WEBHOOK_EVENTS,
        target="connect webhook endpoint",
        description="Clientbridge Connect events",
    )


def plan_platform_webhook(endpoints: Sequence[Mapping[str, object]], url: str | None) -> Step:
    return _plan_endpoint(
        endpoints,
        url,
        key=PLATFORM_WEBHOOK_KEY,
        connect=False,
        events=PLAN_EVENTS,
        target="platform webhook endpoint",
        description="Clientbridge plan subscriptions",
    )


def plan_product(product_id: str, name: str, existing: Mapping[str, object] | None) -> Step:
    target = f"product {product_id}"
    params = {"name": name, "tax_code": PLAN_TAX_CODE, "active": True}
    if existing is None:
        return Step(
            "create",
            target,
            name,
            "post",
            "/v1/products",
            tuple(form({"id": product_id, **params})),
            idempotency=f"clientbridge-product-{product_id}",
        )
    changes = [
        field
        for field in ("name", "tax_code", "active")
        if existing.get(field) != params[field]
        and not (field == "tax_code" and _map(existing.get("tax_code")).get("id") == PLAN_TAX_CODE)
    ]
    if not changes:
        return Step("keep", target, name)
    return Step(
        "update",
        target,
        f"set {', '.join(changes)}",
        "post",
        f"/v1/products/{product_id}",
        tuple(form(params)),
    )


def plan_price(key: str, price: PlanPrice, found: Sequence[Mapping[str, object]]) -> Step:
    target = f"price {key}"
    terms = f"{price.amount_cents} {PLAN_CURRENCY} per {price.interval} on {price.product}"
    params: dict[str, object] = {
        "product": price.product,
        "unit_amount": price.amount_cents,
        "currency": PLAN_CURRENCY,
        "recurring": {"interval": price.interval},
        "tax_behavior": "exclusive",
        "lookup_key": key,
    }
    current = next((p for p in found if p.get("lookup_key") == key), None)
    if current is None:
        return Step(
            "create",
            target,
            terms,
            "post",
            "/v1/prices",
            tuple(form(params)),
            idempotency=f"clientbridge-price-{key}",
        )
    matches = (
        current.get("active") is True
        and current.get("product") == price.product
        and current.get("unit_amount") == price.amount_cents
        and current.get("currency") == PLAN_CURRENCY
        and _map(current.get("recurring")).get("interval") == price.interval
        and current.get("tax_behavior") == "exclusive"
    )
    if matches:
        return Step("keep", target, f"{current.get('id')}: {terms}")
    # a price's terms are fixed, so a new price takes the key and subscriptions keep the old one
    return Step(
        "create",
        target,
        f"{terms}, replacing {current.get('id')} (transfer_lookup_key)",
        "post",
        "/v1/prices",
        tuple(form({**params, "transfer_lookup_key": True})),
        # keyed on the price it replaces, so swinging a price back within 24 hours never replays
        idempotency=f"clientbridge-price-{key}-replacing-{current.get('id')}",
    )


def _same(current: object, wanted: object) -> bool:
    # Stripe may list a setting's values in another order than we sent them
    if isinstance(current, list) and isinstance(wanted, list):
        return set(_strings(current)) == set(_strings(wanted))
    return current == wanted


def plan_portal(configurations: Sequence[Mapping[str, object]], return_url: str) -> Step:
    target = "billing portal configuration"
    ours = ours_portal(configurations)
    if len(ours) > 1:
        ids = ", ".join(str(c.get("id")) for c in ours)
        return Step("blocked", target, f"several configurations match ({ids}); deactivate extras")
    params: dict[str, object] = {
        "features": PORTAL_FEATURES,
        "default_return_url": return_url,
        "metadata": {TAG: PORTAL_KEY},
    }
    if not ours:
        return Step(
            "create",
            target,
            "payment method, invoices, email and address, cancel at period end, no plan switching",
            "post",
            "/v1/billing_portal/configurations",
            tuple(form(params)),
        )
    config = ours[0]
    config_id = str(config.get("id"))
    features = _map(config.get("features"))
    changes = [
        name
        for name, wanted in PORTAL_FEATURES.items()
        if any(not _same(_map(features.get(name)).get(k), v) for k, v in _map(wanted).items())
    ]
    if config.get("default_return_url") != return_url:
        changes.append("default_return_url")
    if config.get("active") is not True:
        changes.append("active")
    if not changes:
        return Step("keep", target, f"{config_id} is current")
    return Step(
        "update",
        target,
        f"{config_id}: {', '.join(changes)}",
        "post",
        f"/v1/billing_portal/configurations/{config_id}",
        tuple(form({**params, "active": True})),
    )


def ours_portal(configurations: Sequence[Mapping[str, object]]) -> list[Mapping[str, object]]:
    return [c for c in configurations if _map(c.get("metadata")).get(TAG) == PORTAL_KEY]


def plan_billing(
    stripe: "Stripe", portals: Sequence[Mapping[str, object]], return_url: str
) -> list[Step]:
    names = product_names(SOURCE_LOCALE)
    steps = [
        plan_product(product_id, name, stripe.get_optional(f"/v1/products/{product_id}"))
        for product_id, name in names.items()
    ]
    keys = [f"lookup_keys[]={key}" for key in PLAN_PRICES]
    found = cast(list[Json], stripe.call("get", "/v1/prices", keys).get("data") or [])
    steps += [plan_price(key, price, found) for key, price in PLAN_PRICES.items()]
    steps.append(plan_portal(portals, return_url))
    return steps


def plan_destination(destinations: Sequence[Mapping[str, object]], url: str | None) -> Step:
    target = "account event destination"
    ours = [d for d in destinations if _map(d.get("metadata")).get(TAG) == DESTINATION_KEY]
    if url is None:
        detail = "no --webhook-url; forward locally with `stripe listen` (printed below)"
        return Step("keep", target, f"{len(ours)} registered; {detail}")
    problem = webhook_url_problem(url)
    if problem is not None:
        return Step("blocked", target, problem)
    if len(ours) > 1:
        ids = ", ".join(str(d.get("id")) for d in ours)
        return Step("blocked", target, f"several destinations match ({ids}); delete the extras")
    if not ours:
        body = {
            "name": "Clientbridge account events",
            "type": "webhook_endpoint",
            "event_payload": "thin",
            "events_from": ["@self"],
            "enabled_events": list(ACCOUNT_EVENTS),
            "webhook_endpoint": {"url": url},
            "metadata": {TAG: DESTINATION_KEY},
            "include": ["webhook_endpoint.signing_secret"],
        }
        return Step(
            "create",
            target,
            f"{url} for {len(ACCOUNT_EVENTS)} thin account events",
            "post",
            "/v2/core/event_destinations",
            (json.dumps(body),),
        )
    destination = ours[0]
    destination_id = str(destination.get("id"))
    if destination.get("event_payload") != "thin" or destination.get("status") != "enabled":
        return Step(
            "blocked",
            target,
            f"{destination_id} is {destination.get('event_payload')}/"
            f"{destination.get('status')}; enable it or delete it in Workbench and rerun",
        )
    changes: dict[str, object] = {}
    if set(_strings(destination.get("enabled_events"))) != set(ACCOUNT_EVENTS):
        changes["enabled_events"] = list(ACCOUNT_EVENTS)
    if _map(destination.get("webhook_endpoint")).get("url") != url:
        changes["webhook_endpoint"] = {"url": url}
    if not changes:
        return Step("keep", target, f"{destination_id} is current")
    return Step(
        "update",
        target,
        f"{destination_id}: {', '.join(sorted(changes))}",
        "post",
        f"/v2/core/event_destinations/{destination_id}",
        (json.dumps(changes),),
    )


def account_body(biz: DemoBusiness) -> dict[str, object]:
    descriptor = payment_descriptor(biz.name) or ""
    support: dict[str, object] = {"email": biz.email}
    profile: dict[str, object] = {"product_description": biz.product_description}
    if biz.url is not None:
        support["url"] = biz.url
        profile["business_url"] = biz.url
    return {
        "display_name": biz.name,
        "contact_email": biz.email,
        "dashboard": "none",
        "metadata": {DEMO_TAG: biz.id},
        "identity": {
            "country": "ca",
            "entity_type": "individual",
            "individual": {
                **TEST_INDIVIDUAL,
                "given_name": biz.first_name,
                "surname": biz.last_name,
                "email": biz.email,
                "phone": biz.phone,
                "address": {
                    "line1": "address_full_match",
                    "city": biz.city,
                    "state": biz.province,
                    "postal_code": biz.postal_code,
                    "country": "ca",
                },
            },
        },
        "configuration": {
            "merchant": {
                "capabilities": {name: {"requested": True} for name in CAPABILITIES},
                "mcc": "7299",
                "statement_descriptor": {
                    "descriptor": descriptor,
                    "prefix": descriptor[:10].rstrip(),
                },
                "branding": {"primary_color": biz.primary_color},
                "support": support,
            }
        },
        "defaults": {
            "currency": "cad",
            "locales": ["en-CA"],
            "profile": profile,
            "responsibilities": dict(RESPONSIBILITIES),
        },
        "include": ACCOUNT_INCLUDE,
    }


def _account_key(biz: DemoBusiness, closed: Sequence[Mapping[str, object]]) -> str:
    # Stripe replays a key for 30 days, so after a close the key must change to create anew
    gone = sorted(str(a.get("id")) for a in find_account(closed, biz))
    if not gone:
        return f"clientbridge-demo-account-{biz.id}"
    digest = hashlib.sha256(",".join(gone).encode()).hexdigest()[:12]
    return f"clientbridge-demo-account-{biz.id}-after-{digest}"


def find_account(accounts: Sequence[Mapping[str, object]], biz: DemoBusiness) -> list[Json]:
    return [dict(a) for a in accounts if _map(a.get("metadata")).get(DEMO_TAG) == biz.id]


def account_summary(account: Json) -> str:
    status = account_status_from(str(account.get("id")), account)
    capabilities = {
        name: merchant_capability(account, *name.split(".")).get("status")
        for name in (*CAPABILITIES, "stripe_balance.payouts")
    }
    summary = (
        f"charges={status.charges_enabled} payouts={status.payouts_enabled} "
        f"capabilities={capabilities}"
    )
    owed = [*status.past_due, *status.currently_due]
    if owed:
        summary += f"; onboarding still needs {', '.join(owed)}"
    return summary


def plan_account(
    biz: DemoBusiness,
    matches: Sequence[Mapping[str, object]],
    closed: Sequence[Mapping[str, object]] = (),
) -> Step:
    target = f"connected account for {biz.id}"
    if len(matches) > 1:
        ids = ", ".join(str(a.get("id")) for a in matches)
        return Step("blocked", target, f"several accounts carry {DEMO_TAG}={biz.id}: {ids}")
    if not matches:
        return Step(
            "create",
            target,
            f"Accounts v2 merchant '{biz.name}' with {', '.join(CAPABILITIES)}, no Stripe "
            "dashboard, Stripe-owned fees and losses, and v2 test identity data",
            "post",
            "/v2/core/accounts",
            (json.dumps(account_body(biz)),),
            idempotency=_account_key(biz, closed),
        )
    account = dict(matches[0])
    account_id = str(account.get("id"))
    responsibilities = _map(_map(account.get("defaults")).get("responsibilities"))
    fixed = {k: responsibilities.get(k) for k in RESPONSIBILITIES}
    if account.get("dashboard") != "none" or fixed != dict(RESPONSIBILITIES):
        return Step(
            "blocked",
            target,
            f"{account_id} has dashboard={account.get('dashboard')} and {fixed}; both are fixed "
            "at creation, so close it in the Dashboard and rerun to create one",
        )
    merchant: dict[str, object] = {}
    missing = [name for name in CAPABILITIES if not merchant_capability(account, name)]
    if missing:
        merchant["capabilities"] = {name: {"requested": True} for name in missing}
    configured = _map(_map(account.get("configuration")).get("merchant"))
    if not _map(configured.get("branding")).get("primary_color"):
        merchant["branding"] = {"primary_color": biz.primary_color}
    summary = account_summary(account)
    if not merchant:
        return Step("keep", target, f"{account_id}: {summary}")
    body = {"configuration": {"merchant": merchant}, "include": ACCOUNT_INCLUDE}
    return Step(
        "update",
        target,
        f"{account_id}: set {', '.join(sorted(merchant))}; {summary}",
        "post",
        f"/v2/core/accounts/{account_id}",
        (json.dumps(body),),
    )


def plan_location(
    business: Business,
    account_id: str,
    address: PostalAddress,
    locations: Sequence[Mapping[str, object]],
) -> Step:
    target = f"terminal location for {business.id}"
    ours = [x for x in locations if _map(x.get("metadata")).get(DEMO_TAG) == business.id]
    if ours:
        return Step("keep", target, str(ours[0].get("id")), account=account_id)
    fields: dict[str, object] = {
        "line1": address.line1,
        "city": address.city,
        "state": address.province,
        "postal_code": address.postal_code,
        "country": "CA",
    }
    if address.line2 is not None:
        fields["line2"] = address.line2
    params = {"display_name": business.name, "address": fields, "metadata": {DEMO_TAG: business.id}}
    return Step(
        "create",
        target,
        f"{address.line1}, {address.city} {address.province} {address.postal_code}",
        "post",
        "/v1/terminal/locations",
        tuple(form(params)),
        account=account_id,
    )


def plan_payment_domains(
    business_id: str,
    account_id: str | None,
    existing: Sequence[Mapping[str, object]],
    domains: Sequence[str],
) -> list[Step]:
    if account_id is None:
        detail = "the account does not exist yet; rerun after --apply creates it"
        return [Step("keep", f"payment method domains for {business_id}", detail)]
    found = {str(d.get("domain_name")): d for d in existing}
    steps: list[Step] = []
    for domain in domains:
        target = f"payment method domain {domain} on {business_id}"
        current = found.get(domain)
        if current is None:
            params = ("domain_name=" + domain, "enabled=true")
            path = "/v1/payment_method_domains"
            steps.append(Step("create", target, account_id, "post", path, params, account_id))
        elif current.get("enabled") is not True:
            path = f"/v1/payment_method_domains/{current.get('id')}"
            detail = f"{current.get('id')}: enable"
            steps.append(
                Step("update", target, detail, "post", path, ("enabled=true",), account_id)
            )
        else:
            steps.append(
                Step("keep", target, f"{current.get('id')} is enabled", account=account_id)
            )
    return steps


class Stripe:
    def __init__(self, runner: Runner, project: str | None) -> None:
        self.runner = runner
        self.project = project

    def text(self, *args: str) -> str:
        extra = ["--project-name", self.project] if self.project else []
        return self.runner([*args, *extra])

    def call(
        self,
        method: str,
        path: str,
        params: Sequence[str] = (),
        *,
        account: str | None = None,
        idempotency: str | None = None,
    ) -> Json:
        args = [method, path, "--stripe-version", STRIPE_API_VERSION]
        for pair in params:
            args += ["-d", pair]
        if account is not None:
            args += ["--stripe-account", account]
        if idempotency is not None:
            args += ["--idempotency", idempotency]
        body = json.loads(self.text(*args) or "{}")
        if not isinstance(body, dict):
            raise SystemExit(f"unexpected Stripe CLI output for {path}")
        if "error" in body:
            message = _map(body["error"]).get("message")
            raise SystemExit(f"Stripe rejected {method.upper()} {path}: {message}")
        return cast(Json, body)

    def find(self, path: str, account: str) -> bool:
        args = ["get", path, "--stripe-version", STRIPE_API_VERSION, "--stripe-account", account]
        try:
            body = json.loads(self.text(*args) or "{}")
        except SystemExit:
            return False
        return isinstance(body, dict) and "error" not in body and not body.get("deleted")

    def get_optional(self, path: str) -> Json | None:
        args = ["get", path, "--stripe-version", STRIPE_API_VERSION]
        body = json.loads(self.text(*args) or "{}")
        if not isinstance(body, dict) or "error" in body or "id" not in body:
            return None
        return cast(Json, body)

    def listen_secret(self) -> str:
        return self.text("listen", "--print-secret").strip()

    def default_api_version(self) -> str | None:
        events = self.call("get", "/v1/events", ["limit=1"]).get("data")
        first = events[0] if isinstance(events, list) and events else None
        version = first.get("api_version") if isinstance(first, dict) else None
        return version if isinstance(version, str) else None

    def account(self, account_id: str) -> Json:
        include = json.dumps({"include": ACCOUNT_INCLUDE})
        return self.call("get", f"/v2/core/accounts/{account_id}", [include])

    def list_v2(self, path: str, *, closed: bool = False) -> list[Json]:
        rows: list[Json] = []
        page: str | None = None
        while True:
            query: dict[str, object] = {"limit": 20, **({"page": page} if page else {})}
            if closed:
                query["closed"] = True
            if path == "/v2/core/event_destinations":
                query["include"] = ["webhook_endpoint.url"]
            body = self.call("get", path, [json.dumps(query)])
            rows += [cast(Json, r) for r in cast(list[object], body.get("data") or [])]
            next_url = body.get("next_page_url")
            if not isinstance(next_url, str) or not next_url:
                return rows
            page = parse_qs(urlparse(next_url).query).get("page", [""])[0] or None
            if page is None:
                return rows

    def list_all(self, path: str, *, account: str | None = None) -> list[Json]:
        rows: list[Json] = []
        after: str | None = None
        while True:
            params = ["limit=100", *([f"starting_after={after}"] if after else [])]
            page = self.call("get", path, params, account=account)
            rows += [
                cast(Json, r)
                for r in cast(list[object], page.get("data") or [])
                if isinstance(r, dict)
            ]
            if not page.get("has_more") or not rows:
                return rows
            after = str(rows[-1].get("id"))

    def run(self, step: Step) -> Json:
        # Stripe replays a key only for identical parameters, so a changed request gets its own key.
        digest = hashlib.sha256("&".join(step.params).encode()).hexdigest()[:16]
        return self.call(
            step.method,
            step.path,
            step.params,
            account=step.account,
            idempotency=f"{step.idempotency}-{digest}" if step.idempotency else None,
        )


@dataclass(frozen=True)
class ApiRequest:
    query: list[tuple[str, str]]
    form: dict[str, list[str]] | None
    body: str | None


def api_request(method: str, path: str, params: Sequence[str]) -> ApiRequest:
    """The CLI-shaped parameters as Stripe's REST API takes them: v2 as JSON, v1 as form pairs."""
    if path.startswith("/v2/"):
        merged: dict[str, object] = {}
        for each in params:
            merged.update(cast(dict[str, object], json.loads(each)))
        if method != "get":
            return ApiRequest([], None, json.dumps(merged))
        query: list[tuple[str, str]] = []
        for key, value in merged.items():
            for item in cast(list[object], value) if isinstance(value, list) else [value]:
                query.append((key, str(item).lower() if isinstance(item, bool) else str(item)))
        return ApiRequest(query, None, None)
    pairs = [(key, value) for key, _, value in (each.partition("=") for each in params)]
    if method == "get":
        return ApiRequest(pairs, None, None)
    form: dict[str, list[str]] = {}
    for key, value in pairs:
        form.setdefault(key, []).append(value)
    return ApiRequest([], form, None)


class ApiStripe(Stripe):
    """The same calls through Stripe's REST API with a secret key, for hosts without the CLI."""

    def __init__(self, api_key: str) -> None:
        super().__init__(cli_runner, None)
        self.api_key = api_key

    def text(self, *args: str) -> str:
        raise SystemExit(f"stripe {args[0]} needs the Stripe CLI, which this run does not use")

    def call(
        self,
        method: str,
        path: str,
        params: Sequence[str] = (),
        *,
        account: str | None = None,
        idempotency: str | None = None,
    ) -> Json:
        body = self._send(method, path, params, account, idempotency)
        if "error" in body:
            message = _map(body["error"]).get("message")
            raise SystemExit(f"Stripe rejected {method.upper()} {path}: {message}")
        return body

    def find(self, path: str, account: str) -> bool:
        body = self._send("get", path, (), account, None)
        return "error" not in body and not body.get("deleted")

    def _send(
        self,
        method: str,
        path: str,
        params: Sequence[str],
        account: str | None,
        idempotency: str | None,
    ) -> Json:
        request = api_request(method, path, params)
        headers = {"Authorization": f"Bearer {self.api_key}", "Stripe-Version": STRIPE_API_VERSION}
        if account is not None:
            headers["Stripe-Account"] = account
        if idempotency is not None:
            headers["Idempotency-Key"] = idempotency
        if request.body is not None:
            headers["Content-Type"] = "application/json"
        response = httpx.request(
            method.upper(),
            f"https://api.stripe.com{path}",
            params=tuple(request.query),
            data=request.form,
            content=request.body,
            headers=headers,
            timeout=60,
        )
        parsed: object = response.json()
        return cast(Json, parsed) if isinstance(parsed, dict) else {}


def cli_runner(args: Sequence[str]) -> str:
    result = subprocess.run(["stripe", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise SystemExit(f"stripe {args[0]} failed: {result.stderr.strip()[:300]}")
    return result.stdout


def listen_args(api_base: str) -> list[list[str]]:
    # Snapshot and thin events need separate listeners; Connect and platform events share one.
    host = urlparse(api_base).netloc or "127.0.0.1:8701"
    target = f"{host}/webhooks/stripe"
    events = ",".join(dict.fromkeys([*WEBHOOK_EVENTS, *PLAN_EVENTS]))
    snapshot = ["listen", "--forward-connect-to", target, "--events", events]
    snapshot[1:1] = ["--forward-to", target]
    thin = ["listen", "--forward-to", target, "--events", ",".join(ACCOUNT_EVENTS)]
    return [snapshot, thin]


def run_listeners(commands: Sequence[Sequence[str]]) -> int:
    procs = [subprocess.Popen(["stripe", *command]) for command in commands]
    try:
        while all(proc.poll() is None for proc in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    for proc in procs:
        if proc.poll() is None:
            proc.terminate()
    return max(proc.wait() for proc in procs)


def redact(value: str) -> str:
    known = ("sk_test_", "rk_test_", "pk_test_", "whsec_")
    prefix = next((p for p in known if value.startswith(p)), "")
    return f"{prefix}...{value[-4:]}" if value else "<empty>"


def show(step: Step) -> None:
    print(f"  [{step.action:7}] {step.target}: {step.detail}")


@dataclass(frozen=True)
class Change:
    table: str
    row: str
    column: str
    old: object
    new: object


def column_changes(
    table: str, row: str, values: Mapping[str, tuple[object, object]]
) -> list[Change]:
    return [Change(table, row, c, old, new) for c, (old, new) in values.items() if old != new]


def card_token_for(brand: str | None) -> str:
    return TEST_CARDS.get((brand or "").lower(), "pm_card_visa")


class Linker:
    """Points the demo rows at the sandbox objects; writes only with apply."""

    def __init__(self, stripe: Stripe, db: AsyncSession, *, apply: bool) -> None:
        self.stripe = stripe
        self.db = db
        self.apply = apply
        self.changes: list[Change] = []
        self.steps: list[Step] = []

    async def business(self, biz: DemoBusiness, account: Json | None) -> None:
        business = await self.db.get(Business, biz.id)
        if business is None:
            self.steps.append(Step("blocked", biz.id, "not in the database; run `make seed`"))
            return
        if account is None:
            self.steps.append(Step("blocked", biz.id, "its connected account does not exist yet"))
            return
        account_id = str(account["id"])
        status = account_status_from(account_id, account)
        location = await self._location(business, account_id)
        self.changes += column_changes(
            "businesses",
            business.id,
            {
                "stripe_account_id": (business.stripe_account_id, account_id),
                "stripe_terminal_location_id": (business.stripe_terminal_location_id, location),
                "stripe_charges_enabled": (business.stripe_charges_enabled, status.charges_enabled),
                "stripe_payouts_enabled": (business.stripe_payouts_enabled, status.payouts_enabled),
            },
        )
        if self.apply:
            business.stripe_account_id = account_id
            business.stripe_terminal_location_id = location
            apply_account_status(business, status)
        if status.charges_enabled:
            await self._cards(business, account_id)
        else:
            # Stripe refuses to attach cards until the account can charge, which needs onboarding.
            self.steps.append(
                Step("keep", f"saved cards for {business.id}", "after onboarding; rerun this then")
            )

    async def _location(self, business: Business, account_id: str) -> str | None:
        try:
            address = postal_address(business)
        except Unprocessable as exc:
            self.steps.append(Step("blocked", f"terminal location for {business.id}", exc.message))
            return business.stripe_terminal_location_id
        existing = self.stripe.list_all("/v1/terminal/locations", account=account_id)
        step = plan_location(business, account_id, address, existing)
        self.steps.append(step)
        if step.action == "keep":
            return step.detail
        return str(self.stripe.run(step)["id"]) if self.apply else "<new tml_>"

    async def _cards(self, business: Business, account_id: str) -> None:
        methods = (
            (
                await self.db.execute(
                    scoped(PaymentMethod, business.id).where(PaymentMethod.method == "card")
                )
            )
            .scalars()
            .all()
        )
        for method in sorted(methods, key=lambda m: m.id):
            ref = method.provider_ref
            live = ref is not None and self.stripe.find(f"/v1/payment_methods/{ref}", account_id)
            target = f"saved card {method.id}"
            if live:
                self.steps.append(Step("keep", target, f"{ref} is on {account_id}"))
                continue
            client = await self.db.get(Client, method.client_id)
            if client is None:
                continue
            customer = await self._customer(client, account_id)
            card = card_token_for(method.brand)
            self.steps.append(
                Step("create", target, f"attach {card} to {customer}; {ref} is not on Stripe")
            )
            new: Json = {"id": "<new pm_>", "card": {}}
            if self.apply:
                new = self.stripe.call(
                    "post",
                    f"/v1/payment_methods/{card}/attach",
                    [f"customer={customer}"],
                    account=account_id,
                )
            details = _map(new.get("card"))
            values: dict[str, tuple[object, object]] = {
                "provider_ref": (ref, new["id"]),
                "brand": (method.brand, details.get("brand", method.brand)),
                "last4": (method.last4, details.get("last4", method.last4)),
                "exp_month": (method.exp_month, details.get("exp_month", method.exp_month)),
                "exp_year": (method.exp_year, details.get("exp_year", method.exp_year)),
            }
            self.changes += column_changes("payment_methods", method.id, values)
            if self.apply:
                method.provider_ref = str(new["id"])
                method.brand = str(details.get("brand") or method.brand)
                method.last4 = str(details.get("last4") or method.last4)
                month, year = details.get("exp_month"), details.get("exp_year")
                method.exp_month = month if isinstance(month, int) else method.exp_month
                method.exp_year = year if isinstance(year, int) else method.exp_year

    async def _customer(self, client: Client, account_id: str) -> str:
        current = client.stripe_customer_id
        if current is not None and self.stripe.find(f"/v1/customers/{current}", account_id):
            return current
        tagged = [
            c
            for c in self.stripe.list_all("/v1/customers", account=account_id)
            if _map(c.get("metadata")).get(CLIENT_TAG) == client.id
        ]
        customer = str(tagged[0]["id"]) if tagged else "<new cus_>"
        if not tagged:
            self.steps.append(Step("create", f"customer for {client.id}", f"on {account_id}"))
            if self.apply:
                params = {"name": client.name, "metadata": {CLIENT_TAG: client.id}}
                if client.email:
                    params["email"] = client.email
                customer = str(
                    self.stripe.call(
                        "post",
                        "/v1/customers",
                        form(params),
                        account=account_id,
                        idempotency=f"clientbridge-demo-customer-{account_id}-{client.id}",
                    )["id"]
                )
        self.changes += column_changes(
            "clients", client.id, {"stripe_customer_id": (current, customer)}
        )
        if self.apply:
            client.stripe_customer_id = customer
        return customer


async def link_database(stripe: Stripe, accounts: Mapping[str, Json | None], *, apply: bool) -> int:
    async with SessionLocal() as db:
        linker = Linker(stripe, db, apply=apply)
        for biz in DEMO_BUSINESSES:
            await linker.business(biz, accounts.get(biz.id))
        for step in linker.steps:
            show(step)
        print("database rows:" if apply else "database rows that --apply would change:")
        for change in linker.changes:
            print(f"  {change.table}.{change.column} [{change.row}]: {change.old} -> {change.new}")
        if not linker.changes:
            print("  none")
        if apply:
            await db.commit()
        else:
            await db.rollback()
    await engine.dispose()
    return 1 if any(step.action == "blocked" for step in linker.steps) else 0


def link_problems(env: str, api_key: str) -> list[str]:
    problems: list[str] = []
    if env not in ("dev", "staging"):
        problems.append(f"ENV is {env!r}; linking runs only with ENV=dev or ENV=staging")
    if not api_key.startswith(("sk_test_", "rk_test_")):
        problems.append("STRIPE_SECRET_KEY is not a test-mode key")
    return problems


def link_only(env: str, api_key: str, *, apply: bool) -> int:
    """Points the demo rows at the sandbox's demo accounts through the API, as a deploy job does."""
    problems = link_problems(env, api_key)
    stripe = ApiStripe(api_key)
    if not problems and stripe.call("get", "/v1/balance").get("livemode") is not False:
        problems.append("Stripe did not answer in test mode")
    if problems:
        print("refusing to run:")
        for problem in problems:
            print(f"  - {problem}")
        return 2
    accounts = stripe.list_v2("/v2/core/accounts")
    resolved: dict[str, Json | None] = {}
    for biz in DEMO_BUSINESSES:
        found = [stripe.account(str(a["id"])) for a in find_account(accounts, biz)]
        resolved[biz.id] = found[0] if len(found) == 1 else None
    return asyncio.run(link_database(stripe, resolved, apply=apply))


def main(argv: Sequence[str] | None = None, runner: Runner = cli_runner) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="perform the plan (default: dry run)")
    parser.add_argument("--project-name", help="Stripe CLI project (profile) to use")
    parser.add_argument("--account", help="the platform account id this run must target")
    parser.add_argument("--webhook-url", help="public https URL ending in /webhooks/stripe")
    parser.add_argument(
        "--write-db",
        action="store_true",
        help="point the local demo rows at the sandbox objects (writes only with --apply)",
    )
    parser.add_argument(
        "--payment-domains",
        metavar="BASE_DOMAIN",
        help="register app., book., pay. and shop. of this domain on each demo account",
    )
    parser.add_argument("--listen", action="store_true", help="run `stripe listen` for our events")
    parser.add_argument("--show-secrets", action="store_true", help="print secrets unredacted")
    parser.add_argument(
        "--link-only",
        action="store_true",
        help="only point the demo rows at their sandbox accounts, through the API with "
        "STRIPE_SECRET_KEY instead of the CLI (ENV=dev or staging)",
    )
    args = parser.parse_args(argv)
    settings = get_settings()
    if args.link_only:
        return link_only(settings.env, settings.stripe_secret_key, apply=args.apply)
    stripe = Stripe(runner, args.project_name)
    config = parse_config(stripe.text("config", "--list"))
    platform = stripe.call("get", "/v1/account")
    balance = stripe.call("get", "/v1/balance")
    problems = safety_problems(
        config,
        platform,
        balance,
        env=settings.env,
        expected_account=args.account,
        env_api_key=os.environ.get("STRIPE_API_KEY", ""),
    )
    if problems:
        print("refusing to run:")
        for problem in problems:
            print(f"  - {problem}")
        return 2
    listen = listen_args(settings.api_base_url)
    if args.project_name:
        listen = [[*command, "--project-name", args.project_name] for command in listen]
    if args.listen:
        return run_listeners(listen)
    mode = "apply" if args.apply else "dry run"
    print(f"{mode} against {config.get('display_name')} ({platform.get('id')}), test mode")
    for warning in platform_warnings(platform, settings.stripe_connect_country):
        print(f"  warning: {warning}")

    endpoints = stripe.list_all("/v1/webhook_endpoints")
    destinations = stripe.list_v2("/v2/core/event_destinations")
    accounts = stripe.list_v2("/v2/core/accounts")
    portals = stripe.list_all("/v1/billing_portal/configurations")
    steps = [
        plan_webhook(endpoints, args.webhook_url),
        plan_platform_webhook(endpoints, args.webhook_url),
        plan_destination(destinations, args.webhook_url),
        *plan_billing(stripe, portals, f"{settings.web_base_url}/setup/plan"),
    ]
    matched = {
        biz.id: [stripe.account(str(a["id"])) for a in find_account(accounts, biz)]
        for biz in DEMO_BUSINESSES
    }
    closed = stripe.list_v2("/v2/core/accounts", closed=True)
    steps += [plan_account(biz, matched[biz.id], closed) for biz in DEMO_BUSINESSES]
    if args.payment_domains is not None:
        if not DOMAIN.fullmatch(args.payment_domains):
            detail = "--payment-domains takes a bare domain such as staging.clientbridge.ca"
            steps.append(Step("blocked", "payment method domains", detail))
        else:
            domains = payment_domains(args.payment_domains)
            for biz in DEMO_BUSINESSES:
                found = matched[biz.id]
                account_id = str(found[0]["id"]) if len(found) == 1 else None
                existing = (
                    stripe.list_all("/v1/payment_method_domains", account=account_id)
                    if account_id is not None
                    else []
                )
                steps += plan_payment_domains(biz.id, account_id, existing, domains)
    print("plan:")
    for step in steps:
        show(step)

    endpoint_secret: str | None = None
    platform_secret: str | None = None
    existing_portals = ours_portal(portals)
    portal_id = str(existing_portals[0]["id"]) if len(existing_portals) == 1 else None
    destination_secret: str | None = None
    resolved: dict[str, Json | None] = {
        biz.id: matched[biz.id][0] if len(matched[biz.id]) == 1 else None for biz in DEMO_BUSINESSES
    }
    if args.apply:
        for step in steps:
            if step.action not in ("create", "update"):
                continue
            result = stripe.run(step)
            print(f"  done: {step.action} {step.target} -> {result.get('id')}")
            if step.path == "/v1/webhook_endpoints":
                secret_value = str(result.get("secret") or "") or None
                if step.target == "connect webhook endpoint":
                    endpoint_secret = secret_value
                else:
                    platform_secret = secret_value
            if step.path.startswith("/v1/billing_portal/configurations"):
                portal_id = str(result.get("id"))
            if step.path == "/v2/core/event_destinations":
                webhook = _map(result.get("webhook_endpoint"))
                destination_secret = str(webhook.get("signing_secret") or "") or None
            if step.path.startswith("/v2/core/accounts"):
                resolved[str(_map(result.get("metadata")).get(DEMO_TAG))] = result

    blocked = any(step.action == "blocked" for step in steps)
    if args.write_db:
        print("\nlocal database:")
        blocked = bool(asyncio.run(link_database(stripe, resolved, apply=args.apply))) or blocked

    def secret(value: str) -> str:
        return value if args.show_secrets else redact(value)

    print("\nenv (backend/.env unless noted):")
    print(f"  STRIPE_CONNECT_COUNTRY={settings.stripe_connect_country}")
    api_key = config.get("test_mode_api_key", "")
    key_note = (
        "the CLI's restricted key, which expires; use a secret key for anything lasting"
        if api_key.startswith("rk_")
        else "the CLI's key"
    )
    print(f"  STRIPE_SECRET_KEY={secret(api_key)}  ({key_note})")
    # a deployed endpoint has its own secret, which Stripe shows only when it is created
    listen_secret = stripe.listen_secret() if args.webhook_url is None else None

    def signing(created: str | None) -> str:
        if created is not None:
            return secret(created)
        if listen_secret is not None:
            return secret(listen_secret)
        return "<shown only when the endpoint is created; reveal it in the Dashboard>"

    print(f"  STRIPE_WEBHOOK_SECRET={signing(endpoint_secret)}")
    print(f"  STRIPE_THIN_WEBHOOK_SECRET={signing(destination_secret)}")
    print(f"  STRIPE_PLATFORM_WEBHOOK_SECRET={signing(platform_secret)}")
    print(f"  STRIPE_PORTAL_CONFIGURATION={portal_id or '<created by --apply>'}")
    default_version = stripe.default_api_version()
    if default_version is not None and default_version != STRIPE_API_VERSION:
        print(
            f"  note: the sandbox renders snapshot events at {default_version}, which the webhook "
            f"rejects under `stripe listen`; the handlers parse only {STRIPE_API_VERSION}"
        )
    publishable = config.get("test_mode_pub_key", "<pk_test_...>")
    print(f"  VITE_STRIPE_PUBLISHABLE_KEY={publishable}  (frontend/apps/web and apps/connect)")
    print(f"  STRIPE_PUBLISHABLE_KEY={publishable}  (frontend/apps/mobile)")
    birchbark = resolved.get("bz_birchbark")
    if birchbark is not None:
        print(f"  STRIPE_TEST_CONNECTED_ACCOUNT={birchbark['id']}  (make test-e2e)")
    print("\ndemo businesses:")
    for biz in DEMO_BUSINESSES:
        account = resolved.get(biz.id)
        if account is None:
            print(f"  {biz.id}: <created by --apply>")
            continue
        print(f"  {biz.id}: {account['id']} {account_summary(account)}")
    print("\nonboarding:")
    for item in ONBOARDING_STEPS:
        print(f"  - {item}")
    print("\nlocal webhooks (make stripe-listen runs both):")
    for command in listen:
        print(f"  stripe {' '.join(command)}")
    print("\nDashboard-only steps:")
    for item in DASHBOARD_STEPS:
        print(f"  - {item}")
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
