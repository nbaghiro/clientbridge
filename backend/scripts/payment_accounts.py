"""Audit one connected account; only --apply writes missing profile and descriptor fields."""

import argparse
import asyncio
import json
import re
from collections.abc import Mapping
from typing import cast

import stripe
from stripe.params import AccountUpdateParams, AccountUpdateParamsBusinessProfile

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal, engine
from clientbridge.integrations.stripe import STRIPE_API_VERSION, payment_descriptor
from clientbridge.models.business import Business


def _mapping(value: object) -> Mapping[str, object]:
    return cast(Mapping[str, object], value) if isinstance(value, dict) else {}


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def plan_account(
    current: Mapping[str, object], *, name: str, email: str | None, url: str
) -> AccountUpdateParams:
    profile = _mapping(current.get("business_profile"))
    proposed: AccountUpdateParamsBusinessProfile = {}
    if not _text(profile.get("name")).strip():
        proposed["name"] = name
    if email and not _text(profile.get("support_email")).strip():
        proposed["support_email"] = email
    if not _text(profile.get("url")).strip():
        proposed["url"] = url
    settings = _mapping(current.get("settings"))
    descriptor = _text(_mapping(settings.get("payments")).get("statement_descriptor"))
    prefix = _text(_mapping(settings.get("card_payments")).get("statement_descriptor_prefix"))
    desired = descriptor if descriptor.strip() else payment_descriptor(name)
    desired_prefix = prefix if prefix.strip() else (desired or "")[:10].rstrip()
    if not prefix.strip() and not re.search("[A-Za-z]", desired_prefix):
        desired_prefix = ""
    result: AccountUpdateParams = {}
    if proposed:
        result["business_profile"] = proposed
    # Profile or descriptor updates can regenerate descriptors; preserve existing values.
    if proposed or not descriptor.strip() or not prefix.strip():
        if desired:
            result["settings"] = {"payments": {"statement_descriptor": desired}}
        if desired_prefix:
            result.setdefault("settings", {})["card_payments"] = {
                "statement_descriptor_prefix": desired_prefix
            }
    return result


def audit_account(current: Mapping[str, object], changes: AccountUpdateParams) -> dict[str, object]:
    settings = _mapping(current.get("settings"))
    profile = _mapping(current.get("business_profile"))
    return {
        "profile_present": {
            key: bool(_text(profile.get(key)).strip()) for key in ("name", "support_email", "url")
        },
        "statement_descriptor": _mapping(settings.get("payments")).get("statement_descriptor"),
        "statement_descriptor_prefix": _mapping(settings.get("card_payments")).get(
            "statement_descriptor_prefix"
        ),
        "account_email_present": bool(_text(current.get("email")).strip()),
        "email_controls": {
            "account_email": "available; unchanged",
            "business_profile.support_email": "available; only filled when missing",
            "automatic_receipts": "not verified by Account API; review Dashboard settings",
            "subscription_emails": "not verified by Account API; review Dashboard settings",
        },
        "planned_changes": changes,
    }


async def reconcile(business_id: str, *, apply: bool) -> None:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise SystemExit("Payments are not configured; no account was read or changed.")
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = STRIPE_API_VERSION
    async with SessionLocal() as db:
        business = await db.get(Business, business_id)
        if business is None:
            raise SystemExit("Selected business does not exist.")
        account_id = business.stripe_account_id
        if not account_id:
            raise SystemExit("Selected business has no connected account.")
        account = await stripe.Account.retrieve_async(account_id)
        current = _mapping(account.to_dict())
        changes = plan_account(
            current,
            name=business.name,
            email=business.billing_email,
            url=f"{settings.connect_base_url.rstrip('/')}/book/{business.slug}",
        )
        report = audit_account(current, changes)
        report.update(business_id=business.id, account_id=account_id, mode="dry_run", applied=False)
        if apply:
            report["mode"] = "apply"
            if changes:
                await stripe.Account.modify_async(account_id, **changes)
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
