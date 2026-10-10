import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from clientbridge.core.db import Base
from scripts.gen_sync_schema import synced_tables

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "infra/powersync/verification/compose.yaml"
PROJECTIONS = ROOT / "backend/tests/fixtures/sync_projections.json"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def rsa_pair() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return private, public


def signer(
    base: dict[str, str], kid: str, private: str, previous: dict[str, str]
) -> dict[str, str]:
    return {
        **base,
        "ENV": "dev",
        "POWERSYNC_USE_RS256": "true",
        "POWERSYNC_KID": kid,
        "POWERSYNC_PRIVATE_KEY_PEM": private,
        "POWERSYNC_PREVIOUS_PUBLIC_KEYS": json.dumps(previous),
    }


@contextmanager
def api(env: dict[str, str], port: int) -> Iterator[None]:
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "clientbridge.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(port),
        ],
        cwd=ROOT / "backend",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for(lambda: httpx.get(f"http://127.0.0.1:{port}/health", timeout=2).is_success, 30)
        yield
    finally:
        process.terminate()
        process.wait(timeout=10)


def wait_for(check: Callable[[], bool], seconds: float) -> float:
    started = time.monotonic()
    while True:
        try:
            if check():
                return time.monotonic() - started
        except httpx.TransportError:
            pass
        if time.monotonic() - started >= seconds:
            raise RuntimeError(f"condition not met within {seconds:.0f} seconds")
        time.sleep(0.5)


def mint(env: dict[str, str]) -> str:
    return subprocess.check_output(
        [
            sys.executable,
            "-c",
            "from clientbridge.core.security import issue_powersync_token as t; "
            "print(t('us_owner'))",
        ],
        cwd=ROOT / "backend",
        env=env,
        text=True,
    ).strip()


def accepted(sync_url: str, token: str) -> bool:
    with httpx.stream(
        "POST",
        f"{sync_url}/sync/stream",
        json={},
        headers={"Authorization": f"Token {token}"},
        timeout=10,
    ) as response:
        return response.status_code == 200


def rotation_drill(
    sync_url: str, base: dict[str, str], port: int, first: tuple[str, str]
) -> dict[str, float]:
    """Old and new keys overlap across a restart and a second worker; retirement is bounded."""
    second = rsa_pair()
    token_a = mint(signer(base, "rotation-a", first[0], {}))
    timings: dict[str, float] = {}
    overlap = signer(base, "rotation-b", second[0], {"rotation-a": first[1]})
    with api(overlap, port):
        token_b = mint(overlap)
        timings["new key accepted"] = wait_for(lambda: accepted(sync_url, token_b), 120)
        if not accepted(sync_url, token_a):
            raise RuntimeError("a token signed by the previous key failed during the overlap")
        if not accepted(sync_url, mint(overlap)):
            raise RuntimeError("a token signed in another worker process was refused")
    with api(signer(base, "rotation-b", second[0], {}), port):
        timings["retired key refused"] = wait_for(lambda: not accepted(sync_url, token_a), 360)
        if not accepted(sync_url, token_b):
            raise RuntimeError("the current key stopped working after the previous one retired")
    return timings


def main() -> None:
    project = f"cb-sync-test-{uuid.uuid4().hex[:10]}"
    docker = ["docker", "compose", "-f", str(COMPOSE), "-p", project]
    env = dict(os.environ)
    env["SYNC_TEST_PYTHON"] = sys.executable
    env["SYNC_TEST_BACKEND"] = str(ROOT / "backend")
    log_dir = ROOT / ".scratchpad/sync-hardening"
    log_dir.mkdir(parents=True, exist_ok=True)

    def run(args: list[str], *, cwd: Path = ROOT) -> None:
        subprocess.run(args, cwd=cwd, env=env, check=True)

    def port(service: str, inner: str) -> str:
        address = subprocess.check_output(
            [*docker, "port", service, inner], text=True, env=env
        ).strip()
        return address.rsplit(":", 1)[1]

    try:
        run([*docker, "up", "-d", "--wait", "postgres"])
        address = f"127.0.0.1:{port('postgres', '5432')}/clientbridge_test_sync"
        env["ADMIN_DATABASE_URL"] = f"postgresql+asyncpg://verification:verification@{address}"
        env["MIGRATION_DATABASE_URL"] = (
            f"postgresql+asyncpg://clientbridge_migrator:clientbridge_migrator@{address}"
        )
        env["DATABASE_URL"] = f"postgresql+asyncpg://clientbridge_api:clientbridge_api@{address}"
        backend = ROOT / "backend"
        run([sys.executable, "-m", "scripts.db_access", "roles"], cwd=backend)
        run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=backend)
        run([sys.executable, "-m", "scripts.db_access", "grants"], cwd=backend)
        run([sys.executable, "-m", "scripts.sync_fixtures"], cwd=backend)
        api_port = free_port()
        first = rsa_pair()
        config = Path(tempfile.mkdtemp()) / "powersync.yaml"
        config.write_text(
            (COMPOSE.parent / "powersync.yaml")
            .read_text()
            .replace(
                "  audience: [powersync]",
                f"  jwks_uri: http://host.docker.internal:{api_port}/sync/keys\n"
                "  audience: [powersync]",
            )
        )
        env["SYNC_TEST_CONFIG"] = str(config)
        current = signer(env, "rotation-a", first[0], {})
        with api(current, api_port):
            run([*docker, "up", "-d", "powersync"])
            env["SYNC_TEST_URL"] = f"http://127.0.0.1:{port('powersync', '8080')}"
            deadline = time.monotonic() + 60
            while True:
                try:
                    response = httpx.get(f"{env['SYNC_TEST_URL']}/probes/readiness", timeout=2)
                    if response.is_success:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("verification PowerSync did not become ready in 60 seconds")
                time.sleep(0.5)
            now = int(time.time())
            env["SYNC_TEST_TOKENS"] = json.dumps(
                {
                    role: jwt.encode(
                        {"sub": f"us_{role}", "aud": "powersync", "iat": now, "exp": now + 600},
                        "verification-only-sync-secret-not-production",
                        algorithm="HS256",
                        headers={"kid": "verification"},
                    )
                    for role in ("owner", "admin", "staff", "contractor", "multi", "foreign")
                }
            )
            env["SYNC_TEST_MODEL"] = json.dumps(
                {
                    table: [c.name for c in Base.metadata.tables[table].c]
                    for table in synced_tables()
                }
            )
            env["SYNC_TEST_PROJECTIONS"] = PROJECTIONS.read_text()
            run(
                ["pnpm", "exec", "playwright", "test", "-c", "packages/sync/playwright.config.ts"],
                cwd=ROOT / "frontend",
            )
            if not accepted(env["SYNC_TEST_URL"], mint(current)):
                raise RuntimeError("PowerSync does not accept the current signing key")
        timings = rotation_drill(env["SYNC_TEST_URL"], env, api_port, first)
        print("signing-key rotation:", json.dumps(timings))
        env["POWERSYNC_URL"] = env["SYNC_TEST_URL"]
        run([sys.executable, "-m", "scripts.replication_health"], cwd=backend)
    finally:
        with (log_dir / "service-verification.log").open("w") as log:
            subprocess.run(
                [*docker, "logs", "--no-color"],
                stdout=log,
                stderr=subprocess.STDOUT,
                check=False,
                env=env,
            )
        subprocess.run([*docker, "down", "-v", "--remove-orphans"], check=True, env=env)


if __name__ == "__main__":
    main()
