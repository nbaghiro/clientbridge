"""Run functional browsers on the shared test tier, isolated by the run's own namespace."""

import argparse
import asyncio
import base64
import fcntl
import hashlib
import json
import os
import random
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Coroutine, Iterator
from contextlib import ExitStack, contextmanager, nullcontext, suppress
from datetime import datetime
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import IO, Literal, cast

import httpx
from arq.connections import RedisSettings, create_pool

from clientbridge.core import clock
from clientbridge.core.config import Settings
from clientbridge.core.zones import zone
from e2e import tier
from e2e.results import (
    BROWSERS,
    REQUIRED_CASES,
    Report,
    Spec,
    browser_cases,
    validate_native_evidence,
)

ROOT = Path(__file__).resolve().parents[2]
WORKER_SETTINGS = "clientbridge.tasks.worker.WorkerSettings"
PROBE_JOB = "prune_receipts"
PLATFORM_OPERATORS = ("console", "lapse")
COMPLETED_JOB = re.compile(r"← cron:(\w+) ●")
FAILED_JOB = re.compile(r"! cron:(\w+) failed")
# Mailpit refuses only the reserved .invalid domain, so a case can meet a real provider refusal
_INVALID = "invalid"
DELIVERABLE = "(?i)^(?:[^@]*@[^.]*|.+\\.(?:{}))$".format(
    "|".join(
        [f"{_INVALID[:i]}[^{_INVALID[i]}.][^.]*" for i in range(len(_INVALID))]
        + [f"{_INVALID}[^.]+"]
        + [_INVALID[:i] for i in range(1, len(_INVALID))]
    )
)


def seed_timestamp(value: str) -> datetime:
    """An explicit seed instant must identify its UTC offset, never local machine time."""
    try:
        at = datetime.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "seed-as-of must be an ISO datetime with UTC offset"
        ) from error
    if at.utcoffset() is None:
        raise argparse.ArgumentTypeError("seed-as-of must include a UTC offset")
    return at


