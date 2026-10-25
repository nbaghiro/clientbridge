"""Recover exact manifest-owned sandbox intents without the disposable application database."""

import argparse
import asyncio
import fcntl
import json
import os
import re
import sys
import tomllib
from pathlib import Path
from typing import Literal
from uuid import UUID

import stripe
from pydantic import BaseModel, ConfigDict, model_validator

from clientbridge.core import clock
from clientbridge.integrations.stripe import STRIPE_API_VERSION, close_stripe_client
from scripts.e2e_stack import ROOT
from scripts.e2e_stripe_deposits import DepositFixture, validate_deposit_intent
from scripts.e2e_stripe_setup import cleanup_intent


class Fixture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invoice: str
    client: str
    customer: str | None = None


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: UUID
    account: str
    platform: str
    business: Literal["bz_birchbark"]
    database: dict[str, object]
    fixtures: list[Fixture]
    deposit_fixtures: list[DepositFixture] = []
    cleanup: list[dict[str, object]] = []

    @model_validator(mode="after")
    def complete_lineage(self) -> "Manifest":
        for fixture in [*self.fixtures, *self.deposit_fixtures]:
            if not fixture.customer:
                raise ValueError(
                    "incomplete registered customer lineage; recovery cannot prove clean"
                )
        for field in ("invoice", "client", "customer"):
            values = [getattr(fixture, field) for fixture in self.fixtures]
            if len(values) != len(set(values)):
                raise ValueError("duplicate fixture ownership")
        for field in ("booking", "client", "customer"):
            values = [getattr(fixture, field) for fixture in self.deposit_fixtures]
            if len(values) != len(set(values)):
                raise ValueError("duplicate deposit fixture ownership")
        for field in ("client", "customer"):
            values = [
                getattr(fixture, field) for fixture in [*self.fixtures, *self.deposit_fixtures]
            ]
            if len(values) != len(set(values)):
                raise ValueError("invoice and deposit fixture ownership overlaps")
        return self


def credentials(mode: str, profile: str, merchants: Path) -> dict[str, str]:
    names = ("STRIPE_TEST_PLATFORM", "STRIPE_TEST_CONNECTED_ACCOUNT", "STRIPE_TEST_OTHER_ACCOUNT")
    if mode == "local":
        if os.environ.get("CI"):
            raise ValueError("CI recovery cannot read local CLI credentials")
        selected = tomllib.loads((Path.home() / ".config/stripe/config.toml").read_text())[profile]
        if "clientbridge" not in selected.get("display_name", "").lower():
            raise ValueError("requires an explicitly named Clientbridge test profile")
        saved = json.loads(merchants.read_text())
        if saved["STRIPE_TEST_PLATFORM"] != selected["account_id"]:
            raise ValueError("merchant manifest and CLI profile platform differ")
        env = {name: saved[name] for name in names}
        env["STRIPE_TEST_SECRET_KEY"] = selected.get("test_mode_api_key", "")
    else:
        env = {name: os.environ.get(name, "") for name in (*names, "STRIPE_TEST_SECRET_KEY")}
    if not all(env.values()) or not env["STRIPE_TEST_SECRET_KEY"].startswith(
        ("sk_test_", "rk_test_")
    ):
        raise ValueError("recovery requires complete test-mode credentials and account identities")
    if env["STRIPE_TEST_CONNECTED_ACCOUNT"] == env["STRIPE_TEST_OTHER_ACCOUNT"]:
        raise ValueError("dedicated QA account identities must differ")
    return env


