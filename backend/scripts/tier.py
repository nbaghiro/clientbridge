"""The shared test tier: long-running services that every suite, run and worktree reuses."""

import argparse
import base64
import fcntl
import hashlib
import json
import os
import random
import shutil
import signal
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import IO, cast

import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory

from clientbridge.core.config import Settings

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
TIER = Path(os.environ.get("TEST_TIER_DIR") or Path.home() / ".cache" / "clientbridge-test")
PROJECT = "clientbridge-test"
DATABASE = "clientbridge_test_e2e"
PORTS = {
    "postgres": 8760,
    "redis": 8761,
    "s3": 8762,
    "mailpit": 8763,
    "smtp": 8764,
    "auth": 8765,
    "auth_admin": 8766,
    "powersync": 8767,
    "stripe_mock": 8768,
    "relay": 8769,
}
SLOTS = 6
# each slot owns three fixed origins (web, pseudo-locale web, admin) that Kratos lists up front
FIRST_ORIGIN = 8770
RELAY_IMAGE = "python@sha256:bf12ecc0bea3f171d55145dd02c78b5eeb09f30ee2ac9cc2b4c9e4e8f5e30741"
NATIVE_RETURN = "clientbridge://auth/callback"
DEFAULTS = Settings.model_fields
# Mailpit refuses only the reserved .invalid domain, so a case can meet a real provider refusal
_INVALID = "invalid"
DELIVERABLE = "(?i)^(?:[^@]*@[^.]*|.+\\.(?:{}))$".format(
    "|".join(
        [f"{_INVALID[:i]}[^{_INVALID[i]}.][^.]*" for i in range(len(_INVALID))]
        + [f"{_INVALID}[^.]+"]
        + [_INVALID[:i] for i in range(1, len(_INVALID))]
    )
)


def default(name: str) -> str:
    return str(DEFAULTS[name].get_default(call_default_factory=True))


def origins(slot: int) -> tuple[int, int, int]:
    first = FIRST_ORIGIN + 3 * slot
    return first, first + 1, first + 2


def every_origin() -> list[str]:
    return [f"http://localhost:{port}" for slot in range(SLOTS) for port in origins(slot)]


def database_url(role: str, database: str = DATABASE) -> str:
    return f"postgresql+asyncpg://{role}:{role}@localhost:{PORTS['postgres']}/{database}"


def environment(database: str = DATABASE) -> dict[str, str]:
    """The settings any process needs to use the tier's services."""
    auth = f"http://localhost:{PORTS['auth']}"
    return {
        "ADMIN_DATABASE_URL": database_url("clientbridge", database),
        "MIGRATION_DATABASE_URL": database_url("clientbridge_migrator", database),
        "DATABASE_URL": database_url("clientbridge_api", database),
        "REDIS_URL": f"redis://localhost:{PORTS['redis']}/0",
        "S3_ENDPOINT": f"http://localhost:{PORTS['s3']}",
        "SMTP_URL": f"smtp://localhost:{PORTS['smtp']}",
        "MAILPIT_URL": f"http://localhost:{PORTS['mailpit']}",
        "AUTH_PUBLIC_URL": auth,
        "AUTH_INTERNAL_URL": auth,
        "AUTH_ADMIN_URL": f"http://localhost:{PORTS['auth_admin']}",
        "VITE_AUTH_URL": auth,
        "VITE_POWERSYNC_URL": f"http://localhost:{PORTS['powersync']}",
        "POWERSYNC_URL": f"http://localhost:{PORTS['powersync']}",
        "STRIPE_MOCK_URL": f"http://localhost:{PORTS['stripe_mock']}",
    }


def digest(*paths: Path) -> str:
    hashed = hashlib.sha256()
    for path in paths:
        for file in sorted(
            p for p in ([path] if path.is_file() else path.rglob("*")) if p.is_file()
        ):
            hashed.update(str(file.relative_to(ROOT)).encode())
            hashed.update(file.read_bytes())
    return hashed.hexdigest()[:16]


def configuration() -> str:
    """The services as configured, so editing this script alone never forces a rebuild."""
    spec = json.dumps([compose_spec(), powersync_config()], sort_keys=True)
    return hashlib.sha256(spec.encode()).hexdigest()[:16]


def fingerprint() -> dict[str, str]:
    """What the tier's database and services were built from; other code must not use it."""
    scripts = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    return {
        "migrations": ",".join(sorted(scripts.get_heads())),
        "sync_rules": digest(ROOT / "infra" / "powersync" / "sync-rules.yaml"),
        "auth": digest(*sorted(p for p in (ROOT / "infra" / "auth").iterdir() if p.is_file())),
        "tier": configuration(),
        "relay": digest(ROOT / "infra" / "test" / "relay.py"),
    }


