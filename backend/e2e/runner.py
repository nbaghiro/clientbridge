"""Run functional browsers on the shared test tier, isolated by the run's own namespace."""

import argparse
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
from contextlib import ExitStack, nullcontext
from pathlib import Path
from typing import IO

from clientbridge.core import clock
from e2e import tier
from e2e.builds import ensure_builds, filing_seed_anchor, seed_timestamp, source_snapshot
from e2e.native import build_native, native_ports_free, run_native
from e2e.results import (
    BROWSERS,
    REQUIRED_CASES,
    Report,
    browser_cases,
)
from e2e.shards import (
    case_seconds,
    listed_cases,
    playwright_app,
    playwright_config,
    shard,
    shard_filters,
    shuffled_config,
)
from e2e.stack import Stack, environment, owned_processes, purge
from e2e.tier import ROOT


def prepare() -> None:
    """Seed the snapshot and build the bundles that the lanes after this one reuse."""
    with tier.hold():
        subprocess.run(
            [sys.executable, "-m", "e2e.snapshot", "fresh"],
            cwd=ROOT / "backend",
            env=environment() | tier.environment(),
            check=True,
        )
        for app, path in ensure_builds().items():
            print(f"{app}: {path}", flush=True)


def run_browsers(
    stack: Stack, args: argparse.Namespace, processes: ExitStack, log: IO[bytes]
) -> None:
    stack.start(processes, log)
    stack.use_builds(log)
    if args.surface == "connect":
        stack.env["CONNECT_LINKS"] = subprocess.check_output(
            [sys.executable, "-m", "scripts.connect_links"],
            cwd=ROOT / "backend",
            env=stack.env,
            text=True,
        )
    measuring = args.repeat_each > 1 or args.shuffle_seed is not None
    filters = (
        shard_filters(listed_cases(stack, args), case_seconds(args.surface), args.shard)
        if args.shard
        else []
    )
    if filters:
        (stack.directory / "shard.json").write_text(json.dumps(filters, indent=2) + "\n")
    config = (
        shuffled_config(stack, args, args.shuffle_seed)
        if args.shuffle_seed is not None
        else playwright_config(args.surface)
    )
    command = [
        "pnpm",
        "--filter",
        playwright_app(args.surface),
        "exec",
        "playwright",
        "test",
        f"--config={config}",
        f"--project={args.project}",
        *(["--fully-parallel", f"--repeat-each={args.repeat_each}"] if measuring else []),
        *(filters or args.tests),
    ]
    report_path = stack.directory / "browser-results" / "results.json"
    try:
        with (stack.directory / "browser.log").open("wb") as browser_log:
            stack.command(command, browser_log, frontend=True)
    finally:
        if args.shuffle_seed is not None:
            shutil.rmtree(Path(config).parent)
        if measuring and report_path.is_file():
            outcomes = Report.model_validate_json(report_path.read_text()).first_attempts()
            (stack.directory / "flakes.json").write_text(json.dumps(outcomes, indent=2) + "\n")
    report = Report.model_validate_json(report_path.read_text())
    # a shard holds part of the lane, so CI checks the required cases on the shards merged
    if args.tests or measuring or args.shard or args.project == "pseudo":
        report.validate_evidence([])
    elif args.project in BROWSERS:
        report.validate_evidence([], {args.project: browser_cases(args.surface)[args.project]})
    else:
        report.validate_evidence(REQUIRED_CASES[args.surface])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--configure-only", action="store_true")
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--cleanup")
    parser.add_argument(
        "--surface", choices=("web", "connect", "journeys", "filings", "native"), default="web"
    )
    parser.add_argument("--platform", choices=("ios", "android"))
    parser.add_argument("--device")
    parser.add_argument("--build-native", choices=("ios", "android"))
    parser.add_argument("--seed-as-of", type=seed_timestamp)
    parser.add_argument("--project", choices=("default", "pseudo", *BROWSERS), default="default")
    parser.add_argument("--allow-source-changes", action="store_true")
    parser.add_argument("--repeat-each", type=int, default=1)
    parser.add_argument("--shuffle-seed", type=int)
    parser.add_argument("--shard", type=shard)
    parser.add_argument("tests", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.tests[:1] == ["--"]:
        args.tests = args.tests[1:]
    if args.allow_source_changes and os.environ.get("CI"):
        parser.error("CI cannot accept source changes during a run")
    if args.build_native:
        build_native(args.build_native)
        return
    if args.prepare:
        prepare()
        return
    if args.surface in ("journeys", "filings", "native") and args.project != "default":
        parser.error("journeys, filings and native use the default project")
    if (args.surface == "native") != bool(args.platform and args.device):
        parser.error("the native surface, and only it, takes --platform and --device")
    if args.project in BROWSERS and args.surface not in ("web", "connect"):
        parser.error("only the web and Connect lanes have Firefox and WebKit projects")
    if args.repeat_each < 1:
        parser.error("repeat-each must be at least 1")
    if args.shard and args.surface not in ("web", "connect", "journeys"):
        parser.error("only the web, Connect and journeys lanes split into shards")
    if args.cleanup and args.seed_as_of is not None:
        parser.error("cleanup cannot override a recorded seed date")
    if args.cleanup:
        reap(parser, str(args.cleanup))
        return
    directory = ROOT / ".scratchpad" / f"e2e-{secrets.token_hex(6)}"
    directory.mkdir(parents=True)
    anchor = args.seed_as_of
    if anchor is None and args.surface == "filings":
        anchor = filing_seed_anchor(clock.wall())
    print(f"E2E diagnostics: {directory}", flush=True)
    if args.configure_only:
        return
    record: dict[str, object] = {
        "project": directory.name,
        "started_at": clock.wall().isoformat(),
        "surface": args.surface,
        "seed_as_of": anchor.isoformat() if anchor is not None else None,
        "browser_project": args.project,
        "platform": args.platform,
        "tests": args.tests,
        # a repeated or shuffled run measures flakes; it never qualifies a lane
        "measurement": (
            {"repeat_each": args.repeat_each, "shuffle_seed": args.shuffle_seed}
            if args.repeat_each > 1 or args.shuffle_seed is not None
            else None
        ),
        "source": source_snapshot(),
        "outcome": "running",
        "cleanup": "pending",
        "process_cleanup": "pending",
        "data_cleanup": "pending",
        "allow_source_changes": args.allow_source_changes,
        "worker_heartbeat": "pending",
        "worker_probe": "pending",
        "worker_schedule": "pending",
        "worker_final": "pending",
    }
    metadata = directory / "run.json"
    metadata.write_text(json.dumps(record, indent=2))
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    stack: Stack | None = None
    try:
        with (
            native_ports_free() if args.surface == "native" else nullcontext(),
            tier.hold(),
            tier.lease() as lease,
        ):
            stack = Stack(
                directory,
                lease,
                "pseudo" if args.project == "pseudo" else "default",
                seed_as_of=anchor,
                native=args.platform,
            )
            stack.configure()
            record["namespace"] = lease.namespace
            record["slot"] = lease.slot
            metadata.write_text(json.dumps(record, indent=2))
            try:
                with (
                    owned_processes(record) as processes,
                    (directory / "setup.log").open("wb") as log,
                ):
                    try:
                        (run_native if args.surface == "native" else run_browsers)(
                            stack, args, processes, log
                        )
                    finally:
                        record.update(stack.finish_worker())
                    stack.require_worker()
                    record["outcome"] = "passed"
            finally:
                cleanup(stack, record)
    except BaseException as error:
        if record["outcome"] in ("running", "passed") and not isinstance(error, CleanupFailed):
            record["outcome"] = (
                "interrupted" if isinstance(error, (SystemExit, KeyboardInterrupt)) else "failed"
            )
            record["failure_type"] = type(error).__name__
        raise
    finally:
        if stack is not None:
            record["seeded_as_of"] = stack.seeded_as_of()
        record["finished_at"] = clock.wall().isoformat()
        record["final_source"] = source_snapshot()
        record["source_stable"] = record["source"] == record["final_source"]
        reject_changes = (
            record["outcome"] == "passed"
            and not record["source_stable"]
            and not args.allow_source_changes
        )
        if reject_changes:
            record["outcome"] = "failed"
            record["failure_type"] = "SourceChanged"
        metadata.write_text(json.dumps(record, indent=2))
        if reject_changes:
            raise RuntimeError("source changed during the run; evidence is diagnostic only")


class CleanupFailed(RuntimeError):
    pass


def cleanup(stack: Stack, record: dict[str, object]) -> None:
    """Purge the run's data, and fail a run that passed when its cleanup did not."""
    try:
        stack.cleanup()
        record["data_cleanup"] = "passed"
    except BaseException:
        record["data_cleanup"] = "failed"
        record["cleanup"] = "failed"
        if record["outcome"] == "passed":
            record["outcome"] = "failed"
            record["failure_type"] = "CleanupFailed"
        raise CleanupFailed("the run's data was not purged") from None
    if stack.process_cleanup_failed:
        record["process_cleanup"] = "failed"
    record["cleanup"] = "passed" if record["process_cleanup"] == "passed" else "failed"


def reap(parser: argparse.ArgumentParser, name: str) -> None:
    """Purge what an interrupted run left in the tier, by the namespace it recorded."""
    if not re.fullmatch(r"e2e-[0-9a-f]{12}", name):
        parser.error("cleanup requires the exact generated e2e-<12 hex digits> project name")
    directory = ROOT / ".scratchpad" / name
    if not (directory / "tier.json").is_file():
        parser.error("the recorded run configuration is missing")
    held = json.loads((directory / "tier.json").read_text())
    if tier.namespace_held(held["namespace"]):
        parser.error("that run is still going")
    purge(
        held["namespace"],
        tier.Lease(int(held["slot"]), held["namespace"]).redis_url,
        directory / "purge.json",
    )
    metadata = directory / "run.json"
    if metadata.is_file():
        record = json.loads(metadata.read_text())
        record["data_cleanup"] = "passed"
        process = record.get("process_cleanup")
        provider = record.get("provider_cleanup", "not_started")
        if process == "failed" or provider == "failed":
            record["cleanup"] = "failed"
        elif process == "passed" and provider in ("passed", "not_started"):
            record["cleanup"] = "passed"
        else:
            record["cleanup"] = "incomplete"
        record["reaped_at"] = clock.wall().isoformat()
        if record.get("outcome") == "running":
            record["outcome"] = "interrupted"
        metadata.write_text(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
