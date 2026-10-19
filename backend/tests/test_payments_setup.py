import ast
import json
import pathlib
from collections.abc import Sequence
from typing import cast

import pytest
from scripts.stripe_setup import (
    DEMO_BUSINESSES,
    DEMO_TAG,
    WEBHOOK_EVENTS,
    Linker,
    Stripe,
    api_request,
    card_token_for,
    link_problems,
    listen_args,
    main,
    plan_account,
    plan_destination,
    plan_location,
    plan_payment_domains,
    plan_platform_webhook,
    plan_portal,
    plan_price,
    plan_product,
    plan_webhook,
    safety_problems,
)
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import (
    ACCOUNT_EVENTS,
    PLAN_EVENTS,
    STRIPE_API_VERSION,
    PostalAddress,
)
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod
from clientbridge.services.plans import PLAN_PRICES, PlanPrice

URL = "https://api.example.com/webhooks/stripe"
CONFIG = {"test_mode_api_key": "sk_test_x", "account_id": "acct_p", "display_name": "Clientbridge"}
PLATFORM = {"id": "acct_p", "country": "CA"}
BIRCHBARK = DEMO_BUSINESSES[0]


def _params(pairs: Sequence[str]) -> dict[str, str]:
    return dict(pair.split("=", 1) for pair in pairs)


def test_webhook_events_match_the_handlers() -> None:
    source = pathlib.Path(__file__).parents[1] / "src/clientbridge/services/payments.py"
    tree = ast.parse(source.read_text())
    dispatch = next(
        n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "_dispatch"
    )
    handled = {
        node.value
        for node in ast.walk(dispatch)
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and "." in node.value
    }
    assert handled == set(WEBHOOK_EVENTS)


def test_safety_accepts_a_named_test_sandbox() -> None:
    problems = safety_problems(
        CONFIG, PLATFORM, {"livemode": False}, env="dev", expected_account=None, env_api_key=""
    )
    assert problems == []


def test_safety_refuses_live_mode_other_envs_and_unnamed_accounts() -> None:
    problems = safety_problems(
        {**CONFIG, "display_name": "Other Co"},
        PLATFORM,
        {"livemode": True},
        env="production",
        expected_account=None,
        env_api_key="sk_live_x",
    )
    assert len(problems) == 4
    confirmed = safety_problems(
        {**CONFIG, "display_name": "Other Co"},
        PLATFORM,
        {"livemode": False},
        env="dev",
        expected_account="acct_other",
        env_api_key="",
    )
    assert confirmed == ["the CLI is authenticated to acct_p, not acct_other"]


def test_webhook_is_created_as_a_connect_endpoint_at_the_pinned_version() -> None:
    step = plan_webhook([], URL)
    params = _params(step.params)
    assert (step.action, step.path) == ("create", "/v1/webhook_endpoints")
    assert params["connect"] == "true"
    assert params["api_version"] == STRIPE_API_VERSION
    assert params["metadata[clientbridge]"] == "connect_webhook"
    assert [p for p in step.params if p.startswith("enabled_events")] == [
        f"enabled_events[]={event}" for event in WEBHOOK_EVENTS
    ]


def test_webhook_keeps_updates_or_blocks_an_existing_endpoint() -> None:
    current = {
        "id": "we_1",
        "url": URL,
        "application": "ca_platform",
        "api_version": STRIPE_API_VERSION,
        "status": "enabled",
        "enabled_events": list(WEBHOOK_EVENTS),
        "metadata": {"clientbridge": "connect_webhook"},
    }
    assert plan_webhook([current], URL).action == "keep"
    stale = plan_webhook([{**current, "enabled_events": ["payment_intent.succeeded"]}], URL)
    assert (stale.action, stale.path) == ("update", "/v1/webhook_endpoints/we_1")
    assert "api_version=" not in " ".join(stale.params)
    assert plan_webhook([{**current, "api_version": "2024-06-20"}], URL).action == "blocked"
    assert plan_webhook([current, {**current, "id": "we_2"}], URL).action == "blocked"