def images() -> dict[str, str]:
    base = cast(
        dict[str, dict[str, dict[str, object]]],
        json.loads(
            subprocess.check_output(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(ROOT / "docker-compose.yml"),
                    "--profile",
                    "test",
                    "config",
                    "--format",
                    "json",
                ],
                cwd=ROOT,
            )
        ),
    )
    return {
        name: str(service["image"])
        for name, service in base["services"].items()
        if "image" in service
    }


def compose_spec() -> dict[str, object]:
    pins = images()
    config = TIER / "config"
    secret = default("auth_email_hook_secret")
    every = every_origin()
    web = f"http://localhost:{origins(0)[0]}"
    auth_dsn = "postgres://auth:auth@postgres:5432/auth?sslmode=disable"
    auth_environment = {
        "DSN": auth_dsn,
        "SERVE_PUBLIC_BASE_URL": f"http://localhost:{PORTS['auth']}/",
        "SECRETS_COOKIE": "clientbridge-test-cookie-secret-not-for-deploys",
        "SECRETS_CIPHER": "clientbridge-test-cipher-key-032",
        "COURIER_HTTP_REQUEST_CONFIG_URL": "http://relay:8080/courier",
        "COURIER_HTTP_REQUEST_CONFIG_AUTH_CONFIG_VALUE": secret,
        "SELFSERVICE_METHODS_PASSWORD_CONFIG_HAVEIBEENPWNED_ENABLED": "false",
        "SERVE_PUBLIC_CORS_ALLOWED_ORIGINS": ",".join(every),
        "SELFSERVICE_ALLOWED_RETURN_URLS": ",".join([*every, NATIVE_RETURN]),
        "SELFSERVICE_DEFAULT_BROWSER_RETURN_URL": f"{web}/",
        "SELFSERVICE_METHODS_WEBAUTHN_CONFIG_RP_ORIGINS": ",".join(every),
        "SELFSERVICE_FLOWS_VERIFICATION_AFTER_DEFAULT_BROWSER_RETURN_URL": web,
        "SELFSERVICE_FLOWS_LOGOUT_AFTER_DEFAULT_BROWSER_RETURN_URL": f"{web}/login",
    }
    # a browser flow's own return_to wins; these only serve links opened outside a run's origin
    for flow, path in {
        "ERROR": "auth-error",
        "LOGIN": "login",
        "REGISTRATION": "signup",
        "VERIFICATION": "verify",
        "RECOVERY": "recover",
        "SETTINGS": "setup/security",
    }.items():
        auth_environment[f"SELFSERVICE_FLOWS_{flow}_UI_URL"] = f"{web}/{path}"
    host = ["host.docker.internal:host-gateway"]
    services: dict[str, dict[str, object]] = {
        "postgres": {
            "image": pins["postgres"],
            # a disposable tier: durability settings are traded for speed, and a crash means a reset
            "command": [
                "postgres",
                "-c",
                "wal_level=logical",
                "-c",
                "max_replication_slots=4",
                "-c",
                "max_connections=400",
                "-c",
                "fsync=off",
                "-c",
                "synchronous_commit=off",
                "-c",
                "full_page_writes=off",
            ],
            "environment": {
                "POSTGRES_USER": "clientbridge",
                "POSTGRES_PASSWORD": "clientbridge",
                "POSTGRES_DB": "clientbridge",
            },
            "ports": [f"127.0.0.1:{PORTS['postgres']}:5432"],
            "volumes": ["pgdata:/var/lib/postgresql/data"],
            "healthcheck": {
                "test": ["CMD-SHELL", "pg_isready -U clientbridge -d clientbridge"],
                "interval": "1s",
                "timeout": "3s",
                "retries": 60,
            },
        },
        "redis": {"image": pins["redis"], "ports": [f"127.0.0.1:{PORTS['redis']}:6379"]},
        "s3": {
            "image": pins["s3"],
            "environment": {
                "RUSTFS_ACCESS_KEY": default("s3_access_key"),
                "RUSTFS_SECRET_KEY": default("s3_secret_key"),
                "RUSTFS_CORS_ALLOWED_ORIGINS": "*",
            },
            "ports": [f"127.0.0.1:{PORTS['s3']}:9000"],
            "volumes": ["s3data:/data"],
        },
        "mailpit": {
            "image": pins["mailpit"],
            "environment": {"MP_SMTP_ALLOWED_RECIPIENTS": DELIVERABLE},
            "ports": [
                f"127.0.0.1:{PORTS['mailpit']}:8025",
                f"127.0.0.1:{PORTS['smtp']}:1025",
            ],
        },
        "stripe-mock": {
            "image": pins["stripe-mock"],
            "ports": [f"127.0.0.1:{PORTS['stripe_mock']}:12111"],
        },
        "relay": {
            "image": RELAY_IMAGE,
            "command": ["python", "/config/relay.py"],
            "volumes": [f"{config / 'relay.py'}:/config/relay.py:ro", f"{TIER / 'runs'}:/runs:ro"],
            "extra_hosts": host,
            "ports": [f"127.0.0.1:{PORTS['relay']}:8080"],
            "healthcheck": {
                "test": [
                    "CMD",
                    "python",
                    "-c",
                    "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/health')",
                ],
                "interval": "1s",
                "timeout": "3s",
                "retries": 30,
            },
        },
        "auth-migrate": {
            "image": pins["auth"],
            "environment": {"DSN": auth_dsn},
            "command": ["migrate", "sql", "up", "-e", "--yes"],
        },
        "auth": {
            "image": pins["auth"],
            "environment": auth_environment,
            "volumes": [f"{config / 'auth'}:/etc/config/auth:ro"],
            "command": ["serve", "-c", "/etc/config/auth/kratos.yml", "--dev", "--watch-courier"],
            "ports": [
                f"127.0.0.1:{PORTS['auth']}:4433",
                f"127.0.0.1:{PORTS['auth_admin']}:4434",
            ],
            "healthcheck": {
                "test": [
                    "CMD-SHELL",
                    "wget -qO- http://127.0.0.1:4434/admin/health/ready || exit 1",
                ],
                "interval": "1s",
                "timeout": "3s",
                "retries": 60,
            },
        },
        "powersync": {
            "image": pins["powersync"],
            "volumes": [f"{config / 'powersync'}:/config:ro"],
            "environment": {"POWERSYNC_CONFIG_PATH": "/config/powersync.json"},
            "command": ["start", "-r", "unified"],
            "ports": [f"127.0.0.1:{PORTS['powersync']}:8080"],
        },
    }
    return {"name": PROJECT, "services": services, "volumes": {"pgdata": {}, "s3data": {}}}


