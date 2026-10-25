"""Run functional browsers against services owned by one disposable Compose project."""

import argparse
import base64
import hashlib
import json
import os
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
from typing import IO, Literal, cast

import httpx

from clientbridge.core import clock
from clientbridge.core.config import Settings
from clientbridge.core.zones import zone
from scripts.e2e_results import REQUIRED_CASES, Report

ROOT = Path(__file__).resolve().parents[2]


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
    ) -> None:
        self.directory = directory
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
        services["s3"]["environment"] = {
            "RUSTFS_ACCESS_KEY": "rustfs",
            "RUSTFS_SECRET_KEY": "rustfs-dev-secret",
            "RUSTFS_CORS_ALLOWED_ORIGINS": "*",
        }
        services["auth"]["ports"] = [f"127.0.0.1:{self.auth_port}:4433", "127.0.0.1::4434"]
        auth_environment = {
            "SERVE_PUBLIC_BASE_URL": f"http://localhost:{self.auth_port}/",
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
        wait_for(f"{self.api}/ready")
        if browser_fixtures:
            self.command([sys.executable, "-m", "scripts.web_fixtures"], log)
        self.command([sys.executable, "-m", "scripts.sync_caught_up"], log)

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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--configure-only", action="store_true")
    parser.add_argument("--cleanup")
    parser.add_argument(
        "--surface", choices=("web", "connect", "journeys", "filings"), default="web"
    )
    parser.add_argument("--seed-as-of", type=seed_timestamp)
    parser.add_argument("--project", choices=("default", "pseudo"), default="default")
    parser.add_argument("--allow-source-changes", action="store_true")
    parser.add_argument("tests", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.allow_source_changes and os.environ.get("CI"):
        parser.error("CI cannot accept source changes during a run")
    if args.surface in ("journeys", "filings") and args.project != "default":
        parser.error("journeys and filings use the default project")
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
    stack = Stack(directory, args.project, seed_as_of=anchor)
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
        "tests": args.tests,
        "source": source_snapshot(),
        "outcome": "running",
        "cleanup": "pending",
        "process_cleanup": "pending",
        "docker_cleanup": "pending",
        "allow_source_changes": args.allow_source_changes,
    }
    metadata = directory / "run.json"
    metadata.write_text(json.dumps(record, indent=2))
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    try:
        with owned_processes(record) as processes, (directory / "setup.log").open("wb") as log:
            stack.start(processes, log)
            if args.surface == "connect":
                stack.env["CONNECT_LINKS"] = subprocess.check_output(
                    [sys.executable, "-m", "scripts.connect_links"],
                    cwd=ROOT / "backend",
                    env=stack.env,
                    text=True,
                )
            command = [
                "pnpm",
                "--filter",
                "web" if args.surface in ("journeys", "filings") else args.surface,
                "exec",
                "playwright",
                "test",
                *(
                    [f"--config=playwright.{args.surface}.config.ts"]
                    if args.surface in ("journeys", "filings")
                    else []
                ),
                f"--project={args.project}",
                *args.tests,
            ]
            with (directory / "browser.log").open("wb") as browser_log:
                stack.command(command, browser_log, frontend=True)
            report = directory / "browser-results" / "results.json"
            required = (
                [] if args.tests or args.project != "default" else REQUIRED_CASES[args.surface]
            )
            Report.model_validate_json(report.read_text()).validate_evidence(required)
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