def test_webhook_needs_a_public_https_url() -> None:
    assert plan_webhook([], None).action == "keep"
    assert plan_webhook([], "http://127.0.0.1:8701/webhooks/stripe").action == "blocked"
    assert plan_webhook([], "https://localhost/webhooks/stripe").action == "blocked"
    assert plan_webhook([], "https://api.example.com/hooks").action == "blocked"


def _body(step_params: Sequence[str]) -> dict[str, object]:
    (body,) = step_params
    return cast(dict[str, object], json.loads(body))


def test_missing_account_is_created_as_a_v2_merchant_with_test_identity() -> None:
    step = plan_account(BIRCHBARK, [])
    body = _body(step.params)
    assert (step.action, step.path) == ("create", "/v2/core/accounts")
    assert step.idempotency == "clientbridge-demo-account-bz_birchbark"
    assert body["dashboard"] == "none"
    assert body["metadata"] == {DEMO_TAG: "bz_birchbark"}
    defaults = cast(dict[str, object], body["defaults"])
    assert defaults["responsibilities"] == {
        "fees_collector": "stripe",
        "losses_collector": "stripe",
    }
    assert defaults["currency"] == "cad"
    merchant = cast(
        dict[str, dict[str, object]], cast(dict[str, object], body["configuration"])["merchant"]
    )
    assert merchant["capabilities"] == {
        name: {"requested": True}
        for name in ("card_payments", "link_payments", "acss_debit_payments")
    }
    assert merchant["statement_descriptor"] == {
        "descriptor": "BIRCHBARK PET STUDIO",
        "prefix": "BIRCHBARK",
    }
    identity = cast(dict[str, dict[str, object]], body["identity"])
    assert identity["individual"]["date_of_birth"] == {"day": 1, "month": 1, "year": 1901}
    assert identity["individual"]["id_numbers"] == [{"type": "ca_sin", "value": "000000000"}]
    address = cast(dict[str, object], identity["individual"]["address"])
    assert (address["line1"], address["city"], address["postal_code"]) == (
        "address_full_match",
        "Victoria",
        "V8W 1Y9",
    )
    assert identity["individual"]["phone"] == "+12505550110"
    assert "attestations" not in identity  # Stripe collects the terms in onboarding


def _v2_account(**changes: object) -> dict[str, object]:
    active = {"status": "active", "status_details": []}
    account: dict[str, object] = {
        "id": "acct_b",
        "dashboard": "none",
        "metadata": {DEMO_TAG: "bz_birchbark"},
        "defaults": {
            "responsibilities": {"fees_collector": "stripe", "losses_collector": "stripe"}
        },
        "configuration": {
            "merchant": {
                "capabilities": {
                    "card_payments": active,
                    "link_payments": active,
                    "acss_debit_payments": active,
                    "stripe_balance": {"payouts": active},
                },
                "branding": {"primary_color": "#2E4A3F"},
            }
        },
        "requirements": {"entries": []},
    }
    return {**account, **changes}


def test_existing_account_requests_missing_capabilities_and_reports_onboarding() -> None:
    merchant = {"capabilities": {"card_payments": {"status": "restricted"}}}
    due = {
        "awaiting_action_from": "user",
        "description": "identity.attestations.terms_of_service.account",
        "minimum_deadline": {"status": "currently_due"},
    }
    account = _v2_account(configuration={"merchant": merchant}, requirements={"entries": [due]})
    step = plan_account(BIRCHBARK, [account])
    assert (step.action, step.path) == ("update", "/v2/core/accounts/acct_b")
    assert _body(step.params)["configuration"] == {
        "merchant": {
            "capabilities": {
                "link_payments": {"requested": True},
                "acss_debit_payments": {"requested": True},
            },
            "branding": {"primary_color": "#2E4A3F"},
        }
    }
    assert "onboarding still needs identity.attestations.terms_of_service.account" in step.detail


