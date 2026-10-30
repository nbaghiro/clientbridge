"""Run the isolated Stripe sandbox tier with explicit readiness and no skipped-test success."""

import argparse
import asyncio
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path
from uuid import uuid4

import stripe
from e2e import stripe_shapes
from e2e.stripe_pool import lease_file, pair, pairs

from clientbridge.integrations.stripe import StripeGateway, close_stripe_client

REQUIRED = (
    "STRIPE_TEST_SECRET_KEY",
    "STRIPE_TEST_PLATFORM",
    "STRIPE_TEST_CONNECTED_ACCOUNT",
    "STRIPE_TEST_OTHER_ACCOUNT",
)


def environment(profile: str | None, leased: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ) | (leased or {})
    if profile:
        if env.get("CI"):
            raise ValueError("CI must use protected environment credentials, not a CLI profile")
        config = tomllib.loads((Path.home() / ".config/stripe/config.toml").read_text())
        section = config.get(profile, {})
        key = section.get("test_mode_api_key")
        if not isinstance(key, str):
            raise ValueError("selected Stripe CLI profile has no test key")
        env["STRIPE_TEST_SECRET_KEY"] = key
    missing = [name for name in REQUIRED if not env.get(name)]
    if missing:
        raise ValueError(f"missing sandbox prerequisites: {', '.join(missing)}")
    if not env["STRIPE_TEST_SECRET_KEY"].startswith(("sk_test_", "rk_test_")):
        raise ValueError("only Stripe test-mode keys are accepted")
    if env["STRIPE_TEST_CONNECTED_ACCOUNT"] == env["STRIPE_TEST_OTHER_ACCOUNT"]:
        raise ValueError("QA requires two distinct connected accounts")
    env["STRIPE_E2E_REQUIRED"] = "1"
    return env


async def preflight(env: dict[str, str]) -> None:
    StripeGateway(env["STRIPE_TEST_SECRET_KEY"], "", "CA")
    try:
        platform = await stripe.Account.retrieve_async()
        if platform.id != env["STRIPE_TEST_PLATFORM"]:
            raise ValueError("unexpected Stripe platform")
        if (await stripe.Balance.retrieve_async()).livemode:
            raise ValueError("live Stripe mode is forbidden in QA")
        for name in ("STRIPE_TEST_CONNECTED_ACCOUNT", "STRIPE_TEST_OTHER_ACCOUNT"):
            account = await stripe.Account.retrieve_async(env[name])
            metadata = account.to_dict().get("metadata")
            if not isinstance(metadata, dict) or metadata.get("clientbridge_qa") != "payments":
                raise ValueError(f"{name} is not reserved for payments QA")
            if not account.charges_enabled or not account.payouts_enabled:
                raise ValueError(f"{name} must finish onboarding before running payments QA")
            if account.default_currency != "cad":
                raise ValueError(f"{name} must settle in CAD")
            if (await stripe.Balance.retrieve_async(stripe_account=env[name])).livemode:
                raise ValueError("live connected account is forbidden in QA")
    finally:
        await close_stripe_client()


RATE_LIMITED = re.compile(r"RateLimitError|rate_limit|\b429\b")
STRIPE_DOWN = re.compile(
    r"APIConnectionError|Request req_\w+: .*\b50[0-4]\b|api_error|status(?:_code)?[=: ]+50[0-4]"
)


def cause(detail: str) -> str:
    """Whose problem a failure is, so a red run names Stripe apart from our code."""
    if RATE_LIMITED.search(detail):
        return "stripe_rate_limit"
    if STRIPE_DOWN.search(detail):
        return "stripe_outage"
    return "test"


def cases_in(path: Path) -> list[dict[str, str]]:
    cases: list[dict[str, str]] = []
    for case in ET.parse(path).iter("testcase"):
        entry = {"test": f"{case.get('classname')}::{case.get('name')}", "status": "passed"}
        failure = case.find("error")
        if failure is None:
            failure = case.find("failure")
        if failure is not None:
            entry["status"] = "failed"
            entry["cause"] = cause(f"{failure.get('message', '')}\n{failure.text or ''}")
        elif case.find("skipped") is not None:
            entry["status"] = "skipped"
        cases.append(entry)
    return cases


