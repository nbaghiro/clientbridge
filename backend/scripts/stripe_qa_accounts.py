"""Inspect and prefill dedicated sandbox merchants without accepting terms or creating payments."""

import argparse
import asyncio
import json
import tomllib
from pathlib import Path

import stripe
from stripe.params.v2.core import AccountRetrieveParams

from clientbridge.integrations.stripe import (
    STRIPE_API_VERSION,
    account_status_from,
    close_stripe_client,
)

ACCOUNT_PARAMS: AccountRetrieveParams = {
    "include": ["configuration.merchant", "defaults", "requirements"]
}


async def prepare_account(client: stripe.StripeClient, account_id: str, slot: str) -> None:
    """Prefill documented Stripe test identity values, never a real person's identity."""
    await client.v2.core.accounts.update_async(
        account_id,
        {
            "identity": {
                "entity_type": "individual",
                "individual": {
                    "given_name": "Sophie" if slot == "a" else "Oliver",
                    "surname": "Bennett" if slot == "a" else "Laurent",
                    "email": f"clientbridge-qa-{slot}@example.com",
                    "phone": "+14165550123",
                    "date_of_birth": {"day": 1, "month": 1, "year": 1901},
                    "id_numbers": [{"type": "ca_sin", "value": "000000000"}],
                    "relationship": {"title": "Owner"},
                    "address": {
                        "line1": "address_full_match",
                        "city": "Toronto",
                        "state": "ON",
                        "postal_code": "M5V 2T6",
                        "country": "ca",
                    },
                },
            },
            "defaults": {
                "profile": {
                    "business_url": "https://accessible.stripe.com",
                    "product_description": "Scheduled personal training services",
                },
            },
            "configuration": {
                "merchant": {
                    "mcc": "7299",
                    "support": {"phone": "+14165550123"},
                },
            },
        },
    )


