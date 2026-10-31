"""The Stripe provider lane: its commands and the runner that drives the browser cases."""

import argparse
import asyncio
import fcntl
import json
import os
import queue
import re
import secrets
import signal
import subprocess
import sys
import threading
import tomllib
import traceback
from collections.abc import Callable
from contextlib import ExitStack
from pathlib import Path
from uuid import uuid4

from dotenv import dotenv_values
from scripts.stripe_qa import environment, preflight

from clientbridge.core import clock
from clientbridge.integrations.stripe import (
    PAYMENT_EVENTS,
    STRIPE_API_VERSION,
)
from e2e import tier
from e2e.builds import source_snapshot
from e2e.results import REQUIRED_CASES, Report, browser_cases
from e2e.shards import case_seconds, listed_cases, shard, shard_filters
from e2e.stack import Stack, owned_processes, stop
from e2e.stripe_clients import clients_main
from e2e.stripe_deposits import deposits_evidence_main, deposits_main
from e2e.stripe_disputes import disputes_main
from e2e.stripe_evidence import browser_main
from e2e.stripe_fixtures import setup_main
from e2e.stripe_pool import lease_file, pair, pairs
from e2e.stripe_reconcile import plan_main, reconcile_main
from e2e.stripe_recovery import recover_main
from e2e.stripe_relay import Relay, delivery_main
from e2e.tier import ROOT


def stack_credentials(
    profile: str, merchants: Path, publishable_file: Path, mode: str, leased: str | None = None
) -> dict[str, str]:
    if mode == "environment" and leased is None:
        raise ValueError("a run on environment credentials leases a pool pair with --pair")
    env = _credentials(profile, merchants, publishable_file, mode, leased)
    if leased is not None:
        env |= pair(leased)
        env["STRIPE_BROWSER_ENVIRONMENT"] = leased
    asyncio.run(preflight(env))
    return env


def _credentials(
    profile: str, merchants: Path, publishable_file: Path, mode: str, leased: str | None
) -> dict[str, str]:
    if mode == "environment" and leased is not None:
        supplied = environment(None, pair(leased))
        publishable = supplied.get("STRIPE_PUBLISHABLE_KEY", "")
        if not publishable.startswith("pk_test_"):
            raise ValueError("protected environment requires a test publishable key")
        env = {
            name: supplied[name]
            for name in (
                "STRIPE_TEST_SECRET_KEY",
                "STRIPE_TEST_PLATFORM",
                "STRIPE_TEST_CONNECTED_ACCOUNT",
                "STRIPE_TEST_OTHER_ACCOUNT",
                "STRIPE_PUBLISHABLE_KEY",
            )
        }
        env["STRIPE_SECRET_KEY"] = env["STRIPE_TEST_SECRET_KEY"]
        return env
    if os.environ.get("CI"):
        raise ValueError("local CLI profile onboarding credentials are forbidden in CI")
    selected = tomllib.loads((Path.home() / ".config/stripe/config.toml").read_text())[profile]
    key = selected.get("test_mode_api_key", "")
    if (
        not key.startswith(("sk_test_", "rk_test_"))
        or "clientbridge" not in selected.get("display_name", "").lower()
    ):
        raise ValueError("requires an explicitly named Clientbridge test profile")
    saved = json.loads(merchants.read_text())
    if saved["STRIPE_TEST_PLATFORM"] != selected["account_id"]:
        raise ValueError("merchant manifest and profile platform differ")
    publishable = dotenv_values(publishable_file).get("STRIPE_PUBLISHABLE_KEY")
    if not publishable or not publishable.startswith("pk_test_"):
        raise ValueError("Connect environment file must contain a test publishable key")
    env = {
        "STRIPE_BROWSER_ENVIRONMENT": "local",
        "STRIPE_SECRET_KEY": key,
        "STRIPE_TEST_SECRET_KEY": key,
        "STRIPE_PUBLISHABLE_KEY": publishable,
        **{
            name: saved[name]
            for name in (
                "STRIPE_TEST_PLATFORM",
                "STRIPE_TEST_CONNECTED_ACCOUNT",
                "STRIPE_TEST_OTHER_ACCOUNT",
            )
        },
    }
    return env


RECONCILIATION = "reconciliation.stripe.ts"


def reconciliation_results(directory: Path) -> Path:
    return directory / "browser-results" / "reconciliation"


