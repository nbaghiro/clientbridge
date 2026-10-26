"""Sync streams on the shared test tier: replica rows per role, revocation and key rotation."""

import fcntl
import json
import secrets
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import IO

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from clientbridge.core import clock
from clientbridge.core.db import Base
from scripts import tier
from scripts.e2e_stack import environment, flush_redis, free_port, purge, stop
from scripts.gen_sync_schema import synced_tables

ROOT = Path(__file__).resolve().parents[2]
PROJECTIONS = ROOT / "backend/tests/fixtures/sync_projections.json"
ROLES = ("owner", "admin", "staff", "contractor", "multi", "foreign")


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
        "POWERSYNC_USE_RS256": "true",
        "POWERSYNC_KID": kid,
        "POWERSYNC_PRIVATE_KEY_PEM": private,
        "POWERSYNC_PREVIOUS_PUBLIC_KEYS": json.dumps(previous),
    }


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


class KeyFront:
    """Where the tier's relay reads this run's keys; it swaps APIs with no gap, as a deploy does."""

    def __init__(self, log: IO[bytes]) -> None:
        self.log = log
        self.api: subprocess.Popen[bytes] | None = None
        self.upstream = ""
        front = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                try:
                    response = httpx.get(f"{front.upstream}{self.path}", timeout=10)
                    status, body = response.status_code, response.content
                except httpx.HTTPError as error:
                    status, body = 502, str(error).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: object) -> None:
                pass

        # the relay runs in Docker, so the front answers on every interface, not just loopback
        self.server = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        self.url = f"http://localhost:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def deploy(self, env: dict[str, str]) -> None:
        """Start an API with these keys, send key reads to it, then stop the one it replaces."""
        port = free_port()
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "clientbridge.main:app", "--port", str(port)],
            cwd=ROOT / "backend",
            env=env,
            stdout=self.log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            wait_for(lambda: httpx.get(f"http://localhost:{port}/health", timeout=2).is_success, 30)
        except BaseException:
            stop(process)
            raise
        previous, self.api = self.api, process
        self.upstream = f"http://localhost:{port}"
        if previous is not None:
            stop(previous)

    def close(self) -> None:
        if self.api is not None:
            stop(self.api)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=10)