def filing_seed_anchor(now: datetime) -> datetime:
    """Seed at local quarter opening, leaving the preceding closed quarter unfiled."""
    if now.utcoffset() is None:
        raise ValueError("the current instant must include a UTC offset")
    local = now.astimezone(zone("America/Vancouver"))
    return local.replace(
        month=((local.month - 1) // 3) * 3 + 1, day=1, hour=12, minute=0, second=0, microsecond=0
    )


def source_snapshot() -> dict[str, object]:
    digest = hashlib.sha256()
    paths = (
        subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
        )
        .decode()
        .split("\0")
    )
    for name in sorted(set(paths)):
        path = ROOT / name
        if not name or not path.is_file() or name.startswith(".docs/"):
            continue
        digest.update(name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return {
        "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT)
        .decode()
        .strip(),
        "source_sha256": digest.hexdigest(),
        "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)),
    }


BUNDLES = ("web", "connect", "admin")
BUILDS = tier.TIER / "builds"
KEPT_BUILDS = 3


def bundle_sources() -> str:
    """What the web, Connect and admin bundles are built from, leaving out tests and other apps."""
    names = (
        subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "frontend"],
            cwd=ROOT,
        )
        .decode()
        .split("\0")
    )
    digest = hashlib.sha256()
    for name in sorted(set(names)):
        path = ROOT / name
        skipped = (
            name.startswith(("frontend/apps/mobile/", "frontend/apps/site/"))
            or "/e2e/" in name
            or ".test." in path.name
            or path.name.startswith("playwright.")
        )
        if not name or skipped or not path.is_file():
            continue
        digest.update(name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()[:16]


def ensure_builds(log: IO[bytes] | None = None) -> dict[str, Path]:
    """One production build per app and source fingerprint, which every lane previews."""
    BUILDS.mkdir(parents=True, exist_ok=True)
    key = bundle_sources()
    built: dict[str, Path] = {}
    with (BUILDS / "builds.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for app in BUNDLES:
            target = BUILDS / f"{app}-{key}"
            if not (target / "index.html").is_file():
                partial = BUILDS / f"{app}-{key}.partial"
                shutil.rmtree(partial, ignore_errors=True)
                subprocess.run(
                    ["pnpm", "--filter", app, "exec", "vite", "build", "--outDir", str(partial)],
                    cwd=ROOT / "frontend",
                    stdout=log or sys.stderr,
                    stderr=subprocess.STDOUT,
                    check=True,
                )
                shutil.rmtree(target, ignore_errors=True)
                partial.rename(target)
            built[app] = target
            older = sorted(
                (found for found in BUILDS.glob(f"{app}-*") if found != target),
                key=lambda found: found.stat().st_mtime,
                reverse=True,
            )
            for stale in older[KEPT_BUILDS - 1 :]:
                shutil.rmtree(stale, ignore_errors=True)
    return built


def prepare() -> None:
    """Seed the snapshot and build the bundles that the lanes after this one reuse."""
    with tier.hold():
        subprocess.run(
            [sys.executable, "-m", "e2e.snapshot"],
            cwd=ROOT / "backend",
            env=environment() | tier.environment(),
            check=True,
        )
        for app, path in ensure_builds().items():
            print(f"{app}: {path}", flush=True)


MOBILE = ROOT / "frontend" / "apps" / "mobile"
NATIVE_APP_ID = "ca.clientbridge.app.e2e"
# the e2e build has these hosts compiled in; the lane forwards them to the run's services
NATIVE_PORTS = {"api": 8794, "auth": 8795, "powersync": 8796}
# Maestro's own port to its device driver, fixed where a random pick can't meet an emulator socket
DRIVER_PORT = 8797
NATIVE_BUILDS = {
    "ios": ROOT / ".scratchpad" / "native" / "ClientbridgeE2E.app",
    "android": ROOT / ".scratchpad" / "native" / "clientbridge-e2e.apk",
}
ANDROID_HOME = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library/Android/sdk"))
ADB = ANDROID_HOME / "platform-tools" / "adb"


def native_urls(platform: str) -> dict[str, str]:
    """What the e2e build compiles in; the emulator reaches the host at 10.0.2.2 unforwarded."""
    host = "10.0.2.2" if platform == "android" else "127.0.0.1"
    return {
        "APP_ID": NATIVE_APP_ID,
        "API_URL": f"http://{host}:{NATIVE_PORTS['api']}",
        "AUTH_URL": f"http://{host}:{NATIVE_PORTS['auth']}",
        "POWERSYNC_URL": f"http://{host}:{NATIVE_PORTS['powersync']}",
    }


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def environment() -> dict[str, str]:
    result = {
        key: value
        for key, value in os.environ.items()
        if key in ("PATH", "HOME", "TMPDIR", "SYSTEMROOT", "CI", "DOCKER_HOST", "DOCKER_CONTEXT")
    }
    for name, field in Settings.model_fields.items():
        value = field.get_default(call_default_factory=True)
        result[name.upper()] = (
            ""
            if value is None
            else json.dumps(value)
            if isinstance(value, (dict, bool))
            else str(value)
        )
    return result


def wait_for(url: str, seconds: int = 90) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=2).is_success:
                return
        except httpx.TransportError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"service did not become ready: {url}")


class WorkerFailed(RuntimeError):
    pass


def scheduled_jobs(log: Path) -> dict[str, list[str]]:
    """The cron jobs the worker's own log reports finished, by outcome."""
    text = log.read_text(errors="replace") if log.is_file() else ""
    return {
        "completed": sorted(set(COMPLETED_JOB.findall(text))),
        "failed": sorted(set(FAILED_JOB.findall(text))),
    }


def group_alive(identity: int) -> bool:
    try:
        os.killpg(identity, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        rows = subprocess.check_output(["ps", "-axo", "pgid=,stat="], text=True).splitlines()
        return any(
            row.split()[0] == str(identity) and not row.split()[1].startswith("Z") for row in rows
        )
    return True


def stop(process: subprocess.Popen[bytes], *, grace_seconds: float = 15) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait(timeout=5)
        return
    except PermissionError:
        # macOS refuses to signal a group whose only member is a zombie
        if group_alive(process.pid):
            raise
        process.wait(timeout=5)
        return
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        process.poll()
        if not group_alive(process.pid):
            process.wait(timeout=5)
            return
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))
    with suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)
    process.wait(timeout=5)


