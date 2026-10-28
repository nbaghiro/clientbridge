"""A run's own API, worker and app servers on the shared test tier, and the processes it owns."""

import asyncio
import base64
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager, suppress
from datetime import datetime
from pathlib import Path
from typing import IO, Literal

import httpx
from arq.connections import RedisSettings, create_pool

from clientbridge.core.config import Settings
from e2e import tier
from e2e.builds import ensure_builds
from e2e.tier import ROOT

WORKER_SETTINGS = "clientbridge.tasks.worker.WorkerSettings"


PROBE_JOB = "prune_receipts"


PLATFORM_OPERATORS = ("console", "lapse")


COMPLETED_JOB = re.compile(r"← cron:(\w+) ●")


FAILED_JOB = re.compile(r"! cron:(\w+) failed")


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
