"""Recover a run that stopped early: clean every object its manifest says it created."""

import argparse
import fcntl
import json
import os
import re
import tomllib
from pathlib import Path
from uuid import UUID

import stripe
from pydantic import BaseModel, ConfigDict, Field, model_validator

from clientbridge.core import clock
from clientbridge.integrations.stripe import (
    STRIPE_API_VERSION,
    close_stripe_client,
)
from e2e.stripe_cleanup import cleanup_intent
from e2e.stripe_clients import (
    ClientFixture,
    client_tags,
    clock_name,
    invoice_intents,
    owned_subscriptions,
)
from e2e.stripe_context import BUSINESS
from e2e.stripe_deposits import DepositFixture, validate_deposit_intent
from e2e.stripe_pool import checked, lease_file, pair, pairs
from e2e.tier import ROOT


async def clean_client(
    account: str,
    run: str,
    fixture: ClientFixture,
    *,
    apply: bool,
    environment: str | None = None,
    business: str = BUSINESS,
) -> list[dict[str, object]]:
    """Cancel the client's subscriptions, refund its charges, archive its prices, end its clock."""
    if fixture.customer is None:
        raise ValueError("client fixture has no customer")
    customer = await stripe.Customer.retrieve_async(fixture.customer, stripe_account=account)
    details = customer.to_dict()
    gone = bool(details.get("deleted"))
    if not gone and (
        customer.livemode
        or details.get("metadata") != client_tags(run, fixture.client, environment)
        or details.get("test_clock") != fixture.clock
    ):
        raise ValueError("client fixture customer ownership mismatch")
    if gone and fixture.clock is None:
        raise ValueError("a client fixture customer without a clock was deleted")
    subscriptions = [] if gone else await owned_subscriptions(account, fixture, business)
    from_invoices = await invoice_intents(account, subscriptions, apply=apply)
    owned: list[stripe.PaymentIntent] = []
    listed = await stripe.PaymentIntent.list_async(
        customer=fixture.customer, stripe_account=account
    )
    async for intent in listed.auto_paging_iter():
        metadata = intent.to_dict().get("metadata", {})
        if (
            intent.livemode
            or intent.customer != fixture.customer
            or intent.currency != "cad"
            or not (
                metadata.get("business_id") == business
                or intent.id in from_invoices
                or (gone and intent.status in ("succeeded", "canceled"))
            )
        ):
            raise ValueError("client fixture customer has an intent outside this run")
        owned.append(intent)
    tags = client_tags(run, fixture.client, environment)
    actions: list[dict[str, object]] = []
    for subscription in subscriptions:
        if subscription.status in ("canceled", "incomplete_expired"):
            continue
        if not apply:
            actions.append({"subscription": subscription.id, "status": "planned_cancel"})
            continue
        ended = await stripe.Subscription.cancel_async(subscription.id, stripe_account=account)
        actions.append({"subscription": ended.id, "status": ended.status})
    for intent in owned:
        if gone:
            planned = await cleanup_intent(account, intent, tags, apply=False)
            if not str(planned["status"]).startswith(("already_", "dispute_")):
                raise ValueError("a deleted clock customer left an unsettled charge")
            actions.append(planned)
        else:
            actions.append(await cleanup_intent(account, intent, tags, apply=apply))
    prices = {
        str(item["price"]["id"])
        for subscription in subscriptions
        for item in subscription.to_dict().get("items", {}).get("data", [])
    }
    for identity in sorted(prices):
        price = await stripe.Price.retrieve_async(identity, stripe_account=account)
        if price.livemode or not isinstance(price.product, str):
            raise ValueError("owned subscription price is not a sandbox product price")
        if not price.active:
            continue
        if not apply:
            actions.append({"price": price.id, "status": "planned_archive"})
            continue
        await stripe.Product.modify_async(
            price.product, default_price="", active=False, stripe_account=account
        )
        await stripe.Price.modify_async(price.id, active=False, stripe_account=account)
        actions.append({"price": price.id, "product": price.product, "status": "archived"})
    if fixture.clock is not None and not gone:
        clock_row = await stripe.test_helpers.TestClock.retrieve_async(
            fixture.clock, stripe_account=account
        )
        if clock_row.livemode or clock_row.name != clock_name(run, fixture.client):
            raise ValueError("client fixture clock ownership mismatch")
        if not apply:
            actions.append({"clock": fixture.clock, "status": "planned_delete"})
        else:
            await stripe.test_helpers.TestClock.delete_async(fixture.clock, stripe_account=account)
            actions.append({"clock": fixture.clock, "status": "deleted"})
    return actions


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
    business: str = Field(pattern=r"^bz_birchbark(_\d{4})?$")
    database: dict[str, object]
    fixtures: list[Fixture]
    deposit_fixtures: list[DepositFixture] = []
    client_fixtures: list[ClientFixture] = []
    cleanup: list[dict[str, object]] = []

    @model_validator(mode="after")
    def complete_lineage(self) -> "Manifest":
        for fixture in [*self.fixtures, *self.deposit_fixtures, *self.client_fixtures]:
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
            values = [value for value in values if value is not None or field != "booking"]
            if len(values) != len(set(values)):
                raise ValueError("duplicate deposit fixture ownership")
        for field in ("client", "customer"):
            values = [
                getattr(fixture, field)
                for fixture in [*self.fixtures, *self.deposit_fixtures, *self.client_fixtures]
            ]
            if len(values) != len(set(values)):
                raise ValueError("invoice, deposit and client fixture ownership overlaps")
        return self


