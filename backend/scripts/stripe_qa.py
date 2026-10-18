"""Run the isolated Stripe sandbox tier with explicit readiness and no skipped-test success."""

import argparse
import asyncio
import fcntl
import json
import os
import shutil
import subprocess
import sys
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path
from uuid import uuid4

import stripe

from clientbridge.integrations.stripe import StripeGateway, close_stripe_client

REQUIRED = (
    "STRIPE_TEST_SECRET_KEY",
    "STRIPE_TEST_PLATFORM",
    "STRIPE_TEST_CONNECTED_ACCOUNT",
    "STRIPE_TEST_OTHER_ACCOUNT",
)


def environment(profile: str | None) -> dict[str, str]:
    env = dict(os.environ)
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


def results(path: Path) -> dict[str, object]:
    cases = []
    for case in ET.parse(path).iter("testcase"):
        state = "passed"
        if case.find("error") is not None or case.find("failure") is not None:
            state = "failed"
        elif case.find("skipped") is not None:
            state = "skipped"
        cases.append({"test": f"{case.get('classname')}::{case.get('name')}", "status": state})
    return {
        "tests": cases,
        "passed": bool(cases) and all(case["status"] == "passed" for case in cases),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", help="local Stripe CLI profile; forbidden in CI")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument(
        "--output", type=Path, default=Path("../.scratchpad/stripe-qa") / str(uuid4())
    )
    args = parser.parse_args()
    try:
        env = environment(args.profile)
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
    lock_path = Path(__file__).resolve().parents[2] / ".scratchpad/stripe-qa.lock"
    lock_path.parent.mkdir(exist_ok=True)
    with lock_path.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another local Stripe QA run holds the merchant lease", file=sys.stderr)
            return 1
        junit = output / "junit.xml"
        junit.unlink(missing_ok=True)
        (output / "results.json").unlink(missing_ok=True)
        command = [
            sys.executable,
            "-m",
            "scripts.fresh_database",
            sys.executable,
            "-m",
            "pytest",
            "tests/e2e/test_stripe_e2e.py",
            "tests/e2e/test_payments_e2e.py",
            "-m",
            "e2e",
            "-q",
            "--tb=short",
            f"--junitxml={junit}",
        ]
        completed = subprocess.run(command, env=env, check=False)
        report: dict[str, object] = (
            results(junit) if junit.exists() else {"tests": [], "passed": False}
        )
        report["commit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
        return 0 if completed.returncode == 0 and report["passed"] is True else 1


if __name__ == "__main__":
    sys.exit(main())
