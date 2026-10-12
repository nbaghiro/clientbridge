"""Audit one connected account; only --apply writes missing profile and descriptor fields."""

import argparse
import asyncio
import json
import re
from collections.abc import Mapping
from typing import cast

import stripe
from stripe.params.v2.core import (
    AccountUpdateParams,
    AccountUpdateParamsConfigurationMerchant,
    AccountUpdateParamsConfigurationMerchantStatementDescriptor,
)

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import STRIPE_API_VERSION, payment_descriptor
from clientbridge.models.business import Business


def _mapping(value: object) -> Mapping[str, object]:
    return cast(Mapping[str, object], value) if isinstance(value, dict) else {}


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def _merchant(current: Mapping[str, object]) -> Mapping[str, object]:
    return _mapping(_mapping(current.get("configuration")).get("merchant"))


def _business_url(current: Mapping[str, object]) -> str:
    return _text(_mapping(_mapping(current.get("defaults")).get("profile")).get("business_url"))


def plan_account(
    current: Mapping[str, object], *, name: str, email: str | None, url: str
) -> AccountUpdateParams:
    result: AccountUpdateParams = {}
    merchant: AccountUpdateParamsConfigurationMerchant = {}
    if not _text(current.get("display_name")).strip():
        result["display_name"] = name
    if not _business_url(current).strip():
        result["defaults"] = {"profile": {"business_url": url}}
    configured = _merchant(current)
    if email and not _text(_mapping(configured.get("support")).get("email")).strip():
        merchant["support"] = {"email": email}
    current_descriptor = _mapping(configured.get("statement_descriptor"))
    descriptor = _text(current_descriptor.get("descriptor"))
    prefix = _text(current_descriptor.get("prefix"))
    desired = descriptor if descriptor.strip() else payment_descriptor(name)
    desired_prefix = prefix if prefix.strip() else (desired or "")[:10].rstrip()
    if not prefix.strip() and not re.search("[A-Za-z]", desired_prefix):
        desired_prefix = ""
    # Profile or descriptor updates can regenerate descriptors; preserve existing values.
    if result or merchant or not descriptor.strip() or not prefix.strip():
        statement: AccountUpdateParamsConfigurationMerchantStatementDescriptor = {}
        if desired:
            statement["descriptor"] = desired
        if desired_prefix:
            statement["prefix"] = desired_prefix
        if statement:
            merchant["statement_descriptor"] = statement
    if merchant:
        result["configuration"] = {"merchant": merchant}
    return result


def audit_account(current: Mapping[str, object], changes: AccountUpdateParams) -> dict[str, object]:
    configured = _merchant(current)
    statement = _mapping(configured.get("statement_descriptor"))
    return {
        "profile_present": {
            "display_name": bool(_text(current.get("display_name")).strip()),
            "support_email": bool(_text(_mapping(configured.get("support")).get("email")).strip()),
            "business_url": bool(_business_url(current).strip()),
        },
        "statement_descriptor": statement.get("descriptor"),
        "statement_descriptor_prefix": statement.get("prefix"),
        "account_email_present": bool(_text(current.get("contact_email")).strip()),
        "email_controls": {
            "contact_email": "available; unchanged",
            "configuration.merchant.support.email": "available; only filled when missing",
            "automatic_receipts": "not verified by Account API; review Dashboard settings",
            "subscription_emails": "not verified by Account API; review Dashboard settings",
        },
        "planned_changes": changes,
    }


async def reconcile(business_id: str, *, apply: bool) -> None:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise SystemExit("Payments are not configured; no account was read or changed.")
    client = stripe.StripeClient(settings.stripe_secret_key, stripe_version=STRIPE_API_VERSION)
    async with SessionLocal() as db:
        business = await db.get(Business, business_id)
        if business is None:
            raise SystemExit("Selected business does not exist.")
        account_id = business.stripe_account_id
        if not account_id:
            raise SystemExit("Selected business has no connected account.")
        account = await client.v2.core.accounts.retrieve_async(
            account_id, {"include": ["configuration.merchant", "defaults"]}
        )
        current = _mapping(account.to_dict())
        changes = plan_account(
            current,
            name=business.name,
            email=business.billing_email,
            url=f"{settings.connect_base_url.rstrip('/')}/b/{business.slug}",
        )
        report = audit_account(current, changes)
        report.update(business_id=business.id, account_id=account_id, mode="dry_run", applied=False)
        if apply:
            report["mode"] = "apply"
            if changes:
                await client.v2.core.accounts.update_async(account_id, changes)
                report["applied"] = True
        print(json.dumps(report, indent=2, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--business-id", required=True, help="The single business to audit or update"
    )
    parser.add_argument("--apply", action="store_true", help="Apply missing fields to this account")
    args = parser.parse_args()

    async def run() -> None:
        try:
            await reconcile(str(args.business_id), apply=bool(args.apply))
        except stripe.StripeError:
            raise SystemExit(
                "Payment provider request failed; no credentials are printed."
            ) from None
        finally:
            await engine.dispose()

    asyncio.run(run())


if __name__ == "__main__":
    main()