def recovery_credentials(
    mode: str, profile: str, merchants: Path, leased: str | None = None
) -> dict[str, str]:
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
    elif leased is not None:
        env = pair(leased) | {
            "STRIPE_TEST_SECRET_KEY": os.environ.get("STRIPE_TEST_SECRET_KEY", "")
        }
    else:
        raise ValueError("recovery on environment credentials needs the pool pair the run leased")
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
    checked(environment)
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
    owned: list[tuple[stripe.PaymentIntent, dict[str, str], str, str]] = []
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
        if isinstance(fixture, DepositFixture) and fixture.kind == "enrolment":
            expected["clientbridge_qa_enrolment"] = fixture.client
        elif target is not None:
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
            if target is None:
                raise ValueError("an unbound enrolment's customer has an intent; cannot prove it")
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
            owned.append((intent, expected, source, target))
    # Validate every fixture before the first mutation, so conflicting ownership fails closed.
    results = actions if actions is not None else []
    plans = [
        await cleanup_intent(manifest.account, intent, metadata, apply=False)
        for intent, metadata, _, _ in owned
    ]
    run = str(manifest.run_id)
    for purchaser in manifest.client_fixtures:
        plans.extend(
            await clean_client(
                manifest.account,
                run,
                purchaser,
                apply=False,
                environment=environment,
                business=manifest.business,
            )
        )
    if not apply:
        results.extend(plans)
        return results
    for purchaser in manifest.client_fixtures:
        results.extend(
            await clean_client(
                manifest.account,
                run,
                purchaser,
                apply=True,
                environment=environment,
                business=manifest.business,
            )
        )
    for intent, metadata, source, target in owned:
        current = await stripe.PaymentIntent.retrieve_async(
            intent.id, stripe_account=manifest.account
        )
        current_tags = current.to_dict().get("metadata", {})
        if (
            current.id != intent.id
            or current.customer != intent.customer
            or current.amount != intent.amount
            or current.currency != intent.currency
            or current_tags.get(f"{source}_id") != target
            or (source == "booking" and current_tags.get("invoice_id"))
            or current_tags.get("business_id") != manifest.business
        ):
            raise ValueError("owned intent identity changed during recovery")
        results.append(await cleanup_intent(manifest.account, current, metadata))
    return results


async def recover_main(argv: list[str]) -> int:
    """Recover manifest-owned sandbox intents without the disposable app database."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe recover")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--credentials", choices=("local", "environment"), default="local")
    parser.add_argument("--profile", default="clientbridge")
    parser.add_argument(
        "--merchants", type=Path, default=ROOT / ".scratchpad/stripe-local-merchants-ready.json"
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--pair", choices=pairs(), help="the CI pool pair the run leased")
    args = parser.parse_args(argv)
    environment = args.pair or "local"
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
    lease = lease_file(environment, ROOT).open("a")
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
        env = recovery_credentials(args.credentials, args.profile, args.merchants, args.pair)
        actions: list[dict[str, object]] = []
        attempt["actions"] = actions
        await recover(
            manifest,
            env,
            environment,
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