def test_complete_account_is_kept_and_fixed_settings_or_duplicates_block() -> None:
    account = _v2_account()
    kept = plan_account(BIRCHBARK, [account])
    assert kept.action == "keep" and "charges=True payouts=True" in kept.detail
    assert plan_account(BIRCHBARK, [account, account]).action == "blocked"
    assert plan_account(BIRCHBARK, [_v2_account(dashboard="express")]).action == "blocked"
    custom = {
        "responsibilities": {"fees_collector": "application", "losses_collector": "application"}
    }
    assert plan_account(BIRCHBARK, [_v2_account(defaults=custom)]).action == "blocked"


def test_destination_is_created_for_thin_account_events() -> None:
    assert plan_destination([], None).action == "keep"
    assert plan_destination([], "https://localhost/webhooks/stripe").action == "blocked"
    step = plan_destination([], URL)
    body = _body(step.params)
    assert (step.action, step.path) == ("create", "/v2/core/event_destinations")
    assert body["event_payload"] == "thin" and body["events_from"] == ["@self"]
    assert body["enabled_events"] == list(ACCOUNT_EVENTS)
    assert body["webhook_endpoint"] == {"url": URL}
    assert body["include"] == ["webhook_endpoint.signing_secret"]


def test_destination_keeps_updates_or_blocks_an_existing_one() -> None:
    current = {
        "id": "ed_1",
        "event_payload": "thin",
        "status": "enabled",
        "enabled_events": list(ACCOUNT_EVENTS),
        "webhook_endpoint": {"url": URL},
        "metadata": {"clientbridge": "account_events"},
    }
    assert plan_destination([current], URL).action == "keep"
    moved = plan_destination(
        [{**current, "enabled_events": []}], "https://new.example.com/webhooks/stripe"
    )
    assert (moved.action, moved.path) == ("update", "/v2/core/event_destinations/ed_1")
    assert set(_body(moved.params)) == {"enabled_events", "webhook_endpoint"}
    assert plan_destination([{**current, "status": "disabled"}], URL).action == "blocked"
    assert plan_destination([current, {**current, "id": "ed_2"}], URL).action == "blocked"


def test_v2_lists_follow_the_next_page() -> None:
    pages = iter(
        [
            {"data": [{"id": "acct_1"}], "next_page_url": "/v2/core/accounts?page=p2"},
            {"data": [{"id": "acct_2"}], "next_page_url": None},
        ]
    )
    calls: list[list[str]] = []

    def runner(args: Sequence[str]) -> str:
        calls.append(list(args))
        return json.dumps(next(pages))

    rows = Stripe(runner, None).list_v2("/v2/core/accounts")
    assert [r["id"] for r in rows] == ["acct_1", "acct_2"]
    assert json.loads(calls[1][calls[1].index("-d") + 1])["page"] == "p2"


def test_account_read_includes_the_fixed_settings_it_checks() -> None:
    calls: list[list[str]] = []

    def runner(args: Sequence[str]) -> str:
        calls.append(list(args))
        return json.dumps({"id": "acct_1"})

    Stripe(runner, None).account("acct_1")
    include = json.loads(calls[0][calls[0].index("-d") + 1])["include"]
    assert {"defaults", "configuration.merchant", "requirements"} <= set(include)


ADDRESS = PostalAddress("1207 Government Street", "Victoria", "BC", "V8W 1Y9")


def test_terminal_location_is_found_by_metadata() -> None:
    business = Business(id="bz_birchbark", name="Birchbark Pet Studio")
    tagged = {"id": "tml_1", "metadata": {DEMO_TAG: "bz_birchbark"}}
    assert plan_location(business, "acct_b", ADDRESS, [tagged]).detail == "tml_1"
    created = plan_location(business, "acct_b", ADDRESS, [])
    params = _params(created.params)
    assert (created.action, created.account) == ("create", "acct_b")
    assert params["address[line1]"] == "1207 Government Street"
    assert params["address[postal_code]"] == "V8W 1Y9"