class Stack:
    """One run on the shared test tier: its own API, worker, bundles and namespaced businesses."""

    def __init__(
        self,
        directory: Path,
        lease: tier.Lease,
        browser_project: Literal["default", "pseudo"] = "default",
        *,
        seed_as_of: datetime | None = None,
        native: str | None = None,
    ) -> None:
        self.directory = directory
        self.lease = lease
        self.namespace = lease.namespace
        self.native = native
        self.process_cleanup_failed = False
        self.project = directory.name
        self.browser_project = browser_project
        self.env = environment()
        # per-run callback secrets only: no account SID or API key, so nothing reaches a provider
        self.env["TWILIO_AUTH_TOKEN"] = secrets.token_urlsafe(24)
        self.env["RESEND_WEBHOOK_SECRET"] = (
            f"whsec_{base64.b64encode(secrets.token_bytes(24)).decode()}"
        )
        self.seed_as_of = seed_as_of
        if seed_as_of is not None:
            if seed_as_of.utcoffset() is None:
                raise ValueError("seed-as-of must include a UTC offset")
            self.env["E2E_SEED_AS_OF"] = seed_as_of.isoformat()
        self.web_port, self.pseudo_port, self.admin_port = (
            lease.web_port,
            lease.pseudo_port,
            lease.admin_port,
        )
        self.api_port, self.site_port = free_port(), free_port()
        self.connect_port, self.connect_pseudo_port = free_port(), free_port()
        self.api = f"http://localhost:{self.api_port}"
        self.web = f"http://localhost:{self.web_port}"
        self.pseudo = f"http://localhost:{self.pseudo_port}"
        self.app = self.pseudo if browser_project == "pseudo" else self.web
        self.worker: subprocess.Popen[bytes] | None = None
        self.worker_checks: dict[str, object] = {
            "worker_heartbeat": "pending",
            "worker_probe": "pending",
            "worker_schedule": "pending",
            "worker_final": "pending",
        }

    def command(
        self,
        arguments: list[str],
        log: IO[bytes],
        *,
        frontend: bool = False,
        env: dict[str, str] | None = None,
    ) -> None:
        process = subprocess.Popen(
            arguments,
            cwd=ROOT / ("frontend" if frontend else "backend"),
            env=self.env | (env or {}),
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            code = process.wait()
            if code:
                raise subprocess.CalledProcessError(code, arguments)
        finally:
            self.stop_owned(process)

    def stop_owned(self, process: subprocess.Popen[bytes]) -> None:
        try:
            stop(process)
        except BaseException:
            self.process_cleanup_failed = True
            raise

    def configure(self) -> None:
        """Record what cleanup needs if this process dies: the namespace and the slot it held."""
        (self.directory / "tier.json").write_text(
            json.dumps({"namespace": self.namespace, "slot": self.lease.slot}, indent=2)
        )

    def seeded_as_of(self) -> str | None:
        """When the restored seed was made, which a real-time run takes from its snapshot."""
        demo = self.directory / "demo.json"
        return str(json.loads(demo.read_text())["as_of"]) if demo.is_file() else None

    def seed(self, log: IO[bytes]) -> None:
        command = [
            sys.executable,
            "-m",
            "e2e.namespace",
            "seed",
            self.namespace,
            "--output",
            str(self.directory / "demo.json"),
        ]
        if self.seed_as_of is not None:
            command.extend(["--as-of", self.seed_as_of.isoformat()])
        # the seed's own writes keep demo ids, which the copy then renames into the namespace
        self.command(command, log, env={"RUN_NAMESPACE": ""})

    def start(
        self,
        processes: ExitStack,
        log: IO[bytes],
        *,
        before_api: Callable[[], None] | None = None,
        browser_fixtures: bool = True,
    ) -> None:
        public_port = (
            self.connect_pseudo_port if self.browser_project == "pseudo" else self.connect_port
        )
        self.env.update(
            {
                **tier.environment(),
                # the run's checks read the tier's rows directly, as the API's role
                "E2E_DATABASE_URL": tier.database_url("clientbridge_api", driver="postgresql"),
                "RUN_NAMESPACE": self.namespace,
                "E2E_NAMESPACE": self.namespace,
                "REDIS_URL": self.lease.redis_url,
                "S3_BUCKET": self.lease.bucket,
                "API_BASE_URL": self.api,
                "VITE_API_URL": self.api,
                "WEB_BASE_URL": self.app,
                "WEB_E2E_PORT": str(self.web_port),
                "WEB_PSEUDO_E2E_PORT": str(self.pseudo_port),
                "CORS_ALLOW_ORIGINS": f"{self.web},{self.pseudo}",
                "CONNECT_E2E_PORT": str(self.connect_port),
                "ADMIN_E2E_PORT": str(self.admin_port),
                "ADMIN_BASE_URL": f"http://localhost:{self.admin_port}",
                "VITE_ADMIN_URL": f"http://localhost:{self.admin_port}",
                "SITE_E2E_PORT": str(self.site_port),
                "VITE_SITE_URL": f"http://localhost:{self.site_port}",
                "CONNECT_PSEUDO_E2E_PORT": str(self.connect_pseudo_port),
                "BUSINESS_PAGE_URL": f"http://{{slug}}.localhost:{public_port}",
                "BOOK_BASE_URL": f"http://book.localhost:{public_port}",
                "SHOP_BASE_URL": f"http://shop.localhost:{public_port}",
                "PAY_BASE_URL": f"http://pay.localhost:{public_port}",
                # what each app's server answers as /config.js, as the web image's Caddy does
                "API_URL": self.api,
                "AUTH_URL": tier.environment()["AUTH_PUBLIC_URL"],
                "SYNC_URL": tier.environment()["POWERSYNC_URL"],
                "APP_URL": self.app,
                "ADMIN_URL": f"http://localhost:{self.admin_port}",
                "PAGE_URL": f"http://{{slug}}.localhost:{public_port}",
                "BOOK_URL": f"http://book.localhost:{public_port}",
                "SHOP_URL": f"http://shop.localhost:{public_port}",
                "PAY_URL": f"http://pay.localhost:{public_port}",
                "STRIPE_PUBLISHABLE_KEY": "",
                "E2E_OUTPUT_DIR": str(self.directory / "browser-results"),
                "PLAYWRIGHT_HTML_OUTPUT_DIR": str(self.directory / "browser-report"),
                "CI": "1",
            }
        )
        flush_redis(self.lease.redis_url)
        self.lease.register(self.api, keys=self.env.get("POWERSYNC_USE_RS256") == "true")
        self.seed(log)
        self.grant_platform_access()
        if before_api is not None:
            before_api()
        for name, command in {
            "api": [
                sys.executable,
                "-m",
                "uvicorn",
                "clientbridge.main:app",
                "--host",
                "0.0.0.0",
                "--port",
                str(self.api_port),
                # outlasts any wait in a test, so no request reuses a connection uvicorn closed
                "--timeout-keep-alive",
                "120",
            ],
            "worker": [sys.executable, "-m", "arq", "clientbridge.tasks.worker.WorkerSettings"],
        }.items():
            output = processes.enter_context((self.directory / f"{name}.log").open("wb"))
            process = subprocess.Popen(
                command,
                cwd=ROOT / "backend",
                env=self.env,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            processes.callback(self.stop_owned, process)
            if name == "worker":
                self.worker = process
        wait_for(f"{self.api}/ready")
        self.await_worker()
        self.probe_schedule()
        if browser_fixtures:
            self.command([sys.executable, "-m", "e2e.actions", "web-fixtures"], log)
        self.command([sys.executable, "-m", "e2e.sync", "caught-up"], log)

    def use_builds(self, log: IO[bytes]) -> None:
        """Point the browser lane's preview servers at the shared production builds."""
        for app, path in ensure_builds(log).items():
            self.env[f"E2E_{app.upper()}_BUILD"] = str(path)

    def grant_platform_access(self) -> None:
        """Own verified operator identities for the admin console, granted before the API starts."""
        granted: list[str] = []
        for role in PLATFORM_OPERATORS:
            email = f"operator-{role}-{secrets.token_hex(6)}+{self.namespace}@example.com"
            password = secrets.token_urlsafe(24)
            response = httpx.post(
                f"{self.env['AUTH_ADMIN_URL']}/admin/identities",
                json={
                    "schema_id": "default",
                    "traits": {"email": email, "name": "Platform operator"},
                    "credentials": {"password": {"config": {"password": password}}},
                    "verifiable_addresses": [
                        {"value": email, "via": "email", "verified": True, "status": "completed"}
                    ],
                },
                timeout=10,
            )
            response.raise_for_status()
            granted.append(str(response.json()["id"]))
            self.env[f"E2E_OPERATOR_{role.upper()}_EMAIL"] = email
            self.env[f"E2E_OPERATOR_{role.upper()}_PASSWORD"] = password
        self.env["PLATFORM_ADMIN_IDENTITY_IDS"] = ",".join(granted)

    def worker_heartbeat(self) -> bool:
        """The liveness probe production runs: `arq --check` reads the worker's heartbeat key."""
        process = subprocess.Popen(
            [sys.executable, "-m", "arq", "--check", WORKER_SETTINGS],
            cwd=ROOT / "backend",
            env=self.env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            return process.wait(timeout=30) == 0
        except subprocess.TimeoutExpired:
            return False
        finally:
            self.stop_owned(process)

    def worker_running(self) -> bool:
        return self.worker is not None and self.worker.poll() is None

    def await_worker(self, seconds: float = 60) -> None:
        deadline = time.monotonic() + seconds
        while self.worker_running() and time.monotonic() < deadline:
            if self.worker_heartbeat():
                self.worker_checks["worker_heartbeat"] = "passed"
                return
            time.sleep(0.5)
        self.worker_checks["worker_heartbeat"] = "failed"
        raise WorkerFailed("the worker exited or recorded no heartbeat")

    def probe_schedule(self, seconds: float = 60) -> None:
        """Run one cron entry now under its scheduled name, so the schedule's wiring is proven."""

        async def enqueue() -> bool:
            pool = await create_pool(RedisSettings.from_dsn(self.env["REDIS_URL"]))
            try:
                job = await pool.enqueue_job(
                    f"cron:{PROBE_JOB}", _job_id=f"e2e-probe:{secrets.token_hex(6)}"
                )
                return job is not None
            finally:
                await pool.aclose()

        log = self.directory / "worker.log"
        if asyncio.run(enqueue()):
            deadline = time.monotonic() + seconds
            while self.worker_running() and time.monotonic() < deadline:
                jobs = scheduled_jobs(log)
                if PROBE_JOB in jobs["failed"]:
                    break
                if PROBE_JOB in jobs["completed"]:
                    self.worker_checks["worker_probe"] = "passed"
                    return
                time.sleep(0.5)
        self.worker_checks["worker_probe"] = "failed"
        raise WorkerFailed("the worker did not run the probed cron job")

    def finish_worker(self, seconds: float = 75) -> dict[str, object]:
        """Wait for a job the scheduler fired itself, then require the worker still alive."""
        if self.worker is None:
            return dict(self.worker_checks)
        log = self.directory / "worker.log"
        deadline = time.monotonic() + seconds
        jobs = scheduled_jobs(log)
        while (
            not set(jobs["completed"]) - {PROBE_JOB}
            and self.worker_running()
            and time.monotonic() < deadline
        ):
            time.sleep(1)
            jobs = scheduled_jobs(log)
        fired = bool(set(jobs["completed"]) - {PROBE_JOB})
        self.worker_checks["scheduled_jobs"] = jobs
        self.worker_checks["worker_schedule"] = (
            "passed" if fired and not jobs["failed"] else "failed"
        )
        alive = self.worker_running() and self.worker_heartbeat()
        self.worker_checks["worker_final"] = "passed" if alive else "failed"
        return dict(self.worker_checks)

    def require_worker(self) -> None:
        failed = [
            name
            for name in ("worker_heartbeat", "worker_probe", "worker_schedule", "worker_final")
            if self.worker_checks[name] != "passed"
        ]
        if failed:
            raise WorkerFailed(f"worker checks did not pass: {', '.join(failed)}")

    def cleanup(self) -> None:
        """Remove the run's businesses, logins, mail, bucket and queue; the tier stays up."""
        purge(self.namespace, self.lease.redis_url, self.directory / "purge.json")


def flush_redis(url: str) -> None:
    async def flush() -> None:
        pool = await create_pool(RedisSettings.from_dsn(url))
        try:
            await pool.flushdb()
        finally:
            await pool.aclose()

    asyncio.run(flush())


def purge(namespace: str, redis_url: str, record: Path) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "e2e.namespace", "purge", namespace],
        cwd=ROOT / "backend",
        env=environment() | tier.environment(),
        capture_output=True,
        text=True,
    )
    record.write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f"purging namespace {namespace} failed; see {record}")
    flush_redis(redis_url)


