import ast
import json
import pathlib
from collections.abc import Sequence

import pytest
from scripts.stripe_setup import (
    DEMO_BUSINESSES,
    DEMO_TAG,
    WEBHOOK_EVENTS,
    Linker,
    Stripe,
    card_token_for,
    main,
    plan_account,
    plan_location,
    plan_webhook,
    requirement_fill,
    safety_problems,
)
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.scoping import scoped
from clientbridge.integrations.stripe import STRIPE_API_VERSION, PostalAddress
from clientbridge.models.business import Business
from clientbridge.models.clients import Client
from clientbridge.models.payments import PaymentMethod

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
        "connect": True,
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


def test_missing_account_is_created_with_capabilities_and_test_data() -> None:
    step = plan_account(BIRCHBARK, [], 1_700_000_000)
    params = _params(step.params)
    assert (step.action, step.path) == ("create", "/v1/accounts")
    assert step.idempotency == "clientbridge-demo-account-bz_birchbark"
    assert params["type"] == "custom"
    assert params["country"] == "CA"
    assert params[f"metadata[{DEMO_TAG}]"] == "bz_birchbark"
    for name in ("card_payments", "transfers", "acss_debit_payments"):
        assert params[f"capabilities[{name}][requested]"] == "true"
    assert params["individual[dob][year]"] == "1901"
    assert params["individual[address][line1]"] == "address_full_match"
    assert params["external_account[routing_number]"] == "11000-000"
    assert params["settings[payments][statement_descriptor]"] == "BIRCHBARK PET STUDIO"
    assert params["tos_acceptance[date]"] == "1700000000"


def test_existing_account_requests_missing_capabilities_and_fills_due_fields() -> None:
    account = {
        "id": "acct_b",
        "type": "custom",
        "country": "CA",
        "metadata": {DEMO_TAG: "bz_birchbark"},
        "capabilities": {"card_payments": "active", "transfers": "active"},
        "settings": {"branding": {"primary_color": "#2E4A3F"}},
        "requirements": {
            "currently_due": ["individual.dob.day", "external_account", "company.tax_id"],
            "past_due": [],
        },
    }
    step = plan_account(BIRCHBARK, [account], 1)
    params = _params(step.params)
    assert (step.action, step.path) == ("update", "/v1/accounts/acct_b")
    assert params == {
        "capabilities[acss_debit_payments][requested]": "true",
        "individual[dob][day]": "1",
        "external_account[object]": "bank_account",
        "external_account[country]": "CA",
        "external_account[currency]": "cad",
        "external_account[routing_number]": "11000-000",
        "external_account[account_number]": "000123456789",
    }
    assert "company.tax_id" in step.detail


def test_complete_account_is_kept_and_duplicates_block() -> None:
    account = {
        "id": "acct_b",
        "type": "custom",
        "country": "CA",
        "capabilities": {
            "card_payments": "active",
            "transfers": "active",
            "acss_debit_payments": 1,
        },
        "settings": {"branding": {"primary_color": "#2E4A3F"}},
        "requirements": {"currently_due": [], "past_due": []},
    }
    assert plan_account(BIRCHBARK, [account], 1).action == "keep"
    assert plan_account(BIRCHBARK, [account, account], 1).action == "blocked"
    assert plan_account(BIRCHBARK, [{**account, "type": "express"}], 1).action == "blocked"


def test_verification_document_uses_the_test_file_token() -> None:
    fill, unknown = requirement_fill(BIRCHBARK, ["individual.verification.document"], 1)
    assert fill == {
        "individual": {"verification": {"document": {"front": "file_identity_document_success"}}}
    }
    assert unknown == []


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

    def __call__(self, args: Sequence[str]) -> str:
        self.calls.append(list(args))
        if args[0] == "config":
            lines = ("[p]", "test_mode_api_key=sk_test_x", "account_id=acct_p")
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
            return json.dumps({"id": f"obj_{self.created}", "card": card})
        if path.startswith(("/v1/payment_methods/", "/v1/customers/")):
            return json.dumps({"error": {"message": "No such object"}})
        return json.dumps({"data": [], "has_more": False})


def test_dry_run_reads_only(capsys: pytest.CaptureFixture[str]) -> None:
    cli = FakeCli()
    assert main(["--webhook-url", URL], runner=cli) == 0
    assert {call[0] for call in cli.calls} == {"config", "get", "listen"}
    assert ["listen", "--print-secret"] in cli.calls
    out = capsys.readouterr().out
    assert "[create ] connect webhook endpoint" in out
    assert "[create ] connected account for bz_birchbark" in out
    assert "whsec_test_secret" not in out and "whsec_...cret" in out
    assert "--forward-connect-to 127.0.0.1:8701/webhooks/stripe" in out


def test_unnamed_sandbox_is_refused_without_account(capsys: pytest.CaptureFixture[str]) -> None:
    cli = FakeCli("Other Co")
    assert main([], runner=cli) == 2
    assert "refusing to run" in capsys.readouterr().out
    assert main(["--account", "acct_p"], runner=cli) == 0


ACCOUNT: dict[str, object] = {
    "id": "acct_b",
    "charges_enabled": True,
    "payouts_enabled": True,
    "details_submitted": True,
    "requirements": {"currently_due": []},
}


async def _cards(db: AsyncSession) -> list[PaymentMethod]:
    query = scoped(PaymentMethod, "bz_birchbark").where(
        PaymentMethod.method == "card", PaymentMethod.status == "active"
    )
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