class FakeCli:
    def __init__(self, display_name: str = "Clientbridge") -> None:
        self.calls: list[list[str]] = []
        self.display_name = display_name
        self.created = 0
        self.api_key = "sk_test_x"

    def __call__(self, args: Sequence[str]) -> str:
        self.calls.append(list(args))
        if args[0] == "config":
            lines = ("[p]", f"test_mode_api_key={self.api_key}", "account_id=acct_p")
            return "\n".join([*lines, f"display_name={self.display_name}"])
        if args[0] == "listen":
            return "whsec_test_secret\n"
        method, path = args[0], args[1]
        if path == "/v1/account":
            return json.dumps(PLATFORM)
        if path == "/v1/balance":
            return json.dumps({"livemode": False})
        if path == "/v1/events":
            return json.dumps({"data": [{"api_version": STRIPE_API_VERSION}]})
        if method == "post":
            self.created += 1
            card = {"brand": "visa", "last4": "4242", "exp_month": 12, "exp_year": 2034}
            made: dict[str, object] = {"id": f"obj_{self.created}", "card": card}
            if path == "/v1/webhook_endpoints":
                made["secret"] = f"whsec_endpoint_{self.created}"
            if path == "/v2/core/event_destinations":
                made["webhook_endpoint"] = {"signing_secret": "whsec_destination"}
            return json.dumps(made)
        if path.startswith(("/v1/payment_methods/", "/v1/customers/")):
            return json.dumps({"error": {"message": "No such object"}})
        return json.dumps({"data": [], "has_more": False})


def test_dry_run_reads_only(capsys: pytest.CaptureFixture[str]) -> None:
    cli = FakeCli()
    assert main(["--webhook-url", URL], runner=cli) == 0
    assert {call[0] for call in cli.calls} == {"config", "get"}
    out = capsys.readouterr().out
    assert "[create ] connect webhook endpoint" in out
    assert "[create ] account event destination" in out
    assert "[create ] connected account for bz_birchbark" in out
    assert "whsec_" not in out
    assert "--forward-connect-to 127.0.0.1:8701/webhooks/stripe" in out
    assert "v2.core.account[requirements].updated" in out
    assert "[create ] platform webhook endpoint" in out
    assert "[create ] price premium_year: 49990 cad per year" in out
    assert "[create ] billing portal configuration" in out
    assert "STRIPE_PORTAL_CONFIGURATION=<created by --apply>" in out
    assert "none needed" not in out


def test_unnamed_sandbox_is_refused_without_account(capsys: pytest.CaptureFixture[str]) -> None:
    cli = FakeCli("Other Co")
    assert main([], runner=cli) == 2
    assert "refusing to run" in capsys.readouterr().out
    assert main(["--account", "acct_p"], runner=cli) == 0


ACCOUNT = _v2_account()


async def _cards(db: AsyncSession) -> list[PaymentMethod]:
    query = scoped(PaymentMethod, "bz_birchbark").where(PaymentMethod.method == "card")
    return list((await db.execute(query)).scalars().all())


async def test_linking_plans_without_writing(db: AsyncSession) -> None:
    before = {m.id: m.provider_ref for m in await _cards(db)}
    cli = FakeCli()
    linker = Linker(Stripe(cli, None), db, apply=False)
    await linker.business(BIRCHBARK, ACCOUNT)
    assert not [c for c in cli.calls if c[0] == "post"]
    assert {m.id: m.provider_ref for m in await _cards(db)} == before
    business = await db.get(Business, "bz_birchbark")
    assert business is not None and business.stripe_account_id != "acct_b"
    columns = {(c.table, c.column) for c in linker.changes}
    assert ("businesses", "stripe_account_id") in columns
    assert ("payment_methods", "provider_ref") in columns