@contextmanager
def owned_processes(record: dict[str, object]) -> Iterator[ExitStack]:
    processes = ExitStack()
    try:
        yield processes
    finally:
        try:
            processes.close()
        except BaseException:
            record["process_cleanup"] = "failed"
            raise
        else:
            record["process_cleanup"] = "passed"


def playwright_app(surface: str) -> str:
    return "web" if surface in ("journeys", "filings") else surface


def playwright_config(surface: str) -> str:
    return (
        f"playwright.{surface}.config.ts"
        if surface in ("journeys", "filings")
        else "playwright.config.ts"
    )


def listed_cases(stack: "Stack", args: argparse.Namespace) -> list[Spec]:
    """The cases the lane would run, with their files and lines, without running them."""
    listing = subprocess.run(
        [
            "pnpm",
            "exec",
            "playwright",
            "test",
            f"--config={playwright_config(args.surface)}",
            f"--project={args.project}",
            "--list",
            "--reporter=json",
            *args.tests,
        ],
        cwd=ROOT / "frontend" / "apps" / playwright_app(args.surface),
        env=stack.env,
        capture_output=True,
        text=True,
        check=True,
    )
    report = Report.model_validate_json(listing.stdout)
    return [case for suite in report.suites for case in suite.cases()]


# the Playwright configs' workers per lane
WORKERS = 2