async def provision(
    profile: str,
    apply: bool,
    prepare: bool = False,
    bank: bool = False,
    environment: str = "local",
    onboarding: bool = False,
) -> dict[str, object]:
    if environment not in ("local", "ci"):
        raise ValueError("merchant environment must be local or ci")
    if (prepare or bank or onboarding) and not apply:
        raise ValueError("sandbox mutations require --apply")
    config = tomllib.loads((Path.home() / ".config/stripe/config.toml").read_text())
    selected = config[profile]
    key = selected.get("test_mode_api_key")
    if not isinstance(key, str) or not key.startswith(("sk_test_", "rk_test_")):
        raise ValueError("the selected CLI profile must contain a test-mode API key")
    if "clientbridge" not in str(selected.get("display_name", "")).lower():
        raise ValueError("select a CLI profile explicitly named Clientbridge")
    stripe.api_key = key
    client = stripe.StripeClient(key, stripe_version=STRIPE_API_VERSION)
    platform = await stripe.Account.retrieve_async()
    if (
        platform.id != selected.get("account_id")
        or (await stripe.Balance.retrieve_async()).livemode
    ):
        raise ValueError("the selected platform identity or test mode could not be verified")
    found: dict[str, stripe.Account] = {}
    accounts = await stripe.Account.list_async(limit=100)
    async for account in accounts.auto_paging_iter():
        tags = account.to_dict().get("metadata")
        if not isinstance(tags, dict):
            continue
        if (
            tags.get("clientbridge_qa") == "payments"
            and tags.get("clientbridge_qa_environment") == environment
        ):
            slot = tags.get("clientbridge_qa_slot", "")
            if slot in found:
                raise ValueError(f"multiple QA accounts claim {environment} slot {slot}")
            found[slot] = account
    output: dict[str, object] = {
        "STRIPE_TEST_PLATFORM": platform.id,
        "profile": profile,
        "environment": environment,
        "merchants": [],
    }
    rows: list[dict[str, object]] = []
    for slot, variable in (
        ("a", "STRIPE_TEST_CONNECTED_ACCOUNT"),
        ("b", "STRIPE_TEST_OTHER_ACCOUNT"),
    ):
        account = found.get(slot)
        if account is None and apply:
            created = await client.v2.core.accounts.create_async(
                {
                    "display_name": f"Clientbridge {environment} QA {slot}",
                    "contact_email": f"clientbridge-qa-{slot}@example.com",
                    "dashboard": "none",
                    "identity": {"country": "ca"},
                    "defaults": {
                        "currency": "cad",
                        "responsibilities": {
                            "fees_collector": "stripe",
                            "losses_collector": "stripe",
                        },
                    },
                    "configuration": {
                        "merchant": {"capabilities": {"card_payments": {"requested": True}}}
                    },
                    "metadata": {
                        "clientbridge_qa": "payments",
                        "clientbridge_qa_environment": environment,
                        "clientbridge_qa_slot": slot,
                    },
                },
                {"idempotency_key": f"clientbridge-qa-{environment}-{slot}-v2"},
            )
            account = await stripe.Account.retrieve_async(created.id)
        if account is None:
            rows.append({"slot": slot, "action": "create"})
            continue
        current = await client.v2.core.accounts.retrieve_async(account.id, ACCOUNT_PARAMS)
        data = current.to_dict()
        expected_tags = {
            "clientbridge_qa": "payments",
            "clientbridge_qa_environment": environment,
            "clientbridge_qa_slot": slot,
        }
        if current.livemode or any(
            data.get("metadata", {}).get(name) != value for name, value in expected_tags.items()
        ):
            raise ValueError("refusing an account without exact selected sandbox ownership tags")
        if prepare:
            await prepare_account(client, account.id, slot)
        if bank:
            # Canadian payout-success fixture: https://docs.stripe.com/connect/testing#payouts
            banks = await stripe.Account.list_external_accounts_async(
                account.id, object="bank_account", limit=100
            )
            if not any(
                item.get("country") == "CA"
                and item.get("currency") == "cad"
                and item.get("routing_number") == "11000-000"
                and item.get("last4") == "6789"
                for item in (bank.to_dict() for bank in banks.data)
            ):
                await stripe.Account.create_external_account_async(
                    account.id,
                    external_account={
                        "object": "bank_account",
                        "country": "CA",
                        "currency": "cad",
                        "routing_number": "11000-000",
                        "account_number": "000123456789",
                    },
                    idempotency_key=f"clientbridge-qa-{environment}-{slot}-test-bank-v1",
                )
        if prepare or bank:
            current = await client.v2.core.accounts.retrieve_async(account.id, ACCOUNT_PARAMS)
            data = current.to_dict()
            account = await stripe.Account.retrieve_async(account.id)
        status = account_status_from(account.id, data)
        output[variable] = account.id
        link: str | None = None
        if onboarding and not (account.charges_enabled and account.payouts_enabled):
            # Stripe-hosted onboarding accepts the terms, which no API call does for the account
            created_link = await client.v2.core.account_links.create_async(
                {
                    "account": account.id,
                    "use_case": {
                        "type": "account_onboarding",
                        "account_onboarding": {
                            "refresh_url": "https://accessible.stripe.com",
                            "return_url": "https://accessible.stripe.com",
                        },
                    },
                }
            )
            link = created_link.url
        rows.append(
            {
                "onboarding_url": link,
                "slot": slot,
                "id": account.id,
                "charges_enabled": account.charges_enabled,
                "payouts_enabled": account.payouts_enabled,
                "currently_due": status.currently_due,
                "past_due": status.past_due,
                "eventually_due": status.eventually_due,
                "requirements_collector": data["defaults"]["responsibilities"][
                    "requirements_collector"
                ],
                "capabilities": {
                    name: value
                    for name, value in data["configuration"]["merchant"]["capabilities"].items()
                    if value is not None
                },
            }
        )
    output["merchants"] = rows
    return output


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="clientbridge")
    parser.add_argument("--environment", choices=("local", "ci"), default="local")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--bank", action="store_true", help="attach documented CA test bank; requires --apply"
    )
    parser.add_argument(
        "--onboarding-links",
        action="store_true",
        help="print a Stripe-hosted onboarding link for each unready merchant; requires --apply",
    )
    parser.add_argument(
        "--output", type=Path, help="also write the merchant manifest here, readable only by you"
    )
    parser.add_argument(
        "--prepare",
        action="store_true",
        help="prefill synthetic identity/profile values; requires --apply; no terms or bank writes",
    )
    args = parser.parse_args()
    try:
        manifest = json.dumps(
            await provision(
                args.profile,
                args.apply,
                args.prepare,
                args.bank,
                args.environment,
                args.onboarding_links,
            ),
            indent=2,
        )
        print(manifest)
        if args.output is not None:
            args.output.write_text(manifest + "\n")
            args.output.chmod(0o600)
    finally:
        await close_stripe_client()


if __name__ == "__main__":
    asyncio.run(main())