async def test_linking_replaces_fixture_cards_with_sandbox_cards(db: AsyncSession) -> None:
    linker = Linker(Stripe(FakeCli(), None), db, apply=True)
    await linker.business(BIRCHBARK, ACCOUNT)
    business = await db.get(Business, "bz_birchbark")
    assert business is not None
    assert business.stripe_account_id == "acct_b"
    assert business.stripe_charges_enabled is True
    assert business.stripe_terminal_location_id is not None
    cards = await _cards(db)
    assert cards and all((m.provider_ref or "").startswith("obj_") for m in cards)
    assert all(m.last4 == "4242" and m.exp_year == 2034 for m in cards)
    for card in cards:
        client = await db.get(Client, card.client_id)
        assert client is not None and (client.stripe_customer_id or "").startswith("obj_")


def test_card_tokens_follow_the_saved_brand() -> None:
    assert card_token_for("Mastercard") == "pm_card_mastercard"
    assert card_token_for("Amex") == "pm_card_amex"
    assert card_token_for(None) == "pm_card_visa"


async def test_linking_a_restricted_account_waits_to_attach_cards(db: AsyncSession) -> None:
    restricted = {"status": "restricted", "status_details": []}
    account = _v2_account(
        configuration={
            "merchant": {
                "capabilities": {
                    "card_payments": restricted,
                    "stripe_balance": {"payouts": restricted},
                }
            }
        }
    )
    before = {m.id: m.provider_ref for m in await _cards(db)}
    cli = FakeCli()
    linker = Linker(Stripe(cli, None), db, apply=True)
    await linker.business(BIRCHBARK, account)
    business = await db.get(Business, "bz_birchbark")
    assert business is not None and business.stripe_account_id == "acct_b"
    assert not [
        c for c in cli.calls if c[:2] == ["post", "/v1/payment_methods/pm_card_visa/attach"]
    ]
    assert {m.id: m.provider_ref for m in await _cards(db)} == before
    assert any(s.target == "saved cards for bz_birchbark" for s in linker.steps)


def test_snapshot_and_thin_events_listen_separately_to_one_route() -> None:
    snapshot, thin = listen_args("http://127.0.0.1:8701")
    route = "127.0.0.1:8701/webhooks/stripe"
    assert snapshot[snapshot.index("--forward-connect-to") + 1] == route
    assert thin[thin.index("--forward-to") + 1] == route
    assert "--forward-connect-to" not in thin
    snapshot_events = set(snapshot[snapshot.index("--events") + 1].split(","))
    assert snapshot_events == set(WEBHOOK_EVENTS) | set(PLAN_EVENTS)
    assert snapshot[snapshot.index("--forward-to") + 1] == route
    assert set(thin[thin.index("--events") + 1].split(",")) == set(ACCOUNT_EVENTS)


def test_platform_endpoint_is_a_separate_non_connect_endpoint_for_plan_events() -> None:
    connect = {
        "id": "we_connect",
        "url": URL,
        "application": "ca_platform",
        "api_version": STRIPE_API_VERSION,
        "status": "enabled",
        "enabled_events": list(WEBHOOK_EVENTS),
        "metadata": {"clientbridge": "connect_webhook"},
    }
    step = plan_platform_webhook([connect], URL)
    params = _params(step.params)
    assert (step.action, step.path) == ("create", "/v1/webhook_endpoints")
    assert params["connect"] == "false" and params["api_version"] == STRIPE_API_VERSION
    assert params["metadata[clientbridge]"] == "platform_webhook"
    assert [p for p in step.params if p.startswith("enabled_events")] == [
        f"enabled_events[]={event}" for event in PLAN_EVENTS
    ]
    platform = {
        **connect,
        "id": "we_platform",
        "application": None,
        "enabled_events": list(PLAN_EVENTS),
        "metadata": {"clientbridge": "platform_webhook"},
    }
    assert plan_platform_webhook([connect, platform], URL).action == "keep"
    assert plan_webhook([connect, platform], URL).action == "keep"
    wrong_scope = {**platform, "application": "ca_platform"}
    assert plan_platform_webhook([wrong_scope], URL).action == "blocked"
    assert plan_platform_webhook([], None).action == "keep"