def powersync_config() -> dict[str, object]:
    secret = default("jwt_secret").encode()
    return {
        "replication": {
            "connections": [
                {
                    "type": "postgresql",
                    "uri": f"postgresql://powersync_source:powersync_source@postgres:5432/{DATABASE}",
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
                        "kid": default("powersync_kid"),
                        "k": base64.urlsafe_b64encode(secret).decode().rstrip("="),
                    }
                ]
            },
            # runs that sign with rotating RS256 keys publish them through the relay
            "jwks_uri": "http://relay:8080/keys",
            "block_local_jwks": False,
            "audience": [default("powersync_audience")],
        },
    }


def write_config() -> None:
    config = TIER / "config"
    shutil.rmtree(config, ignore_errors=True)
    shutil.copytree(ROOT / "infra" / "auth", config / "auth")
    (config / "powersync").mkdir(parents=True)
    shutil.copy(ROOT / "infra" / "powersync" / "sync-rules.yaml", config / "powersync")
    (config / "powersync" / "powersync.json").write_text(json.dumps(powersync_config(), indent=2))
    shutil.copy(ROOT / "infra" / "test" / "relay.py", config / "relay.py")
    (TIER / "runs").mkdir(parents=True, exist_ok=True)
    (TIER / "compose.json").write_text(json.dumps(compose_spec(), indent=2))