async def recover(
    manifest: Manifest,
    env: dict[str, str],
    environment: str,
    *,
    apply: bool,
    actions: list[dict[str, object]] | None = None,
) -> list[dict[str, object]]:
    if environment not in ("local", "ci"):
        raise ValueError("unsupported recovery environment")
    if (
        manifest.platform != env["STRIPE_TEST_PLATFORM"]
        or manifest.account != env["STRIPE_TEST_CONNECTED_ACCOUNT"]
        or not env["STRIPE_TEST_SECRET_KEY"].startswith(("sk_test_", "rk_test_"))
    ):
        raise ValueError("recovery manifest does not match configured test platform/account")
    stripe.api_key = env["STRIPE_TEST_SECRET_KEY"]
    stripe.api_version = STRIPE_API_VERSION
    platform = await stripe.Account.retrieve_async()
    if platform.id != manifest.platform or (await stripe.Balance.retrieve_async()).livemode:
        raise ValueError("platform identity or test mode mismatch")
    for account, slot in (
        (manifest.account, "a"),
        (env["STRIPE_TEST_OTHER_ACCOUNT"], "b"),
    ):
        merchant = await stripe.Account.retrieve_async(account)
        metadata = merchant.to_dict().get("metadata", {})
        if (
            metadata.get("clientbridge_qa") != "payments"
            or metadata.get("clientbridge_qa_environment") != environment
            or metadata.get("clientbridge_qa_slot") != slot
            or (await stripe.Balance.retrieve_async(stripe_account=account)).livemode
        ):
            raise ValueError("merchant ownership or test mode mismatch")
    owned: list[tuple[stripe.PaymentIntent, dict[str, str]]] = []
    for fixture in [*manifest.fixtures, *manifest.deposit_fixtures]:
        if fixture.customer is None:
            raise ValueError("incomplete customer lineage")
        expected = {
            "clientbridge_qa": "payments",
            "clientbridge_qa_environment": environment,
            "clientbridge_qa_run": str(manifest.run_id),
            "clientbridge_qa_client": fixture.client,
        }
        source = "booking" if isinstance(fixture, DepositFixture) else "invoice"
        target = fixture.booking if isinstance(fixture, DepositFixture) else fixture.invoice
        expected[f"clientbridge_qa_{source}"] = target
        customer = await stripe.Customer.retrieve_async(
            fixture.customer, stripe_account=manifest.account
        )
        if (
            customer.livemode
            or customer.id != fixture.customer
            or customer.to_dict().get("metadata") != expected
        ):
            raise ValueError("registered customer ownership mismatch")
        intents = await stripe.PaymentIntent.list_async(
            customer=customer.id, stripe_account=manifest.account
        )
        async for intent in intents.auto_paging_iter():
            if isinstance(fixture, DepositFixture):
                validate_deposit_intent(intent, fixture)
            metadata = intent.to_dict().get("metadata", {})
            if (
                intent.livemode
                or intent.customer != fixture.customer
                or metadata.get(f"{source}_id") != target
                or (source == "booking" and metadata.get("invoice_id"))
                or metadata.get("business_id") != manifest.business
                or intent.amount != 2000
                or intent.currency != "cad"
            ):
                raise ValueError("registered customer has an intent outside this exact fixture")
            owned.append((intent, expected))
    # Validate every fixture before the first mutation, so conflicting ownership fails closed.
    results = actions if actions is not None else []
    plans = [
        await cleanup_intent(manifest.account, intent, metadata, apply=False)
        for intent, metadata in owned
    ]
    if not apply:
        results.extend(plans)
        return results
    for intent, metadata in owned:
        current = await stripe.PaymentIntent.retrieve_async(
            intent.id, stripe_account=manifest.account
        )
        current_tags = current.to_dict().get("metadata", {})
        if (
            current.id != intent.id
            or current.customer != intent.customer
            or current.amount != intent.amount
            or current.currency != intent.currency
            or current_tags.get(
                "booking_id" if "clientbridge_qa_booking" in metadata else "invoice_id"
            )
            != metadata.get("clientbridge_qa_booking", metadata.get("clientbridge_qa_invoice"))
            or ("clientbridge_qa_booking" in metadata and current_tags.get("invoice_id"))
            or current_tags.get("business_id") != manifest.business
        ):
            raise ValueError("owned intent identity changed during recovery")
        results.append(await cleanup_intent(manifest.account, current, metadata))
    return results


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--credentials", choices=("local", "environment"), default="local")
    parser.add_argument("--profile", default="clientbridge")
    parser.add_argument(
        "--merchants", type=Path, default=ROOT / ".scratchpad/stripe-local-merchants-ready.json"
    )
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    state = args.state.resolve()
    if (
        args.state.is_symlink()
        or state.name != "stripe-fixtures.json"
        or state.parent.parent != ROOT / ".scratchpad"
        or re.fullmatch(r"e2e-[a-f0-9]{12}", state.parent.name) is None
    ):
        parser.error("requires one exact run manifest under repo .scratchpad/e2e-<12 hex>")
    destination = state.parent / "provider-recovery.json"
    attempt: dict[str, object] = {"started_at": clock.wall().isoformat(), "apply": args.apply}
    lease = (ROOT / ".scratchpad/stripe-qa.lock").open("a")
    held = False
    code = 1
    try:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        held = True
        original = json.loads((state.parent / "run.json").read_text())
        if original.get("surface") != "connect-stripe":
            raise ValueError("manifest does not belong to a provider browser run")
        attempt["original_outcome"] = original.get("outcome")
        manifest = Manifest.model_validate_json(state.read_text())
        attempt["run_id"] = str(manifest.run_id)
        attempt["account"] = manifest.account
        env = credentials(args.credentials, args.profile, args.merchants)
        actions: list[dict[str, object]] = []
        attempt["actions"] = actions
        await recover(
            manifest,
            env,
            "ci" if args.credentials == "environment" else "local",
            apply=args.apply,
            actions=actions,
        )
        attempt["status"] = (
            "planned"
            if any(str(action["status"]).startswith("planned_") for action in actions)
            else "verified_clean"
        )
        code = 0
    except Exception as error:
        attempt["status"] = "failed"
        attempt["error_type"] = type(error).__name__
    finally:
        await close_stripe_client()
        attempt["finished_at"] = clock.wall().isoformat()
        try:
            if held:
                previous = json.loads(destination.read_text()) if destination.exists() else []
                if not isinstance(previous, list):
                    raise ValueError("invalid recovery history")
                previous.append(attempt)
                temporary = destination.with_suffix(".tmp")
                temporary.write_text(json.dumps(previous, indent=2) + "\n")
                temporary.chmod(0o600)
                temporary.replace(destination)
        except Exception:
            code = 1
            attempt["status"] = "failed"
            attempt["error_type"] = "RecoveryRecordError"
        finally:
            lease.close()
        print(json.dumps(attempt))
    return code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