def test_plan_prices_give_two_months_free_on_a_year() -> None:
    assert {key: (p.amount_cents, p.interval) for key, p in PLAN_PRICES.items()} == {
        "premium_month": (4999, "month"),
        "premium_year": (49990, "year"),
        "team_month": (9999, "month"),
        "team_year": (99990, "year"),
        "seat_month": (1000, "month"),
    }


def test_products_have_fixed_ids_and_the_saas_tax_code() -> None:
    created = plan_product("clientbridge_team", "Clientbridge Team", None)
    params = _params(created.params)
    assert (created.action, created.path) == ("create", "/v1/products")
    assert params["id"] == "clientbridge_team" and params["tax_code"] == "txcd_10103001"
    current = {"id": "clientbridge_team", "name": "Clientbridge Team", "active": True}
    kept = plan_product(
        "clientbridge_team", "Clientbridge Team", {**current, "tax_code": {"id": "txcd_10103001"}}
    )
    assert kept.action == "keep"
    renamed = plan_product(
        "clientbridge_team",
        "Clientbridge Team",
        {**current, "name": "Old", "tax_code": "txcd_10103001"},
    )
    assert (renamed.action, renamed.path) == ("update", "/v1/products/clientbridge_team")
    assert renamed.detail == "set name"


PREMIUM_YEAR = PlanPrice("clientbridge_premium", 49990, "year")


def _price(**changes: object) -> dict[str, object]:
    price: dict[str, object] = {
        "id": "price_1",
        "lookup_key": "premium_year",
        "active": True,
        "product": "clientbridge_premium",
        "unit_amount": 49990,
        "currency": "cad",
        "recurring": {"interval": "year"},
        "tax_behavior": "exclusive",
    }
    return {**price, **changes}


def test_prices_are_found_by_lookup_key_and_replaced_when_their_terms_change() -> None:
    created = plan_price("premium_year", PREMIUM_YEAR, [])
    params = _params(created.params)
    assert (created.action, created.path) == ("create", "/v1/prices")
    assert params["lookup_key"] == "premium_year" and params["unit_amount"] == "49990"
    assert params["recurring[interval]"] == "year" and params["tax_behavior"] == "exclusive"
    assert "transfer_lookup_key" not in params
    assert plan_price("premium_year", PREMIUM_YEAR, [_price()]).action == "keep"
    moved = plan_price("premium_year", PREMIUM_YEAR, [_price(unit_amount=60000)])
    assert moved.action == "create" and "replacing price_1" in moved.detail
    assert _params(moved.params)["transfer_lookup_key"] == "true"
    inactive = plan_price("premium_year", PREMIUM_YEAR, [_price(active=False)])
    assert _params(inactive.params)["transfer_lookup_key"] == "true"


RETURN_URL = "http://localhost:8700/setup/plan"


def test_portal_configuration_allows_no_plan_switching() -> None:
    created = plan_portal([], RETURN_URL)
    params = _params(created.params)
    assert (created.action, created.path) == ("create", "/v1/billing_portal/configurations")
    assert params["features[subscription_update][enabled]"] == "false"
    assert params["features[subscription_cancel][mode]"] == "at_period_end"
    assert params["features[payment_method_update][enabled]"] == "true"
    assert params["metadata[clientbridge]"] == "portal"
    assert params["default_return_url"] == RETURN_URL
    features: dict[str, object] = {
        "customer_update": {"enabled": True, "allowed_updates": ["email", "address"]},
        "invoice_history": {"enabled": True},
        "payment_method_update": {"enabled": True},
        "subscription_cancel": {"enabled": True, "mode": "at_period_end"},
        "subscription_update": {"enabled": False},
    }
    current: dict[str, object] = {
        "id": "bpc_1",
        "active": True,
        "default_return_url": RETURN_URL,
        "metadata": {"clientbridge": "portal"},
        "features": features,
    }
    assert plan_portal([current], RETURN_URL).action == "keep"
    switching = {
        **current,
        "features": {**features, "subscription_update": {"enabled": True}},
    }
    updated = plan_portal([switching], RETURN_URL)
    assert (updated.action, updated.path) == ("update", "/v1/billing_portal/configurations/bpc_1")
    assert updated.detail == "bpc_1: subscription_update"
    assert plan_portal([current, {**current, "id": "bpc_2"}], RETURN_URL).action == "blocked"


