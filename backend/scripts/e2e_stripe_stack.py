"""Run isolated Stripe.js checkout with signed provider events and owned-fixture cleanup."""

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
from contextlib import ExitStack
from pathlib import Path
from uuid import uuid4

from dotenv import dotenv_values

from clientbridge.core import clock
from clientbridge.integrations.stripe import STRIPE_API_VERSION
from scripts.e2e_results import REQUIRED_CASES, Report, browser_cases
from scripts.e2e_stack import ROOT, Stack, owned_processes, source_snapshot, stack_slot, stop
from scripts.e2e_stripe_relay import Relay
from scripts.stripe_qa import environment, preflight


def credentials(profile: str, merchants: Path, publishable_file: Path, mode: str) -> dict[str, str]:
    if mode == "environment":
        supplied = environment(None)
        publishable = supplied.get("VITE_STRIPE_PUBLISHABLE_KEY", "")
        if not publishable.startswith("pk_test_"):
            raise ValueError("protected environment requires a test publishable key")
        env = {
            name: supplied[name]
            for name in (
                "STRIPE_TEST_SECRET_KEY",
                "STRIPE_TEST_PLATFORM",
                "STRIPE_TEST_CONNECTED_ACCOUNT",
                "STRIPE_TEST_OTHER_ACCOUNT",
                "VITE_STRIPE_PUBLISHABLE_KEY",
            )
        }
        env["STRIPE_SECRET_KEY"] = env["STRIPE_TEST_SECRET_KEY"]
        env["STRIPE_BROWSER_ENVIRONMENT"] = "ci"
        asyncio.run(preflight(env))
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
    publishable = dotenv_values(publishable_file).get("VITE_STRIPE_PUBLISHABLE_KEY")
    if not publishable or not publishable.startswith("pk_test_"):
        raise ValueError("Connect environment file must contain a test publishable key")
    env = {
        "STRIPE_BROWSER_ENVIRONMENT": "local",
        "STRIPE_SECRET_KEY": key,
        "STRIPE_TEST_SECRET_KEY": key,
        "VITE_STRIPE_PUBLISHABLE_KEY": publishable,
        **{
            name: saved[name]
            for name in (
                "STRIPE_TEST_PLATFORM",
                "STRIPE_TEST_CONNECTED_ACCOUNT",
                "STRIPE_TEST_OTHER_ACCOUNT",
            )
        },
    }
    asyncio.run(preflight(env))
    return env


def listener(stack: Stack, processes: ExitStack) -> str:
    process = subprocess.Popen(
        [
            "stripe",
            "listen",
            "--latest",
            "--events-from",
            "@accounts",
            "--events",
            "payment_intent.succeeded,payment_intent.payment_failed,refund.created,refund.updated",
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
                            [sys.executable, "-m", "scripts.e2e_stripe_delivery", event_id],
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


def run(args: argparse.Namespace, directory: Path) -> None:
    stack = Stack(directory)
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
        "source": source_snapshot(),
        "outcome": "running",
        "provider_cleanup": "not_started",
        "allow_source_changes": args.allow_source_changes,
        "cleanup": "pending",
        "docker_cleanup": "pending",
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
                stack.command([sys.executable, "-m", "scripts.e2e_stripe_delivery", event_id], log)

            def before_api() -> None:
                nonlocal prepared, relay
                stack.env.update(
                    credentials(
                        args.profile, args.merchants, args.publishable_file, args.credentials
                    )
                )
                stack.env.update(
                    {
                        "STRIPE_BROWSER_E2E": "1",
                        "STRIPE_BROWSER_ACTIVATION": args.activation,
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
                stack.command([sys.executable, "-m", "scripts.e2e_stripe_setup", "prepare"], log)
                prepared = True
                record["provider_cleanup"] = "pending"

            try:
                try:
                    stack.start(processes, log, before_api=before_api, browser_fixtures=False)
                    with (directory / "browser.log").open("wb") as browser_log:
                        stack.command(
                            [
                                "pnpm",
                                "--filter",
                                "connect",
                                "exec",
                                "playwright",
                                "test",
                                "--config=playwright.stripe.config.ts",
                            ],
                            browser_log,
                            frontend=True,
                        )
                    report = directory / "browser-results" / "results.json"
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
                                [sys.executable, "-m", "scripts.e2e_stripe_setup", "cleanup"], log
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
            record["docker_cleanup"] = "passed"
        except BaseException:
            record["docker_cleanup"] = "failed"
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
                if record["docker_cleanup"] == "passed"
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
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
    args = parser.parse_args()
    if args.allow_source_changes and os.environ.get("CI"):
        parser.error("CI cannot accept source changes")
    if args.activation != "pointer" and os.environ.get("CI"):
        parser.error("CI requires the pointer checkout journey")
    directory = ROOT / ".scratchpad" / f"e2e-{secrets.token_hex(6)}"
    directory.mkdir(parents=True)
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    try:
        with (ROOT / ".scratchpad/stripe-qa.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("another provider run holds the merchant lease") from None
            with stack_slot():
                run(args, directory)
    except BaseException as error:
        print(f"Stripe browser run did not complete: {type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