def summary(cases: list[dict[str, str]]) -> dict[str, object]:
    return {
        "tests": cases,
        "passed": bool(cases) and all(case["status"] == "passed" for case in cases),
    }


def results(path: Path) -> dict[str, object]:
    return summary(cases_in(path))


TITLES = {"stripe_rate_limit": "Stripe rate limit", "stripe_outage": "Stripe outage"}


def annotate(cases: list[dict[str, str]]) -> None:
    for case in cases:
        if case["status"] == "failed":
            print(f"::error title={TITLES.get(case['cause'], 'Test failure')}::{case['test']}")


def drift(fresh: Path, committed: Path = stripe_shapes.RECORDINGS) -> list[str]:
    """What the committed recordings have that the events received in this run no longer show."""
    problems: list[str] = []
    for path in sorted(committed.glob("*.json")):
        found = stripe_shapes.recorded(path.stem, fresh)
        # a scenario that expected the event already failed waiting for it
        if found is None:
            continue
        expected = stripe_shapes.recorded(path.stem, committed)
        assert expected is not None
        problems.extend(
            f"{path.stem}{problem}" for problem in stripe_shapes.removed(expected, found)
        )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", help="local Stripe CLI profile; forbidden in CI")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--pair", choices=pairs(), help="lease a CI pool pair")
    parser.add_argument(
        "--record",
        choices=("check", "update"),
        help="record real event shapes and check them against, or update, the committed ones",
    )
    parser.add_argument(
        "--output", type=Path, default=Path("../.scratchpad/stripe-qa") / str(uuid4())
    )
    args = parser.parse_args()
    try:
        if os.environ.get("CI") and args.pair is None:
            raise ValueError("a hosted run leases a pool pair with --pair")
        env = environment(args.profile, pair(args.pair) if args.pair else {})
        if shutil.which("stripe") is None:
            raise ValueError("Stripe CLI is required for signed webhook forwarding")
        asyncio.run(preflight(env))
    except (ValueError, OSError) as exc:
        print(f"Stripe QA preflight failed: {exc}", file=sys.stderr)
        return 1
    except stripe.StripeError:
        print(
            "Stripe QA preflight failed: provider rejected the readiness request", file=sys.stderr
        )
        return 1
    if args.preflight:
        print("Stripe QA prerequisites passed")
        return 0
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    lock_path = lease_file(args.pair or "local")
    lock_path.parent.mkdir(exist_ok=True)
    with lock_path.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another local Stripe QA run holds the merchant lease", file=sys.stderr)
            return 1
        junit = output / "junit.xml"
        junit.unlink(missing_ok=True)
        recording = output / "stripe_events"
        shutil.rmtree(recording, ignore_errors=True)
        if args.record:
            env["STRIPE_RECORD_EVENTS"] = str(recording)
        (output / "results.json").unlink(missing_ok=True)
        command = [
            sys.executable,
            "-m",
            "e2e.database",
            sys.executable,
            "-m",
            "pytest",
            "tests/sandbox/test_stripe_sandbox.py",
            "tests/sandbox/test_payments_sandbox.py",
            "tests/sandbox/test_payments_sandbox_disputes.py",
            "tests/sandbox/test_payments_sandbox_payouts.py",
            "-m",
            "sandbox",
            "-q",
            "--tb=short",
            f"--junitxml={junit}",
        ]
        completed = subprocess.run(command, env=env, check=False)
        cases = cases_in(junit) if junit.exists() else []
        if os.environ.get("GITHUB_ACTIONS"):
            annotate(cases)
        report: dict[str, object] = summary(cases)
        report["commit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        if args.record == "update":
            stripe_shapes.RECORDINGS.mkdir(exist_ok=True)
            for path in recording.glob("*.json"):
                shutil.copy(path, stripe_shapes.RECORDINGS / path.name)
        elif args.record == "check":
            report["drift"] = drift(recording)
            for problem in report["drift"]:
                print(f"::error title=Stripe event drift::{problem}")
        (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
        passed = completed.returncode == 0 and report["passed"] is True
        return 0 if passed and not report.get("drift") else 1


if __name__ == "__main__":
    sys.exit(main())