def test_portal_ignores_the_order_stripe_lists_allowed_updates_in() -> None:
    config = {
        "id": "bpc_1",
        "active": True,
        "default_return_url": RETURN_URL,
        "metadata": {"clientbridge": "portal"},
        "features": {
            "customer_update": {"enabled": True, "allowed_updates": ["address", "email"]},
            "invoice_history": {"enabled": True},
            "payment_method_update": {"enabled": True},
            "subscription_cancel": {"enabled": True, "mode": "at_period_end"},
            "subscription_update": {"enabled": False},
        },
    }
    assert plan_portal([config], RETURN_URL).action == "keep"


def test_an_account_closed_earlier_gets_a_fresh_create_key() -> None:
    fresh = plan_account(BIRCHBARK, [])
    closed = {"id": "acct_closed", "closed": True, "metadata": {DEMO_TAG: "bz_birchbark"}}
    again = plan_account(BIRCHBARK, [], [closed])
    assert again.action == "create" and again.idempotency != fresh.idempotency
    assert plan_account(BIRCHBARK, [], [closed]).idempotency == again.idempotency


def test_a_deployed_endpoint_never_shows_the_listen_secret(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["--webhook-url", URL, "--show-secrets"], runner=FakeCli()) == 0
    out = capsys.readouterr().out
    assert "whsec_test_secret" not in out
    for name in (
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_THIN_WEBHOOK_SECRET",
        "STRIPE_PLATFORM_WEBHOOK_SECRET",
    ):
        assert f"{name}=<shown only when the endpoint is created" in out


def test_local_runs_take_the_listen_secret_and_flag_an_expiring_cli_key(
    capsys: pytest.CaptureFixture[str],
) -> None:
    cli = FakeCli()
    cli.api_key = "rk_test_x"
    assert main([], runner=cli) == 0
    out = capsys.readouterr().out
    assert ["listen", "--print-secret"] in cli.calls
    assert "STRIPE_WEBHOOK_SECRET=whsec_...cret" in out
    assert "STRIPE_PLATFORM_WEBHOOK_SECRET=whsec_...cret" in out
    assert "expires" in out


def _flag(call: Sequence[str], name: str) -> str | None:
    return call[call.index(name) + 1] if name in call else None


def test_apply_creates_in_order_with_keys_and_reports_each_new_secret(
    capsys: pytest.CaptureFixture[str],
) -> None:
    cli = FakeCli()
    assert main(["--apply", "--webhook-url", URL, "--show-secrets"], runner=cli) == 0
    posts = [call for call in cli.calls if call[0] == "post"]
    assert [call[1] for call in posts] == [
        "/v1/webhook_endpoints",
        "/v1/webhook_endpoints",
        "/v2/core/event_destinations",
        *["/v1/products"] * 3,
        *["/v1/prices"] * 5,
        "/v1/billing_portal/configurations",
        *["/v2/core/accounts"] * 2,
    ]
    keys = [_flag(call, "--idempotency") for call in posts]
    assert keys[:3] == [None, None, None]
    assert all(str(key).startswith("clientbridge-product-") for key in keys[3:6])
    assert all(str(key).startswith("clientbridge-price-") for key in keys[6:11])
    assert all(str(key).startswith("clientbridge-demo-account-") for key in keys[12:])
    assert all(_flag(call, "--stripe-version") == STRIPE_API_VERSION for call in posts)
    out = capsys.readouterr().out
    assert "STRIPE_WEBHOOK_SECRET=whsec_endpoint_1" in out
    assert "STRIPE_PLATFORM_WEBHOOK_SECRET=whsec_endpoint_2" in out
    assert "STRIPE_THIN_WEBHOOK_SECRET=whsec_destination" in out
    assert "STRIPE_PORTAL_CONFIGURATION=obj_12" in out