def shard_seconds(units: dict[str, int], picked: list[str]) -> float:
    """A shard's expected wall time: workers share its cases, but one file runs on one worker."""
    files: dict[str, int] = {}
    for unit in picked:
        file = unit.rsplit(":", 1)[0]
        files[file] = files.get(file, 0) + units[unit]
    return max(sum(files.values()) / WORKERS, max(files.values(), default=0))


def balanced(units: dict[str, int], shards: int) -> list[list[str]]:
    """Longest first, each to the shard whose expected wall time grows the least."""
    picked: list[list[str]] = [[] for _ in range(shards)]
    for unit, _ in sorted(units.items(), key=lambda item: (-item[1], item[0])):
        best = min(range(shards), key=lambda i: (shard_seconds(units, [*picked[i], unit]), i))
        picked[best].append(unit)
    return picked


def shard_filters(cases: list[Spec], seconds: dict[str, int], shard: str) -> list[str]:
    """This shard's cases as file:line filters, balanced by each case's measured seconds."""
    index, total = (int(part) for part in shard.split("/"))
    known = sorted(seconds.values())
    usual = known[len(known) // 2] if known else 30
    units: dict[str, int] = {}
    for case in cases:
        # cases declared on one line, such as a loop's, can only be selected together
        unit = f"e2e/{case.file}:{case.line}"
        units[unit] = units.get(unit, 0) + seconds.get(case.key, usual)
    picked = balanced(units, total)[index - 1]
    if not picked:
        raise ValueError(f"shard {shard} has no cases; use fewer shards")
    return sorted(picked)


def case_seconds(surface: str) -> dict[str, int]:
    path = ROOT / "frontend" / "apps" / playwright_app(surface) / "e2e" / "case-seconds.json"
    return cast(dict[str, int], json.loads(path.read_text())) if path.is_file() else {}


def shuffled_config(stack: "Stack", args: argparse.Namespace, seed: int) -> str:
    """Order the lane's spec files by seed: Playwright runs files by name, so numbered wrappers."""
    app = ROOT / "frontend" / "apps" / playwright_app(args.surface)
    files = sorted({case.file for case in listed_cases(stack, args)})
    if not files:
        raise ValueError("the shuffled lane selected no spec files")
    random.Random(seed).shuffle(files)
    directory = app / "test-results" / f"shuffle-{stack.project}"
    cases = directory / "cases"
    cases.mkdir(parents=True)
    for rank, name in enumerate(files):
        target = os.path.relpath(app / "e2e" / name, cases)
        (cases / f"{rank:03d}-{Path(name).name}").write_text(f'import "{target}";\n')
    config = directory / "playwright.config.ts"
    config.write_text(
        f'import base from "{os.path.relpath(app / playwright_config(args.surface), directory)}";\n'
        "export default {\n"
        "    ...base,\n"
        '    testDir: "cases",\n'
        "    projects: (base.projects ?? []).map((project) => ({\n"
        '        ...project, testDir: "cases", testMatch: "*.ts", testIgnore: [],\n'
        "    })),\n"
        "    webServer: [base.webServer ?? []].flat().map((server) => ({\n"
        f"        ...server, cwd: {json.dumps(str(app))},\n"
        "    })),\n"
        "};\n"
    )
    (stack.directory / "shuffle.json").write_text(
        json.dumps({"seed": seed, "files": files}, indent=2) + "\n"
    )
    return str(config)


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


class NativeDevice:
    """Installs the e2e build on a device the developer already started, and takes it off after."""

    def __init__(self, platform: Literal["ios", "android"], device: str) -> None:
        self.platform = platform
        self.device = device

    def run(self, *arguments: str, check: bool = True) -> str:
        command = (
            ["xcrun", "simctl", *arguments]
            if self.platform == "ios"
            else [str(ADB), "-s", self.device, *arguments]
        )
        result = subprocess.run(command, capture_output=True, text=True)
        if check and result.returncode:
            raise RuntimeError(f"{' '.join(command)} failed: {result.stderr.strip()}")
        return result.stdout

    def require_started(self) -> None:
        if self.platform == "ios":
            booted = json.loads(self.run("list", "devices", "booted", "-j"))["devices"]
            started = any(d["udid"] == self.device for ds in booted.values() for d in ds)
        else:
            started = self.run("get-state", check=False).strip() == "device"
        if not started:
            raise RuntimeError(f"start the {self.platform} device {self.device} before the lane")

    def push(self, payload: bytes) -> None:
        if self.platform != "ios":
            raise RuntimeError("only the iOS simulator accepts a push without a push service")
        result = subprocess.run(
            ["xcrun", "simctl", "push", self.device, NATIVE_APP_ID, "-"],
            input=payload,
            capture_output=True,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.decode().strip())

    @contextmanager
    def installed(self, build: Path) -> Iterator[None]:
        self.require_started()
        if self.platform == "ios":
            # a stuck pasteboard daemon blocks every text field's focus, and so Maestro's typing
            self.run("spawn", self.device, "launchctl", "stop", "com.apple.pasteboard.pasted")
            self.run("uninstall", self.device, NATIVE_APP_ID, check=False)
            self.run("install", self.device, str(build))
        else:
            self.run("uninstall", NATIVE_APP_ID, check=False)
            self.run("install", str(build))
        try:
            yield
        finally:
            if self.platform == "ios":
                self.run("terminate", self.device, NATIVE_APP_ID, check=False)
                self.run("uninstall", self.device, NATIVE_APP_ID, check=False)
            else:
                self.run("uninstall", NATIVE_APP_ID, check=False)


class NativeLink:
    """Forwards the build's fixed hosts to the run's services; cutting it takes the app offline."""

    def __init__(self, targets: dict[int, int]) -> None:
        self.targets = targets
        self.loop = asyncio.new_event_loop()
        self.servers: list[asyncio.Server] = []
        self.writers: set[asyncio.StreamWriter] = set()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)

    def call(self, work: Coroutine[object, object, None]) -> None:
        asyncio.run_coroutine_threadsafe(work, self.loop).result(timeout=30)

    async def pipe(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
        except ConnectionError:
            pass
        finally:
            writer.close()

    async def forward(
        self, target: int, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            upstream_reader, upstream = await asyncio.open_connection("127.0.0.1", target)
        except OSError:
            writer.close()
            return
        self.writers |= {writer, upstream}
        try:
            await asyncio.gather(self.pipe(reader, upstream), self.pipe(upstream_reader, writer))
        finally:
            self.writers -= {writer, upstream}

    async def listen(self) -> None:
        for port, target in self.targets.items():
            self.servers.append(
                await asyncio.start_server(partial(self.forward, target), "127.0.0.1", port)
            )

    async def cut(self) -> None:
        servers, self.servers = self.servers, []
        for server in servers:
            server.close()
        for writer in list(self.writers):
            writer.transport.abort()
        for server in servers:
            await server.wait_closed()

    def online(self) -> None:
        if not self.thread.is_alive():
            self.thread.start()
        if not self.servers:
            self.call(self.listen())

    def offline(self) -> None:
        self.call(self.cut())

    def close(self) -> None:
        if self.thread.is_alive():
            self.offline()
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=10)


@contextmanager
def native_control(link: NativeLink, push: Callable[[bytes], None], log: Path) -> Iterator[str]:
    """A local endpoint a flow calls to go offline, come back or receive a push."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            actions: dict[str, Callable[[], None]] = {
                "/offline": link.offline,
                "/online": link.online,
                "/push": lambda: push(body),
            }
            action = actions.get(self.path)
            try:
                if action is None:
                    raise LookupError(self.path)
                action()
            except (LookupError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(error).encode())
                return
            with log.open("a") as record:
                record.write(f"{clock.wall().isoformat()} {self.path}\n")
            self.send_response(204)
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=10)


@contextmanager
def native_ports_free() -> Iterator[None]:
    """One native stack at a time: its ports are fixed, and so is the device it drives."""
    tier.TIER.mkdir(parents=True, exist_ok=True)
    with (tier.TIER / "native.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("another native e2e run holds the native ports") from None
        for port in [*NATIVE_PORTS.values(), DRIVER_PORT]:
            with socket.socket() as sock:
                # a previous run's closed connections linger in TIME_WAIT; only a listener counts
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    sock.bind(("127.0.0.1", port))
                except OSError:
                    raise RuntimeError(f"port {port} is taken; the native lane needs it") from None
        yield


def build_native(platform: str) -> None:
    subprocess.run(
        [str(MOBILE / "scripts" / "e2e-build.sh"), platform, str(NATIVE_BUILDS[platform])],
        env={**os.environ, "ANDROID_HOME": str(ANDROID_HOME), **native_urls(platform)},
        check=True,
    )


def native_flows(tests: list[str]) -> list[str]:
    """The named flows, or every walkthrough in the order e2e/shards.json lists them."""
    shards = cast(list[dict[str, object]], json.loads((MOBILE / "e2e" / "shards.json").read_text()))
    names = tests or [str(flow) for shard in shards for flow in cast(list[object], shard["flows"])]
    return [str(Path("e2e") / name) for name in names]


def run_native(
    stack: Stack, args: argparse.Namespace, processes: ExitStack, log: IO[bytes]
) -> None:
    build = NATIVE_BUILDS[args.platform]
    if not build.exists():
        raise RuntimeError(f"no e2e build at {build}; run with --build-native {args.platform}")
    stack.start(processes, log, browser_fixtures=False)
    report = stack.directory / "native-results.xml"
    flows = native_flows(args.tests)
    command = [
        "maestro",
        "--device",
        args.device,
        "test",
        "--driver-host-port",
        str(DRIVER_PORT),
        *flows,
        "-e",
        f"APP_ID={NATIVE_APP_ID}",
        "-e",
        f"E2E_NAMESPACE={stack.namespace}",
        "-e",
        f"MAILPIT_URL={stack.env['MAILPIT_URL']}",
        "-e",
        f"AUTH_ADMIN_URL={stack.env['AUTH_ADMIN_URL']}",
        # only the iOS simulator takes a push without a push service
        *(["--exclude-tags", "ios"] if args.platform == "android" else []),
        "--format",
        "junit",
        "--output",
        str(report),
        "--test-output-dir",
        str(stack.directory / "native-artifacts"),
        "--debug-output",
        str(stack.directory / "native-debug"),
        "--flatten-debug-output",
    ]
    device = NativeDevice(args.platform, args.device)
    link = NativeLink(
        {
            NATIVE_PORTS["api"]: stack.api_port,
            NATIVE_PORTS["auth"]: tier.PORTS["auth"],
            NATIVE_PORTS["powersync"]: tier.PORTS["powersync"],
        }
    )
    link.online()
    processes.callback(link.close)

    def message_push(body: bytes) -> None:
        # a flow names the seeded client; the run holds its own namespaced copy
        request = json.loads(body)
        payload = subprocess.run(
            [
                sys.executable,
                "-m",
                "e2e.actions",
                "native-push",
                f"{request['client_id']}_{stack.namespace}",
                str(request["preview"]),
            ],
            cwd=ROOT / "backend",
            env=stack.env,
            capture_output=True,
            check=True,
        ).stdout
        device.push(payload)

    with (
        device.installed(build),
        native_control(link, message_push, stack.directory / "control.log") as control,
        (stack.directory / "native.log").open("wb") as native_log,
    ):
        command += ["-e", f"CONTROL_URL={control}"]
        process = subprocess.Popen(
            command, cwd=MOBILE, stdout=native_log, stderr=subprocess.STDOUT, start_new_session=True
        )
        try:
            process.wait()
        finally:
            stack.stop_owned(process)
    required = [] if args.tests else REQUIRED_CASES[f"native-{args.platform}"]
    validate_native_evidence(report.read_text(), required)


def shard(value: str) -> str:
    match = re.fullmatch(r"(\d+)/(\d+)", value)
    if not match or not 1 <= int(match[1]) <= int(match[2]):
        raise argparse.ArgumentTypeError("a shard is <index>/<total>, e.g. 2/3")
    return value


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