def mint(env: dict[str, str]) -> str:
    return subprocess.check_output(
        [
            sys.executable,
            "-c",
            "from clientbridge.core.security import issue_powersync_token as t; "
            "from scripts.demo_context import run_id; "
            "print(t(run_id('us_owner')))",
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


def role_tokens(namespace: str) -> dict[str, str]:
    """Tokens signed with the tier's development key, one per fixture identity."""
    now = int(clock.wall().timestamp())
    return {
        role: jwt.encode(
            {
                "sub": f"us_{role}_{namespace}",
                "aud": tier.default("powersync_audience"),
                "iat": now,
                "exp": now + 600,
            },
            tier.default("jwt_secret"),
            algorithm="HS256",
            headers={"kid": tier.default("powersync_kid")},
        )
        for role in ROLES
    }


def rotation_drill(
    sync_url: str, base: dict[str, str], front: KeyFront, first: tuple[str, str], kid: str
) -> dict[str, float]:
    """Keys overlap across a deploy and a second worker, and a JWKS refresh retires the old one."""
    second = rsa_pair()
    token_a = mint(signer(base, f"{kid}-a", first[0], {}))
    timings: dict[str, float] = {}
    overlap = signer(base, f"{kid}-b", second[0], {f"{kid}-a": first[1]})
    front.deploy(overlap)
    token_b = mint(overlap)
    timings["new key accepted"] = wait_for(lambda: accepted(sync_url, token_b), 120)
    if not accepted(sync_url, token_a):
        raise RuntimeError("a token signed by the previous key failed during the overlap")
    if not accepted(sync_url, mint(overlap)):
        raise RuntimeError("a token signed in another worker process was refused")
    unpublished = mint(signer(base, f"{kid}-unpublished", rsa_pair()[0], {}))

    def retired() -> bool:
        # an unknown key ID makes PowerSync re-read the JWKS now rather than at its 5-minute refresh
        if accepted(sync_url, unpublished):
            raise RuntimeError("a token signed by an unpublished key was accepted")
        return not accepted(sync_url, token_a)

    front.deploy(signer(base, f"{kid}-b", second[0], {}))
    if not accepted(sync_url, token_a):
        raise RuntimeError("the previous key was refused before PowerSync re-read the keys")
    timings["retired key refused"] = wait_for(retired, 90)
    if not accepted(sync_url, token_b):
        raise RuntimeError("the current key stopped working after the previous one retired")
    return timings


def verify(lease: tier.Lease, directory: Path, log: IO[bytes]) -> None:
    namespace = lease.namespace
    base = environment() | {
        **tier.environment(),
        "RUN_NAMESPACE": namespace,
        "REDIS_URL": lease.redis_url,
        "S3_BUCKET": lease.bucket,
    }
    sync_url = base["POWERSYNC_URL"]

    def run(arguments: list[str]) -> None:
        subprocess.run(
            arguments, cwd=ROOT / "backend", env=base, check=True, stdout=log, stderr=log
        )

    flush_redis(lease.redis_url)
    run([sys.executable, "-m", "scripts.sync_fixtures"])
    first = rsa_pair()
    kid = f"sync-{namespace}-{secrets.token_hex(4)}"
    current = signer(base, f"{kid}-a", first[0], {})
    front = KeyFront(log)
    try:
        front.deploy(current)
        lease.register(front.url, keys=True)
        timings = {"first key accepted": wait_for(lambda: accepted(sync_url, mint(current)), 120)}
        browser = base | {
            "SYNC_TEST_URL": sync_url,
            "SYNC_TEST_NAMESPACE": namespace,
            "SYNC_TEST_PORT": str(lease.web_port),
            "SYNC_TEST_OUTPUT": str(directory / "browser"),
            "SYNC_TEST_PYTHON": sys.executable,
            "SYNC_TEST_BACKEND": str(ROOT / "backend"),
            "SYNC_TEST_TOKENS": json.dumps(role_tokens(namespace)),
            "SYNC_TEST_MODEL": json.dumps(
                {
                    table: [c.name for c in Base.metadata.tables[table].c]
                    for table in synced_tables()
                }
            ),
            "SYNC_TEST_PROJECTIONS": PROJECTIONS.read_text(),
        }
        with (directory / "browser.log").open("wb") as browser_log:
            subprocess.run(
                ["pnpm", "exec", "playwright", "test", "-c", "packages/sync/playwright.config.ts"],
                cwd=ROOT / "frontend",
                env=browser,
                check=True,
                stdout=browser_log,
                stderr=subprocess.STDOUT,
            )
        if not accepted(sync_url, mint(current)):
            raise RuntimeError("PowerSync does not accept the current signing key")
        timings |= rotation_drill(sync_url, base, front, first, kid)
    finally:
        front.close()
    (directory / "rotation.json").write_text(json.dumps(timings, indent=2) + "\n")
    print("signing-key rotation:", json.dumps(timings), flush=True)
    run([sys.executable, "-m", "scripts.replication_health"])


def main() -> None:
    directory = ROOT / ".scratchpad" / f"sync-{secrets.token_hex(6)}"
    directory.mkdir(parents=True)
    print(f"Sync diagnostics: {directory}", flush=True)
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    with (
        tier.hold(),
        tier.lease() as lease,
        # one drill at a time: a key read another drill forces would retire this one's key early
        (tier.TIER / "sync.lock").open("a") as drill,
        (directory / "setup.log").open("wb") as log,
    ):
        fcntl.flock(drill, fcntl.LOCK_EX)
        (directory / "tier.json").write_text(
            json.dumps({"namespace": lease.namespace, "slot": lease.slot}, indent=2)
        )
        try:
            verify(lease, directory, log)
        finally:
            purge(lease.namespace, lease.redis_url, directory / "purge.json")


if __name__ == "__main__":
    main()