def test_a_price_swung_back_and_forth_gets_a_fresh_key_each_time() -> None:
    a = plan_price("premium_year", PREMIUM_YEAR, [_price(id="price_a", unit_amount=60000)])
    b = plan_price(
        "premium_year",
        PlanPrice("clientbridge_premium", 60000, "year"),
        [_price(id="price_b")],
    )
    again = plan_price("premium_year", PREMIUM_YEAR, [_price(id="price_c", unit_amount=60000)])
    assert len({a.idempotency, b.idempotency, again.idempotency}) == 3
    assert a.idempotency is not None and "price_a" in a.idempotency


def test_payment_domains_are_registered_on_the_account_and_disabled_ones_enabled() -> None:
    domains = ("book.staging.clientbridge.ca", "pay.staging.clientbridge.ca")
    existing = [{"id": "pmd_1", "domain_name": domains[0], "enabled": False}]
    update, create = plan_payment_domains("bz_birchbark", "acct_b", existing, domains)
    assert (update.action, update.path, update.params) == (
        "update",
        "/v1/payment_method_domains/pmd_1",
        ("enabled=true",),
    )
    assert (create.action, create.path, create.account) == (
        "create",
        "/v1/payment_method_domains",
        "acct_b",
    )
    assert create.params == (f"domain_name={domains[1]}", "enabled=true")
    enabled = [{"id": "pmd_1", "domain_name": d, "enabled": True} for d in domains]
    kept = plan_payment_domains("bz_birchbark", "acct_b", enabled, domains)
    assert {step.action for step in kept} == {"keep"}
    (waiting,) = plan_payment_domains("bz_birchbark", None, [], domains)
    assert waiting.action == "keep" and waiting.method == ""


def test_payment_domains_are_planned_for_each_demo_account(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["--payment-domains", "staging.clientbridge.ca"], runner=FakeCli()) == 0
    out = capsys.readouterr().out
    assert "payment method domains for bz_birchbark: the account does not exist yet" in out
    assert main(["--payment-domains", "localhost:8751"], runner=FakeCli()) == 1
    assert "[blocked] payment method domains" in capsys.readouterr().out


def test_api_requests_send_v2_as_json_and_repeat_list_queries() -> None:
    listing = api_request("get", "/v2/core/accounts", [json.dumps({"limit": 20, "closed": True})])
    assert listing.query == [("limit", "20"), ("closed", "true")]
    include = json.dumps({"include": ["defaults", "requirements"]})
    assert api_request("get", "/v2/core/accounts/acct_1", [include]).query == [
        ("include", "defaults"),
        ("include", "requirements"),
    ]
    created = api_request("post", "/v2/core/accounts", [json.dumps({"display_name": "Birchbark"})])
    assert (created.query, created.form, created.body) == (
        [],
        None,
        '{"display_name": "Birchbark"}',
    )


def test_api_requests_send_v1_as_query_or_form_pairs() -> None:
    assert api_request("get", "/v1/customers", ["limit=100"]).query == [("limit", "100")]
    attach = api_request("post", "/v1/customers", ["name=Ana", "expand[]=a", "expand[]=b"])
    assert attach.form == {"name": ["Ana"], "expand[]": ["a", "b"]}


def test_linking_runs_only_on_dev_or_staging_with_a_test_key() -> None:
    assert link_problems("staging", "sk_test_1") == []
    assert link_problems("dev", "rk_test_1") == []
    assert link_problems("prod", "sk_test_1") == [
        "ENV is 'prod'; linking runs only with ENV=dev or ENV=staging"
    ]
    assert link_problems("staging", "sk_live_1") == ["STRIPE_SECRET_KEY is not a test-mode key"]