def shard_cases(stack: Stack, part: str) -> list[str]:
    """This shard's cases; reconciliation runs after them on its own, so it isn't one of them."""
    listing = argparse.Namespace(surface="stripe", project=None, tests=[])
    cases = [case for case in listed_cases(stack, listing) if case.file != RECONCILIATION]
    return shard_filters(cases, case_seconds("stripe"), part, "e2e/stripe", workers=1)


def listener(stack: Stack, processes: ExitStack) -> str:
    # no --latest: events must render at the sandbox default, the version the webhook pins
    process = subprocess.Popen(
        [
            "stripe",
            "listen",
            "--events-from",
            "@accounts",
            "--events",
            ",".join(PAYMENT_EVENTS),
            "--forward-to",
            stack.env.get("STRIPE_BROWSER_RELAY_URL", stack.api + "/webhooks/stripe")
            + ("/webhook" if "STRIPE_BROWSER_RELAY_URL" in stack.env else ""),
            "--skip-update",
            "--color",
            "off",
        ],
        env={**stack.env, "STRIPE_API_KEY": stack.env["STRIPE_TEST_SECRET_KEY"]},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    startup: queue.Queue[tuple[str, str]] = queue.Queue()
    deliveries: list[dict[str, object]] = []
    retries: dict[str, int] = {}
    stopping = threading.Event()
    cleanup_errors: list[BaseException] = []
    delivery_path = Path(stack.env["STRIPE_BROWSER_STATE_FILE"]).parent / "stripe-deliveries.json"

    def drain() -> None:
        if process.stdout is None:
            return
        for line in iter(process.stdout.readline, b""):
            secret = re.search(rb"whsec_[A-Za-z0-9]+", line)
            version = re.search(rb"\d{4}-\d{2}-\d{2}\.[a-z]+", line)
            if secret:
                startup.put(("secret", secret[0].decode()))
            if version:
                startup.put(("version", version[0].decode()))
            event = re.search(rb"\bevt_[A-Za-z0-9]+", line)
            status = re.search(rb"\[(\d{3})\]", line)
            if event and status:
                event_id, response = event[0].decode(), int(status[1])
                delivery: dict[str, object] = {"event": event_id, "status": response}
                deliveries.append(delivery)
                attempt = retries.get(event_id, 0)
                if response == 503 and attempt < 3:
                    retries[event_id] = attempt + 1
                    delivery["resend_attempt"] = attempt + 1
                    try:
                        if stopping.wait(2 * (attempt + 1)):
                            break
                        child = subprocess.Popen(
                            [sys.executable, "-m", "e2e.stripe", "delivery", event_id],
                            env=stack.env,
                            cwd=ROOT / "backend",
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            start_new_session=True,
                        )
                        try:
                            if child.wait(timeout=30) != 0:
                                raise subprocess.CalledProcessError(child.returncode, child.args)
                        finally:
                            try:
                                stop(child, grace_seconds=1)
                            except BaseException as error:
                                cleanup_errors.append(error)
                                raise
                        delivery["resend"] = "requested_from_stripe"
                    except (subprocess.SubprocessError, OSError):
                        delivery["resend"] = "failed"
                delivery_path.write_text(json.dumps(deliveries, indent=2) + "\n")
        startup.put(("exit", ""))

    thread = threading.Thread(target=drain, daemon=True)

    def finish() -> None:
        stopping.set()
        stop(process)
        thread.join(40)
        if thread.is_alive():
            raise RuntimeError("Stripe delivery worker did not stop")
        if cleanup_errors:
            raise RuntimeError("Stripe resend process cleanup failed") from cleanup_errors[0]

    processes.callback(finish)
    thread.start()
    found: dict[str, str] = {}
    while not {"secret", "version"}.issubset(found):
        try:
            kind, value = startup.get(timeout=30)
        except queue.Empty:
            raise RuntimeError(
                "Stripe listener did not confirm signing secret and API version"
            ) from None
        if kind == "exit":
            raise RuntimeError("Stripe listener exited before readiness")
        found[kind] = value
    if found["version"] != STRIPE_API_VERSION:
        raise RuntimeError("Stripe listener API version does not match the application")
    return found["secret"]


def run_lane(args: argparse.Namespace, directory: Path, lease: tier.Lease) -> None:
    stack = Stack(directory, lease)
    stack.configure()
    print(f"Stripe browser diagnostics: {directory}", flush=True)
    if args.configure_only:
        return
    record: dict[str, object] = {
        "project": stack.project,
        "started_at": clock.wall().isoformat(),
        "surface": "connect-stripe",
        "credentials_mode": args.credentials,
        "activation": args.activation,
        "payout_case": args.payout_case,
        "source": source_snapshot(),
        "outcome": "running",
        "provider_cleanup": "not_started",
        "allow_source_changes": args.allow_source_changes,
        "cleanup": "pending",
        "data_cleanup": "pending",
        "process_cleanup": "pending",
        **stack.worker_checks,
    }
    metadata = directory / "run.json"
    metadata.write_text(json.dumps(record, indent=2))
    try:
        with owned_processes(record) as processes, (directory / "setup.log").open("wb") as log:
            prepared = False
            relay: Relay | None = None

            def resend(event_id: str) -> None:
                stack.command([sys.executable, "-m", "e2e.stripe", "delivery", event_id], log)

            def before_api() -> None:
                nonlocal prepared, relay
                stack.env.update(
                    stack_credentials(
                        args.profile,
                        args.merchants,
                        args.publishable_file,
                        args.credentials,
                        args.pair,
                    )
                )
                stack.env.update(
                    {
                        "STRIPE_BROWSER_E2E": "1",
                        "STRIPE_BROWSER_ACTIVATION": args.activation,
                        "STRIPE_PAYOUT_CASE": "1" if args.payout_case else "",
                        "STRIPE_BROWSER_RUN_ID": str(uuid4()),
                        "STRIPE_BROWSER_STATE_FILE": str(directory / "stripe-fixtures.json"),
                    }
                )
                relay = Relay(directory / "stripe-fixtures.json", f"{stack.api}/webhooks/stripe")
                stack.env["STRIPE_BROWSER_RELAY_URL"] = relay.start()
                stack.env["STRIPE_BROWSER_RELAY_TOKEN"] = relay.token
                processes.callback(relay.close)
                stack.env["STRIPE_WEBHOOK_SECRET"] = listener(stack, processes)
                relay.secret = stack.env["STRIPE_WEBHOOK_SECRET"]

                def recover_held() -> None:
                    if relay is not None:
                        relay.recover(resend)

                processes.callback(recover_held)
                record["listener_api_version"] = STRIPE_API_VERSION
                stack.command([sys.executable, "-m", "e2e.stripe", "setup", "prepare"], log)
                prepared = True
                record["provider_cleanup"] = "pending"

            try:
                try:
                    stack.start(processes, log, before_api=before_api, browser_fixtures=False)
                    stack.use_builds(log)
                    tests = args.tests
                    if args.shard:
                        tests = shard_cases(stack, args.shard)
                        (directory / "shard.json").write_text(json.dumps(tests, indent=2) + "\n")
                    playwright = [
                        "pnpm",
                        "--filter",
                        "connect",
                        "exec",
                        "playwright",
                        "test",
                        "--config=playwright.stripe.config.ts",
                    ]
                    with (directory / "browser.log").open("wb") as browser_log:
                        stack.command([*playwright, *tests], browser_log, frontend=True)
                        if args.shard:
                            # through its project dependencies it would rerun the whole lane
                            stack.env["E2E_OUTPUT_DIR"] = str(reconciliation_results(directory))
                            stack.command(
                                [*playwright, "--project=reconciliation", "--no-deps"],
                                browser_log,
                                frontend=True,
                            )
                    report = directory / "browser-results" / "results.json"
                    # a shard holds part of the lane, so CI requires the cases on the shards merged
                    if args.tests or args.shard:
                        Report.model_validate_json(report.read_text()).validate_evidence([])
                    if args.shard:
                        reconciled = reconciliation_results(directory) / "results.json"
                        Report.model_validate_json(reconciled.read_text()).validate_evidence([])
                    else:
                        Report.model_validate_json(report.read_text()).validate_evidence(
                            REQUIRED_CASES["stripe"], browser_cases("stripe")
                        )
                finally:
                    record.update(stack.finish_worker())
                stack.require_worker()
                record["outcome"] = "passed"
            finally:
                if prepared:
                    try:
                        if relay is not None:
                            relay.recover(resend)
                    finally:
                        try:
                            stack.command(
                                [sys.executable, "-m", "e2e.stripe", "setup", "cleanup"], log
                            )
                            record["provider_cleanup"] = "passed"
                        except BaseException:
                            record["provider_cleanup"] = "failed"
                            raise
    except BaseException as error:
        record["outcome"] = (
            "interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed"
        )
        record["failure_type"] = type(error).__name__
        record["failure_frames"] = [
            {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
            for frame in traceback.extract_tb(error.__traceback__)
        ]
        raise
    finally:
        try:
            stack.cleanup()
            record["data_cleanup"] = "passed"
        except BaseException:
            record["data_cleanup"] = "failed"
            record["cleanup"] = "failed"
            if record["outcome"] == "passed":
                record["outcome"] = "failed"
                record["failure_type"] = "CleanupFailed"
            raise
        finally:
            if stack.process_cleanup_failed:
                record["process_cleanup"] = "failed"
            record["cleanup"] = (
                "passed"
                if record["data_cleanup"] == "passed"
                and record["process_cleanup"] == "passed"
                and record["provider_cleanup"] in ("passed", "not_started")
                else "failed"
            )
            record["finished_at"] = clock.wall().isoformat()
            record["final_source"] = source_snapshot()
            record["source_stable"] = record["source"] == record["final_source"]
            changed = not record["source_stable"] and not args.allow_source_changes
            if changed:
                record["outcome"] = "failed"
                record["source_validation"] = "failed"
            metadata.write_text(json.dumps(record, indent=2))
            if changed:
                raise RuntimeError("source changed during provider run; evidence is not qualified")


def stack_main(argv: list[str]) -> int:
    """Run Stripe.js checkout with signed provider events and owned-fixture cleanup."""
    parser = argparse.ArgumentParser(prog="python -m e2e.stripe stack")
    parser.add_argument("--profile", default="clientbridge")
    parser.add_argument("--credentials", choices=("local", "environment"), default="local")
    parser.add_argument(
        "--merchants", type=Path, default=ROOT / ".scratchpad/stripe-local-merchants-ready.json"
    )
    parser.add_argument(
        "--publishable-file", type=Path, default=ROOT / "frontend/apps/connect/.env"
    )
    parser.add_argument("--configure-only", action="store_true")
    parser.add_argument("--activation", choices=("pointer", "keyboard"), default="pointer")
    parser.add_argument("--allow-source-changes", action="store_true")
    # pays out of slot a's available balance, which cleanup refunds and lost disputes can drain
    parser.add_argument("--payout-case", action="store_true")
    parser.add_argument("--pair", choices=pairs(), help="lease a CI pool pair instead")
    parser.add_argument("--shard", type=shard, help="run one part of the lane, as <index>/<total>")
    parser.add_argument("tests", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.tests[:1] == ["--"]:
        args.tests = args.tests[1:]
    if args.shard and args.tests:
        parser.error("a shard picks its own cases")
    if args.credentials == "environment" and args.pair is None:
        parser.error("environment credentials lease a pool pair with --pair")
    if args.allow_source_changes and os.environ.get("CI"):
        parser.error("CI cannot accept source changes")
    if args.activation != "pointer" and os.environ.get("CI"):
        parser.error("CI requires the pointer checkout journey")
    directory = ROOT / ".scratchpad" / f"e2e-{secrets.token_hex(6)}"
    directory.mkdir(parents=True)
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    try:
        with lease_file(args.pair or "local", ROOT).open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("another provider run holds the merchant lease") from None
            with tier.hold(), tier.lease() as lease:
                run_lane(args, directory, lease)
    except BaseException as error:
        print(f"Stripe browser run did not complete: {type(error).__name__}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(f"failed command: {' '.join(map(str, error.cmd))}", file=sys.stderr)
            if error.stderr:
                print(error.stderr, file=sys.stderr)
        return 1
    return 0


COMMANDS: dict[str, Callable[[list[str]], int | None]] = {
    "browser": lambda argv: asyncio.run(browser_main(argv)),
    "setup": lambda argv: asyncio.run(setup_main(argv)),
    "deposits": lambda argv: asyncio.run(deposits_main(argv)),
    "deposits-evidence": lambda argv: asyncio.run(deposits_evidence_main(argv)),
    "delivery": lambda argv: asyncio.run(delivery_main(argv)),
    "recover": lambda argv: asyncio.run(recover_main(argv)),
    "clients": lambda argv: asyncio.run(clients_main(argv)),
    "disputes": lambda argv: asyncio.run(disputes_main(argv)),
    "reconcile": lambda argv: asyncio.run(reconcile_main(argv)),
    "plan": lambda argv: asyncio.run(plan_main(argv)),
    "stack": stack_main,
}


def main() -> int | None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        raise SystemExit(f"usage: python -m e2e.stripe {{{','.join(COMMANDS)}}} ...")
    return COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    sys.exit(main())
