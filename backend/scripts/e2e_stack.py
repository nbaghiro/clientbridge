"""Run functional browsers against services owned by one disposable Compose project."""

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
from scripts.e2e_results import (
    BROWSERS,
    REQUIRED_CASES,
    Report,
    browser_cases,
    validate_native_evidence,
)

ROOT = Path(__file__).resolve().parents[2]
WORKER_SETTINGS = "clientbridge.tasks.worker.WorkerSettings"
PROBE_JOB = "prune_receipts"
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


MOBILE = ROOT / "frontend" / "apps" / "mobile"
NATIVE_APP_ID = "ca.clientbridge.app.e2e"
# the e2e build has these hosts compiled in; the lane forwards them to the run's services
NATIVE_PORTS = {"api": 8761, "auth": 8763, "powersync": 8764}
# Maestro's own port to its device driver, fixed where a random pick can't meet an emulator socket
DRIVER_PORT = 8767
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


STACK_BYTES = 1536 * 1024 * 1024
SLOTS = Path(os.environ.get("E2E_SLOT_DIR", Path.home() / ".cache" / "clientbridge-e2e" / "slots"))


def slot_count() -> int:
    configured = os.environ.get("E2E_STACK_SLOTS")
    if configured:
        return max(1, int(configured))
    memory = subprocess.run(
        ["docker", "info", "--format", "{{.MemTotal}}"], capture_output=True, text=True
    )
    return max(1, int(memory.stdout.strip() or STACK_BYTES) // STACK_BYTES)


@contextmanager
def stack_slot(*, poll_seconds: float = 5) -> Iterator[int]:
    """Hold one of the machine's stack slots, so parallel runs can't exhaust Docker's memory."""
    SLOTS.mkdir(parents=True, exist_ok=True)
    count = slot_count()
    waiting = False
    while True:
        for index in range(count):
            handle = (SLOTS / f"{index}.lock").open("a")
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                handle.close()
                continue
            try:
                yield index
            finally:
                handle.close()
            return
        if not waiting:
            print(f"Waiting for one of {count} e2e stack slots on this machine", flush=True)
            waiting = True
        time.sleep(poll_seconds)


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
    def __init__(
        self,
        directory: Path,
        browser_project: Literal["default", "pseudo"] = "default",
        *,
        seed_as_of: datetime | None = None,
        native: str | None = None,
    ) -> None:
        self.directory = directory
        self.native = native
        self.process_cleanup_failed = False
        self.project = directory.name
        self.browser_project = browser_project
        self.compose = [
            "docker",
            "compose",
            "-p",
            self.project,
            "-f",
            str(directory / "compose.json"),
        ]
        self.env = environment()
        self.seed_as_of = seed_as_of
        if seed_as_of is not None:
            if seed_as_of.utcoffset() is None:
                raise ValueError("seed-as-of must include a UTC offset")
            self.env["E2E_SEED_AS_OF"] = seed_as_of.isoformat()
        self.api_port, self.web_port, self.pseudo_port, self.auth_port = (
            free_port() for _ in range(4)
        )
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

    def command(self, arguments: list[str], log: IO[bytes], *, frontend: bool = False) -> None:
        process = subprocess.Popen(
            arguments,
            cwd=ROOT / ("frontend" if frontend else "backend"),
            env=self.env,
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

    def compose_command(self, *arguments: str) -> str:
        command = [*self.compose, *arguments]
        process = subprocess.Popen(
            command, stdout=subprocess.PIPE, cwd=ROOT, start_new_session=True
        )
        try:
            output, _ = process.communicate()
            if process.returncode:
                raise subprocess.CalledProcessError(process.returncode, command, output=output)
            return output.decode()
        finally:
            self.stop_owned(process)

    def port(self, service: str, port: int) -> int:
        return int(self.compose_command("port", service, str(port)).strip().rsplit(":", 1)[1])

    def configure(self) -> None:
        base = cast(
            dict[str, dict[str, dict[str, object]]],
            json.loads(
                subprocess.check_output(
                    [
                        "docker",
                        "compose",
                        "-f",
                        str(ROOT / "docker-compose.yml"),
                        "config",
                        "--format",
                        "json",
                    ],
                    cwd=ROOT,
                )
            ),
        )
        services: dict[str, dict[str, object]] = {}
        for name, ports in {
            "postgres": [5432],
            "redis": [6379],
            "s3": [9000],
            "mailpit": [8025, 1025],
            "auth": [4433, 4434],
            "powersync": [8080],
        }.items():
            services[name] = {
                "image": base["services"][name]["image"],
                "ports": [f"127.0.0.1::{port}" for port in ports],
            }
        services["postgres"].update(
            {
                "command": ["postgres", "-c", "wal_level=logical"],
                "environment": {
                    "POSTGRES_USER": "clientbridge",
                    "POSTGRES_PASSWORD": "clientbridge",
                    "POSTGRES_DB": "clientbridge_test_e2e",
                },
                "healthcheck": {
                    "test": ["CMD-SHELL", "pg_isready -U clientbridge -d clientbridge_test_e2e"],
                    "interval": "1s",
                    "timeout": "3s",
                    "retries": 60,
                },
            }
        )
        services["mailpit"]["environment"] = {"MP_SMTP_ALLOWED_RECIPIENTS": DELIVERABLE}
        services["s3"]["environment"] = {
            "RUSTFS_ACCESS_KEY": "rustfs",
            "RUSTFS_SECRET_KEY": "rustfs-dev-secret",
            "RUSTFS_CORS_ALLOWED_ORIGINS": "*",
        }
        services["auth"]["ports"] = [f"127.0.0.1:{self.auth_port}:4433", "127.0.0.1::4434"]
        auth_environment = {
            # the native app reaches auth through its compiled-in host, so the flows' URLs must too
            "SERVE_PUBLIC_BASE_URL": f"{native_urls(self.native)['AUTH_URL']}/"
            if self.native
            else f"http://localhost:{self.auth_port}/",
            "DSN": "postgres://auth:auth@postgres:5432/auth?sslmode=disable",
            "SECRETS_COOKIE": secrets.token_urlsafe(32),
            "SECRETS_CIPHER": secrets.token_hex(16),
            "COURIER_HTTP_REQUEST_CONFIG_AUTH_CONFIG_VALUE": self.env["AUTH_EMAIL_HOOK_SECRET"],
            "COURIER_HTTP_REQUEST_CONFIG_URL": f"http://host.docker.internal:{self.api_port}/webhooks/auth-email",
            "SELFSERVICE_METHODS_PASSWORD_CONFIG_HAVEIBEENPWNED_ENABLED": "false",
            "SERVE_PUBLIC_CORS_ALLOWED_ORIGINS": f"{self.web},{self.pseudo}",
            "SELFSERVICE_ALLOWED_RETURN_URLS": f"{self.web},{self.pseudo},clientbridge://auth/callback",
            "SELFSERVICE_DEFAULT_BROWSER_RETURN_URL": self.app,
            "SELFSERVICE_METHODS_WEBAUTHN_CONFIG_RP_ORIGINS": f"{self.web},{self.pseudo}",
        }
        for flow, path in {
            "ERROR": "auth-error",
            "LOGIN": "login",
            "REGISTRATION": "signup",
            "VERIFICATION": "verify",
            "RECOVERY": "recover",
            "SETTINGS": "setup/security",
        }.items():
            auth_environment[f"SELFSERVICE_FLOWS_{flow}_UI_URL"] = f"{self.app}/{path}"
        auth_environment["SELFSERVICE_FLOWS_VERIFICATION_AFTER_DEFAULT_BROWSER_RETURN_URL"] = (
            self.app
        )
        auth_environment["SELFSERVICE_FLOWS_LOGOUT_AFTER_DEFAULT_BROWSER_RETURN_URL"] = (
            f"{self.app}/login"
        )
        services["auth"].update(
            {
                "environment": auth_environment,
                "volumes": [f"{ROOT / 'infra/auth'}:/etc/config/auth:ro"],
                "extra_hosts": ["host.docker.internal:host-gateway"],
                "command": [
                    "serve",
                    "-c",
                    "/etc/config/auth/kratos.yml",
                    "--dev",
                    "--watch-courier",
                ],
            }
        )
        services["auth-migrate"] = {
            "image": base["services"]["auth"]["image"],
            "environment": {"DSN": auth_environment["DSN"]},
            "command": ["migrate", "sql", "up", "-e", "--yes"],
        }
        jwt = secrets.token_urlsafe(32)
        self.env["JWT_SECRET"] = jwt
        sync = {
            "replication": {
                "connections": [
                    {
                        "type": "postgresql",
                        "uri": "postgresql://powersync_source:powersync_source@postgres:5432/clientbridge_test_e2e",
                        "sslmode": "disable",
                    }
                ]
            },
            "storage": {
                "type": "postgresql",
                "uri": "postgresql://powersync_storage_owner:powersync_storage_owner@postgres:5432/powersync_storage",
                "sslmode": "disable",
            },
            "port": 8080,
            "sync_rules": {"path": "/config/sync-rules.yaml"},
            "client_auth": {
                "jwks": {
                    "keys": [
                        {
                            "kty": "oct",
                            "alg": "HS256",
                            "kid": "clientbridge-dev",
                            "k": base64.urlsafe_b64encode(jwt.encode()).decode().rstrip("="),
                        }
                    ]
                },
                "audience": ["powersync"],
            },
        }
        (self.directory / "powersync.json").write_text(json.dumps(sync))
        services["powersync"].update(
            {
                "volumes": [
                    f"{self.directory / 'powersync.json'}:/config/powersync.yaml:ro",
                    f"{ROOT / 'infra/powersync/sync-rules.yaml'}:/config/sync-rules.yaml:ro",
                ],
                "environment": {"POWERSYNC_CONFIG_PATH": "/config/powersync.yaml"},
                "command": ["start", "-r", "unified"],
            }
        )
        (self.directory / "compose.json").write_text(json.dumps({"services": services}, indent=2))

    def seed(self, log: IO[bytes]) -> None:
        command = [sys.executable, "-m", "scripts.seed_demo", "--core"]
        if self.seed_as_of is not None:
            command.extend(["--as-of", self.seed_as_of.isoformat()])
        self.command(command, log)

    def start(
        self,
        processes: ExitStack,
        log: IO[bytes],
        *,
        before_api: Callable[[], None] | None = None,
        browser_fixtures: bool = True,
    ) -> None:
        self.compose_command("up", "-d", "--wait", "postgres", "redis", "s3", "mailpit")
        database = f"localhost:{self.port('postgres', 5432)}/clientbridge_test_e2e"
        public_port = (
            self.connect_pseudo_port if self.browser_project == "pseudo" else self.connect_port
        )
        self.env.update(
            {
                "ADMIN_DATABASE_URL": f"postgresql+asyncpg://clientbridge:clientbridge@{database}",
                "MIGRATION_DATABASE_URL": f"postgresql+asyncpg://clientbridge_migrator:clientbridge_migrator@{database}",
                "DATABASE_URL": f"postgresql+asyncpg://clientbridge_api:clientbridge_api@{database}",
                "REDIS_URL": f"redis://localhost:{self.port('redis', 6379)}/0",
                "S3_ENDPOINT": f"http://localhost:{self.port('s3', 9000)}",
                "S3_BUCKET": self.project,
                "SMTP_URL": f"smtp://localhost:{self.port('mailpit', 1025)}",
                "MAILPIT_URL": f"http://localhost:{self.port('mailpit', 8025)}",
                "API_BASE_URL": self.api,
                "API_URL": self.api,
                "VITE_API_URL": self.api,
                "WEB_BASE_URL": self.app,
                "WEB_E2E_PORT": str(self.web_port),
                "WEB_PSEUDO_E2E_PORT": str(self.pseudo_port),
                "CORS_ALLOW_ORIGINS": f"{self.web},{self.pseudo}",
                "VITE_STRIPE_PUBLISHABLE_KEY": "",
                "CONNECT_E2E_PORT": str(self.connect_port),
                "CONNECT_PSEUDO_E2E_PORT": str(self.connect_pseudo_port),
                "BUSINESS_PAGE_URL": f"http://{{slug}}.localhost:{public_port}",
                "BOOK_BASE_URL": f"http://book.localhost:{public_port}",
                "SHOP_BASE_URL": f"http://shop.localhost:{public_port}",
                "PAY_BASE_URL": f"http://pay.localhost:{public_port}",
                "VITE_PAY_URL": f"http://pay.localhost:{public_port}",
                "VITE_BOOK_URL": f"http://book.localhost:{public_port}",
                "E2E_OUTPUT_DIR": str(self.directory / "browser-results"),
                "PLAYWRIGHT_HTML_OUTPUT_DIR": str(self.directory / "browser-report"),
                "CI": "1",
            }
        )
        self.command([sys.executable, "-m", "scripts.db_access", "roles"], log)
        self.command([sys.executable, "-m", "alembic", "upgrade", "head"], log)
        self.command([sys.executable, "-m", "scripts.db_access", "grants"], log)
        self.compose_command("run", "--rm", "auth-migrate")
        self.compose_command("up", "-d", "auth", "powersync")
        auth = f"http://localhost:{self.port('auth', 4433)}"
        self.env.update(
            {
                "AUTH_PUBLIC_URL": auth,
                "AUTH_INTERNAL_URL": auth,
                "VITE_AUTH_URL": auth,
                "AUTH_ADMIN_URL": f"http://localhost:{self.port('auth', 4434)}",
                "VITE_POWERSYNC_URL": f"http://localhost:{self.port('powersync', 8080)}",
            }
        )
        wait_for(f"{self.env['AUTH_ADMIN_URL']}/admin/health/ready")
        self.seed(log)
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
            self.command([sys.executable, "-m", "scripts.web_fixtures"], log)
        self.command([sys.executable, "-m", "scripts.sync_caught_up"], log)

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
        try:
            if self.compose_command("ps", "-a", "-q").strip():
                (self.directory / "services.log").write_text(
                    self.compose_command("logs", "--no-color")
                )
        finally:
            self.compose_command("down", "--volumes", "--remove-orphans")
        if self.compose_command("ps", "-a", "-q").strip():
            raise RuntimeError("run-owned containers remain after cleanup")


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


def shuffled_config(stack: "Stack", args: argparse.Namespace, seed: int) -> str:
    """Order the lane's spec files by seed: Playwright runs files by name, so numbered wrappers."""
    app = ROOT / "frontend" / "apps" / playwright_app(args.surface)
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
        cwd=app,
        env=stack.env,
        capture_output=True,
        text=True,
        check=True,
    )
    suites = cast(list[dict[str, object]], json.loads(listing.stdout).get("suites", []))
    files = sorted({str(suite["file"]) for suite in suites})
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
    if args.surface == "connect":
        stack.env["CONNECT_LINKS"] = subprocess.check_output(
            [sys.executable, "-m", "scripts.connect_links"],
            cwd=ROOT / "backend",
            env=stack.env,
            text=True,
        )
    measuring = args.repeat_each > 1 or args.shuffle_seed is not None
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
        *args.tests,
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
    if args.tests or measuring or args.project == "pseudo":
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
    SLOTS.mkdir(parents=True, exist_ok=True)
    with (SLOTS.parent / "native.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("another native e2e run holds the native ports") from None
        for port in [*NATIVE_PORTS.values(), DRIVER_PORT]:
            with socket.socket() as sock:
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


def run_native(
    stack: Stack, args: argparse.Namespace, processes: ExitStack, log: IO[bytes]
) -> None:
    build = NATIVE_BUILDS[args.platform]
    if not build.exists():
        raise RuntimeError(f"no e2e build at {build}; run with --build-native {args.platform}")
    stack.start(processes, log, browser_fixtures=False)
    report = stack.directory / "native-results.xml"
    flows = [str(Path("e2e") / flow) for flow in args.tests] or ["e2e"]
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
            NATIVE_PORTS["auth"]: stack.auth_port,
            NATIVE_PORTS["powersync"]: stack.port("powersync", 8080),
        }
    )
    link.online()
    processes.callback(link.close)

    def message_push(body: bytes) -> None:
        request = json.loads(body)
        payload = subprocess.run(
            [
                sys.executable,
                "-m",
                "scripts.e2e_native_push",
                str(request["client_id"]),
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--configure-only", action="store_true")
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
    parser.add_argument("tests", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.tests[:1] == ["--"]:
        args.tests = args.tests[1:]
    if args.allow_source_changes and os.environ.get("CI"):
        parser.error("CI cannot accept source changes during a run")
    if args.build_native:
        build_native(args.build_native)
        return
    if args.surface in ("journeys", "filings", "native") and args.project != "default":
        parser.error("journeys, filings and native use the default project")
    if (args.surface == "native") != bool(args.platform and args.device):
        parser.error("the native surface, and only it, takes --platform and --device")
    if args.project in BROWSERS and args.surface not in ("web", "connect"):
        parser.error("only the web and Connect lanes have Firefox and WebKit projects")
    if args.repeat_each < 1:
        parser.error("repeat-each must be at least 1")
    if args.cleanup and args.seed_as_of is not None:
        parser.error("cleanup cannot override a recorded seed date")
    if args.cleanup:
        name = str(args.cleanup)
        if (
            len(name) != 16
            or not name.startswith("e2e-")
            or any(c not in "0123456789abcdef" for c in name[4:])
        ):
            parser.error("cleanup requires the exact generated e2e-<12 hex digits> project name")
        directory = ROOT / ".scratchpad" / name
        if not (directory / "compose.json").is_file():
            parser.error("the recorded run configuration is missing")
        Stack(directory).cleanup()
        metadata = directory / "run.json"
        if metadata.is_file():
            record = json.loads(metadata.read_text())
            record["docker_cleanup"] = "passed"
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
        return
    directory = ROOT / ".scratchpad" / f"e2e-{secrets.token_hex(6)}"
    directory.mkdir(parents=True)
    anchor = args.seed_as_of
    if anchor is None and args.surface == "filings":
        anchor = filing_seed_anchor(clock.wall())
    stack = Stack(
        directory,
        "pseudo" if args.project == "pseudo" else "default",
        seed_as_of=anchor,
        native=args.platform,
    )
    stack.configure()
    print(f"E2E project and diagnostics: {directory}", flush=True)
    if args.configure_only:
        return
    record: dict[str, object] = {
        "project": stack.project,
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
        "docker_cleanup": "pending",
        "allow_source_changes": args.allow_source_changes,
        **stack.worker_checks,
    }
    metadata = directory / "run.json"
    metadata.write_text(json.dumps(record, indent=2))
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    try:
        with (
            native_ports_free() if args.surface == "native" else nullcontext(),
            stack_slot(),
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
    except BaseException as error:
        record["outcome"] = (
            "interrupted" if isinstance(error, (SystemExit, KeyboardInterrupt)) else "failed"
        )
        record["failure_type"] = type(error).__name__
        raise
    finally:
        try:
            stack.cleanup()
            if stack.process_cleanup_failed:
                record["process_cleanup"] = "failed"
            record["docker_cleanup"] = "passed"
            record["cleanup"] = "passed" if record["process_cleanup"] == "passed" else "failed"
        except BaseException:
            record["docker_cleanup"] = "failed"
            record["cleanup"] = "failed"
            if record["outcome"] == "passed":
                record["outcome"] = "failed"
                record["failure_type"] = "CleanupFailed"
            raise
        finally:
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


if __name__ == "__main__":
    main()