def compose(*arguments: str, capture: bool = False) -> str:
    command = ["docker", "compose", "-p", PROJECT, "-f", str(TIER / "compose.json"), *arguments]
    result = subprocess.run(command, cwd=TIER, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def running() -> set[str]:
    if not (TIER / "compose.json").is_file():
        return set()
    listed = compose("ps", "--status", "running", "--services", capture=True)
    return set(listed.split())


def healthy() -> bool:
    try:
        checks = [
            f"http://localhost:{PORTS['auth_admin']}/admin/health/ready",
            f"http://localhost:{PORTS['relay']}/health",
            f"http://localhost:{PORTS['mailpit']}/api/v1/info",
            f"http://localhost:{PORTS['powersync']}/probes/liveness",
        ]
        return all(httpx.get(url, timeout=3).is_success for url in checks)
    except httpx.HTTPError:
        return False


def recorded() -> dict[str, str] | None:
    path = TIER / "fingerprint.json"
    return cast(dict[str, str], json.loads(path.read_text())) if path.is_file() else None


def backend(command: list[str], env: dict[str, str], log: IO[str] | None = None) -> None:
    subprocess.run(
        [sys.executable, "-m", *command],
        cwd=BACKEND,
        env=os.environ | env,
        check=True,
        stdout=log or sys.stderr,
        stderr=subprocess.STDOUT,
    )


def wait_healthy(seconds: float = 120) -> None:
    deadline = time.monotonic() + seconds
    while not healthy():
        if time.monotonic() > deadline:
            raise SystemExit(
                f"the test tier did not become healthy; see `docker compose -p {PROJECT} logs`"
            )
        time.sleep(1)


def start() -> None:
    """Bring the tier up for this checkout's migrations, sync rules and auth configuration."""
    write_config()
    compose("up", "-d", "--wait", "postgres", "redis", "s3", "mailpit", "stripe-mock", "relay")
    env = environment()
    backend(["scripts.db_access", "roles"], env)
    backend(["alembic", "upgrade", "head"], env)
    backend(["scripts.db_access", "grants"], env)
    compose("run", "--rm", "auth-migrate")
    compose("up", "-d", "--wait", "auth", "powersync")
    wait_healthy()
    (TIER / "fingerprint.json").write_text(json.dumps(fingerprint(), indent=2))


def destroy() -> None:
    if (TIER / "compose.json").is_file():
        compose("down", "--volumes", "--remove-orphans")
    for leftover in ("fingerprint.json", "runs"):
        path = TIER / leftover
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()


def refresh_relay() -> None:
    """Swap in a changed relay without a rebuild; the courier retries mail sent meanwhile."""
    shutil.copy(ROOT / "infra" / "test" / "relay.py", TIER / "config" / "relay.py")
    compose("restart", "relay")
    found = recorded() or {}
    found["relay"] = fingerprint()["relay"]
    (TIER / "fingerprint.json").write_text(json.dumps(found, indent=2))


def differences(current: dict[str, str], found: dict[str, str] | None) -> list[str]:
    if found is None:
        return ["the tier has never been started"]
    return [name for name in current if current[name] != found.get(name)]


@contextmanager
def hold() -> Iterator[None]:
    """Use the tier: start or rebuild it when nobody else is, otherwise require it to match."""
    TIER.mkdir(parents=True, exist_ok=True)
    with (TIER / "tier.lock").open("a") as handle:
        current = fingerprint()
        if differences(current, recorded()) == ["relay"] and running():
            refresh_relay()
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            alone = True
        except BlockingIOError:
            fcntl.flock(handle, fcntl.LOCK_SH)
            alone = False
        if alone:
            stale = differences(current, recorded())
            up = running()
            if stale and up:
                print(
                    f"Rebuilding the test tier for this checkout: {', '.join(stale)}",
                    file=sys.stderr,
                )
                destroy()
                start()
            elif stale or not up or not healthy():
                start()
            fcntl.flock(handle, fcntl.LOCK_SH)
        else:
            stale = differences(current, recorded())
            if stale:
                raise SystemExit(
                    f"the test tier was built from other code ({', '.join(stale)}) and is in use; "
                    "wait for those runs, then retry"
                )
            wait_healthy(30)
        yield


@dataclass(frozen=True)
class Lease:
    slot: int
    namespace: str

    @property
    def web_port(self) -> int:
        return origins(self.slot)[0]

    @property
    def pseudo_port(self) -> int:
        return origins(self.slot)[1]

    @property
    def admin_port(self) -> int:
        return origins(self.slot)[2]

    @property
    def redis_url(self) -> str:
        # database 0 is left to processes outside any run
        return f"redis://localhost:{PORTS['redis']}/{self.slot + 1}"

    @property
    def bucket(self) -> str:
        return f"e2e-{self.namespace}"

    def register(self, api: str, *, keys: bool = False) -> None:
        """Tell the relay where this run's API answers, so its auth mail reaches it."""
        record = {"api": api.replace("localhost", "host.docker.internal"), "keys": keys}
        path = TIER / "runs" / f"{self.namespace}.json"
        # written whole and renamed, so the relay never reads half a record
        partial = path.with_suffix(".tmp")
        partial.write_text(json.dumps({**record, "slot": self.slot, "pid": os.getpid()}))
        partial.replace(path)


def held(path: Path) -> bool:
    """Whether a live process holds this lock file; a crashed holder's lock is released."""
    if not path.exists():
        return False
    with path.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(handle, fcntl.LOCK_UN)
        return False


def slot_held(slot: int) -> bool:
    return held(TIER / "slots" / f"{slot}.lock")


def namespace_held(namespace: str) -> bool:
    return held(TIER / "namespaces" / f"{namespace}.lock")


def stale_namespaces() -> list[str]:
    """Registered namespaces no live run holds: their run ended without cleaning up."""
    return [path.stem for path in (TIER / "runs").glob("*.json") if not namespace_held(path.stem)]


def listeners(port: int) -> list[int]:
    found = subprocess.run(
        ["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True
    )
    return [int(pid) for pid in found.stdout.split()]


def clear_ports(slot: int) -> None:
    """Free a slot's fixed origins: the slot lock proves no live run owns what listens there."""
    for port in origins(slot):
        for pid in listeners(port):
            command = subprocess.run(
                ["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True
            ).stdout.strip()
            # only a web server an interrupted run left behind; anything else is a person's to stop
            if "vite" not in command or "clientbridge" not in command:
                raise RuntimeError(f"port {port} of test slot {slot} is held by: {command}")
            print(f"Stopping a leftover web server on :{port}: {command}", file=sys.stderr)
            with suppress(ProcessLookupError):
                os.killpg(os.getpgid(pid), signal.SIGTERM)
        deadline = time.monotonic() + 10
        while listeners(port) and time.monotonic() < deadline:
            time.sleep(0.2)
        for pid in listeners(port):
            with suppress(ProcessLookupError):
                os.killpg(os.getpgid(pid), signal.SIGKILL)


def claim(handle: IO[str]) -> bool:
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    return True


@contextmanager
def lease(*, poll_seconds: float = 5) -> Iterator[Lease]:
    """Hold one of the tier's run slots and a namespace, each locked for the run's whole life."""
    for folder in ("slots", "runs", "namespaces"):
        (TIER / folder).mkdir(parents=True, exist_ok=True)
    waiting = False
    while True:
        for slot in range(SLOTS):
            with ExitStack() as held_locks:
                handle = held_locks.enter_context((TIER / "slots" / f"{slot}.lock").open("a"))
                if not claim(handle):
                    continue
                namespace = ""
                for _ in range(1000):
                    candidate = f"{random.randrange(10_000):04d}"
                    # a registered namespace may be a crashed run's data, purged only by its reaper
                    if (TIER / "runs" / f"{candidate}.json").exists():
                        continue
                    lock = held_locks.enter_context(
                        (TIER / "namespaces" / f"{candidate}.lock").open("a")
                    )
                    if claim(lock):
                        namespace = candidate
                        break
                if not namespace:
                    raise RuntimeError("no free namespace; reap the stale ones")
                clear_ports(slot)
                try:
                    yield Lease(slot, namespace)
                finally:
                    (TIER / "runs" / f"{namespace}.json").unlink(missing_ok=True)
                    clear_ports(slot)
                return
        if not waiting:
            print(
                f"Waiting for one of the test tier's {SLOTS} run slots", file=sys.stderr, flush=True
            )
            waiting = True
        time.sleep(poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["up", "reset", "down", "status", "env"])
    args = parser.parse_args()
    if args.action == "env":
        for name, value in environment().items():
            print(f"{name}={value}")
        return
    if args.action == "status":
        current = fingerprint()
        print(
            json.dumps(
                {
                    "running": sorted(running()),
                    "healthy": healthy(),
                    "stale": differences(current, recorded()),
                },
                indent=2,
            )
        )
        return
    TIER.mkdir(parents=True, exist_ok=True)
    with (TIER / "tier.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.action == "up":
                fcntl.flock(handle, fcntl.LOCK_SH)
                if differences(fingerprint(), recorded()):
                    raise SystemExit(
                        "the test tier is in use and was built from other code"
                    ) from None
                return
            raise SystemExit("runs are using the test tier; wait for them to finish") from None
        if args.action == "down":
            destroy()
        elif args.action == "reset":
            destroy()
            start()
        elif differences(fingerprint(), recorded()) or not running() or not healthy():
            if differences(fingerprint(), recorded()) and running():
                destroy()
            start()
    print(
        f"The test tier is up: Postgres :{PORTS['postgres']}, Mailpit :{PORTS['mailpit']}, "
        f"auth :{PORTS['auth']}, PowerSync :{PORTS['powersync']}."
    )


if __name__ == "__main__":
    main()
