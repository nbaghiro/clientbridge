"""Plan, and with --apply create, the Stripe sandbox objects the demo needs, via the Stripe CLI."""

import argparse
import asyncio
import json
import os
import subprocess
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.errors import Unprocessable
from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import (
    STRIPE_API_VERSION,
    PostalAddress,
    account_status_from,
    payment_descriptor,
)
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod
from clientbridge.services.business import apply_account_status, postal_address

TAG = "clientbridge"
WEBHOOK_KEY = "connect_webhook"
# shared with scripts/stripe_demo_account.py so both find the same connected account
DEMO_TAG = "clientbridge_demo"
WEBHOOK_EVENTS = (
    "account.updated",
    "capability.updated",
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
CAPABILITIES = ("card_payments", "transfers", "acss_debit_payments")
# Stripe's documented test values: 1901-01-01 verifies, address_full_match passes address checks
TEST_INDIVIDUAL: dict[str, object] = {
    "dob": {"day": 1, "month": 1, "year": 1901},
    "id_number": "000000000",
}
TEST_BANK: dict[str, object] = {
    "object": "bank_account",
    "country": "CA",
    "currency": "cad",
    "routing_number": "11000-000",
    "account_number": "000123456789",
}
TEST_DOCUMENT = "file_identity_document_success"
TEST_CARDS = {"visa": "pm_card_visa", "mastercard": "pm_card_mastercard", "amex": "pm_card_amex"}
CLIENT_TAG = "clientbridge_demo_client"

DASHBOARD_STEPS = (
    "Connect platform profile and the Connect onboarding questionnaire (Settings > Connect)",
    "platform business details, public name, support email and statement descriptor "
    "(the API cannot update the platform's own account)",
    "Connect branding for connected accounts: icon, logo, colours (Settings > Connect > Branding)",
    "payment methods for connected accounts: cards, Link, Apple Pay, Google Pay and "
    "Canadian pre-authorized debit (Settings > Connect > Payment methods)",
    "Apple Pay domain registration for the Connect and web hosts once they are public",
    "Terminal and Tap to Pay: enable Terminal for the platform and Tap to Pay on iPhone/Android "
    "for Canada; real-device testing needs the Apple entitlement",
    "the sandbox default API version, which `stripe listen` uses for payloads unless --latest; "
    f"handlers parse {STRIPE_API_VERSION}",
    "Connect email settings: which payment and payout emails Stripe sends to connected accounts",
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


def dotted(params: Mapping[str, object], prefix: str = "") -> dict[str, object]:
    flat: dict[str, object] = {}
    for key, value in params.items():
        name = f"{prefix}.{key}" if prefix else key
        if isinstance(value, Mapping):
            flat.update(dotted(cast(Mapping[str, object], value), name))
        else:
            flat[name] = value
    return flat


def nested(flat: Mapping[str, object]) -> dict[str, object]:
    tree: dict[str, object] = {}
    for name, value in flat.items():
        node = tree
        *parents, leaf = name.split(".")
        for part in parents:
            node = cast(dict[str, object], node.setdefault(part, {}))
        node[leaf] = value
    return tree


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


def plan_webhook(endpoints: Sequence[Mapping[str, object]], url: str | None) -> Step:
    target = "connect webhook endpoint"
    ours = [e for e in endpoints if _map(e.get("metadata")).get(TAG) == WEBHOOK_KEY]
    if url is None:
        detail = "no --webhook-url; forward locally with `stripe listen` (printed below)"
        return Step("keep", target, f"{len(ours)} registered; {detail}")
    problem = webhook_url_problem(url)
    if problem is not None:
        return Step("blocked", target, problem)
    found = ours or [e for e in endpoints if e.get("url") == url and e.get("connect") is True]
    if len(found) > 1:
        ids = ", ".join(str(e.get("id")) for e in found)
        return Step("blocked", target, f"several endpoints match ({ids}); delete the extras")
    params = {
        "url": url,
        "enabled_events": list(WEBHOOK_EVENTS),
        "description": "Clientbridge Connect events",
        "metadata": {TAG: WEBHOOK_KEY},
    }
    if not found:
        return Step(
            "create",
            target,
            f"{url} for {len(WEBHOOK_EVENTS)} Connect events at {STRIPE_API_VERSION}",
            "post",
            "/v1/webhook_endpoints",
            tuple(form({**params, "connect": True, "api_version": STRIPE_API_VERSION})),
        )
    endpoint = found[0]
    endpoint_id = str(endpoint.get("id"))
    if endpoint.get("connect") is not True or endpoint.get("api_version") != STRIPE_API_VERSION:
        return Step(
            "blocked",
            target,
            f"{endpoint_id} is connect={endpoint.get('connect')} at "
            f"{endpoint.get('api_version')}; both are fixed at creation, so delete it in the "
            f"Dashboard and rerun to create one at {STRIPE_API_VERSION}",
        )
    changes: list[str] = []
    if endpoint.get("url") != url:
        changes.append("url")
    if set(_strings(endpoint.get("enabled_events"))) != set(WEBHOOK_EVENTS):
        changes.append("events")
    if endpoint.get("status") != "enabled":
        changes.append("enable")
    if _map(endpoint.get("metadata")).get(TAG) != WEBHOOK_KEY:
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


def account_params(biz: DemoBusiness, now: int) -> dict[str, object]:
    descriptor = payment_descriptor(biz.name) or ""
    profile: dict[str, object] = {
        "name": biz.name,
        "mcc": "7299",
        "support_email": biz.email,
        "product_description": biz.product_description,
    }
    if biz.url is not None:
        profile["url"] = biz.url
    return {
        "type": "custom",
        "country": "CA",
        "email": biz.email,
        "business_type": "individual",
        "metadata": {DEMO_TAG: biz.id},
        "capabilities": {name: {"requested": True} for name in CAPABILITIES},
        "business_profile": profile,
        "settings": {
            "payments": {"statement_descriptor": descriptor},
            "card_payments": {"statement_descriptor_prefix": descriptor[:10].rstrip()},
            "branding": {"primary_color": biz.primary_color},
        },
        "individual": {
            **TEST_INDIVIDUAL,
            "first_name": biz.first_name,
            "last_name": biz.last_name,
            "email": biz.email,
            "phone": biz.phone,
            "address": {
                "line1": "address_full_match",
                "city": biz.city,
                "state": biz.province,
                "postal_code": biz.postal_code,
                "country": "CA",
            },
        },
        "external_account": TEST_BANK,
        "tos_acceptance": {"date": now, "ip": "127.0.0.1"},
    }


def requirement_fill(
    biz: DemoBusiness, due: Sequence[str], now: int
) -> tuple[dict[str, object], list[str]]:
    available = dotted(account_params(biz, now))
    available["individual.verification.document.front"] = TEST_DOCUMENT
    available["individual.verification.additional_document.front"] = TEST_DOCUMENT
    fill: dict[str, object] = {}
    unknown: list[str] = []
    for requirement in due:
        if requirement == "external_account":
            fill["external_account"] = TEST_BANK
            continue
        matches = {
            k: v
            for k, v in available.items()
            if k == requirement or k.startswith(f"{requirement}.")
        }
        if not matches or requirement.startswith(("type", "country", "metadata")):
            unknown.append(requirement)
        flat = {k: v for k, v in matches.items() if not k.startswith("external_account.")}
        fill.update(nested(flat))
    return fill, unknown


def find_account(accounts: Sequence[Mapping[str, object]], biz: DemoBusiness) -> list[Json]:
    return [dict(a) for a in accounts if _map(a.get("metadata")).get(DEMO_TAG) == biz.id]


def plan_account(biz: DemoBusiness, matches: Sequence[Mapping[str, object]], now: int) -> Step:
    target = f"connected account for {biz.id}"
    if len(matches) > 1:
        ids = ", ".join(str(a.get("id")) for a in matches)
        return Step("blocked", target, f"several accounts carry {DEMO_TAG}={biz.id}: {ids}")
    if not matches:
        params = account_params(biz, now)
        return Step(
            "create",
            target,
            f"Custom CA account '{biz.name}' with {', '.join(CAPABILITIES)} and test KYC data",
            "post",
            "/v1/accounts",
            tuple(form(params)),
            idempotency=f"clientbridge-demo-account-{biz.id}",
        )
    account = matches[0]
    account_id = str(account.get("id"))
    if account.get("type") != "custom" or account.get("country") != "CA":
        return Step(
            "blocked",
            target,
            f"{account_id} is {account.get('type')}/{account.get('country')}; "
            "the code expects a Custom CA account",
        )
    changes: dict[str, object] = {}
    capabilities = _map(account.get("capabilities"))
    missing = [name for name in CAPABILITIES if name not in capabilities]
    if missing:
        changes["capabilities"] = {name: {"requested": True} for name in missing}
    branding = _map(_map(account.get("settings")).get("branding"))
    if not branding.get("primary_color"):
        changes["settings"] = {"branding": {"primary_color": biz.primary_color}}
    requirements = _map(account.get("requirements"))
    due = sorted(
        {*_strings(requirements.get("currently_due")), *_strings(requirements.get("past_due"))}
    )
    fill, unknown = requirement_fill(biz, due, now)
    changes.update(fill)
    status = (
        f"charges={account.get('charges_enabled')} payouts={account.get('payouts_enabled')} "
        f"capabilities={dict(capabilities)}"
    )
    if unknown:
        status += f"; needs onboarding for {', '.join(unknown)}"
    if not changes:
        return Step("keep", target, f"{account_id}: {status}")
    return Step(
        "update",
        target,
        f"{account_id}: set {', '.join(sorted(changes))}; {status}",
        "post",
        f"/v1/accounts/{account_id}",
        tuple(form(changes)),
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

    def listen_secret(self) -> str:
        return self.text("listen", "--print-secret").strip()

    def default_api_version(self) -> str | None:
        events = self.call("get", "/v1/events", ["limit=1"]).get("data")
        first = events[0] if isinstance(events, list) and events else None
        version = first.get("api_version") if isinstance(first, dict) else None
        return version if isinstance(version, str) else None

    def settled_account(self, account_id: str, *, wait: float) -> Json:
        deadline = time.monotonic() + wait
        while True:
            account = self.call("get", f"/v1/accounts/{account_id}")
            ready = account.get("charges_enabled") and account.get("payouts_enabled")
            if ready or time.monotonic() >= deadline:
                return account
            time.sleep(3)

    def list_all(self, path: str, *, account: str | None = None) -> list[Json]:
        rows: list[Json] = []
        after: str | None = None
        while True:
            params = ["limit=100", *([f"starting_after={after}"] if after else [])]
            page = self.call("get", path, params, account=account)
            data = [cast(Json, r) for r in cast(list[object], page.get("data") or [])]
            rows += [r for r in data if isinstance(r, dict)]
            if not page.get("has_more") or not rows:
                return rows
            after = str(rows[-1].get("id"))

    def run(self, step: Step) -> Json:
        return self.call(
            step.method,
            step.path,
            step.params,
            account=step.account,
            idempotency=step.idempotency,
        )


def cli_runner(args: Sequence[str]) -> str:
    result = subprocess.run(["stripe", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise SystemExit(f"stripe {args[0]} failed: {result.stderr.strip()[:300]}")
    return result.stdout


def listen_args(api_base: str) -> list[str]:
    host = urlparse(api_base).netloc or "127.0.0.1:8701"
    target = f"{host}/webhooks/stripe"
    return [
        "listen",
        "--forward-to",
        target,
        "--forward-connect-to",
        target,
        "--events",
        ",".join(WEBHOOK_EVENTS),
    ]


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
    """Points the local demo rows at the sandbox objects; writes only with apply."""

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
                "stripe_details_submitted": (
                    business.stripe_details_submitted,
                    status.details_submitted,
                ),
            },
        )
        if self.apply:
            business.stripe_account_id = account_id
            business.stripe_terminal_location_id = location
            apply_account_status(business, status)
        await self._cards(business, account_id)

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
                    scoped(PaymentMethod, business.id).where(
                        PaymentMethod.provider == "stripe",
                        PaymentMethod.method == "card",
                        PaymentMethod.status == "active",
                    )
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
    parser.add_argument("--listen", action="store_true", help="run `stripe listen` for our events")
    parser.add_argument("--show-secrets", action="store_true", help="print secrets unredacted")
    parser.add_argument("--wait", type=float, default=90, help="seconds to wait for verification")
    args = parser.parse_args(argv)
    settings = get_settings()
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
        listen += ["--project-name", args.project_name]
    if args.listen:
        os.execvp("stripe", ["stripe", *listen])
    mode = "apply" if args.apply else "dry run"
    print(f"{mode} against {config.get('display_name')} ({platform.get('id')}), test mode")
    for warning in platform_warnings(platform, settings.stripe_connect_country):
        print(f"  warning: {warning}")

    now = int(time.time())
    endpoints = stripe.list_all("/v1/webhook_endpoints")
    accounts = stripe.list_all("/v1/accounts")
    steps = [plan_webhook(endpoints, args.webhook_url)]
    matched = {biz.id: find_account(accounts, biz) for biz in DEMO_BUSINESSES}
    steps += [plan_account(biz, matched[biz.id], now) for biz in DEMO_BUSINESSES]
    print("plan:")
    for step in steps:
        show(step)
    print(
        "  [keep   ] platform products and prices: none needed; each subscription item gets its "
        "Price on the connected account at first use"
    )

    endpoint_secret: str | None = None
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
                endpoint_secret = str(result.get("secret") or "") or None
            if step.path.startswith("/v1/accounts"):
                resolved[str(_map(result.get("metadata")).get(DEMO_TAG))] = result
        for biz_id, account in resolved.items():
            if account is not None:
                resolved[biz_id] = stripe.settled_account(str(account["id"]), wait=args.wait)

    blocked = any(step.action == "blocked" for step in steps)
    if args.write_db:
        print("\nlocal database:")
        blocked = bool(asyncio.run(link_database(stripe, resolved, apply=args.apply))) or blocked

    def secret(value: str) -> str:
        return value if args.show_secrets else redact(value)

    print("\nenv (backend/.env unless noted):")
    print(f"  STRIPE_CONNECT_COUNTRY={settings.stripe_connect_country}")
    print(f"  STRIPE_SECRET_KEY={secret(config.get('test_mode_api_key', ''))}  (the CLI's key)")
    listen_secret = endpoint_secret or stripe.listen_secret()
    print(f"  STRIPE_WEBHOOK_SECRET={secret(listen_secret)}")
    default_version = stripe.default_api_version()
    if default_version is not None and default_version != STRIPE_API_VERSION:
        print(f'  STRIPE_WEBHOOK_API_VERSIONS=["{default_version}"]')
        print(
            f"    the sandbox renders events at {default_version} and `stripe listen` cannot pin "
            f"{STRIPE_API_VERSION}; accept it only after checking its changes against the handlers"
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
        status = account_status_from(str(account["id"]), account)
        capabilities = dict(_map(account.get("capabilities")))
        print(
            f"  {biz.id}: {account['id']} charges={status.charges_enabled} "
            f"payouts={status.payouts_enabled} capabilities={capabilities}"
        )
    print(f"\nlocal webhooks (make stripe-listen): stripe {' '.join(listen)}")
    print("\nDashboard-only steps:")
    for item in DASHBOARD_STEPS:
        print(f"  - {item}")
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
