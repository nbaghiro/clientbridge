"""Run the pinned Kratos with the deployed environment from auth_env, then the Kratos contract."""

import os
import re
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

from clientbridge.core.deployment import AUTH_COMMAND, SESSION_COOKIE, auth_env

ROOT = Path(__file__).resolve().parents[2]
BASE_DOMAIN = "clientbridge.test"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def image() -> str:
    found = re.search(r"(oryd/kratos@sha256:[0-9a-f]+)", (ROOT / "docker-compose.yml").read_text())
    if found is None:
        raise SystemExit("docker-compose.yml has no pinned Kratos image")
    return found.group(1)


def wait_ready(admin: str) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"{admin}/admin/health/ready", timeout=2).is_success:
                return
        except httpx.TransportError:
            pass
        time.sleep(0.5)
    raise RuntimeError("Kratos did not become ready in 60 seconds")


def check_overrides(public: str) -> None:
    """Kratos replaced the local lists with the deployed ones instead of merging them."""
    app = f"https://app.{BASE_DOMAIN}"
    json = {"Accept": "application/json"}
    flow = httpx.get(
        f"{public}/self-service/login/browser", headers=json, params={"return_to": app}
    )
    if not flow.is_success or not flow.json()["ui"]["action"].startswith(
        f"https://api.{BASE_DOMAIN}/auth/"
    ):
        raise RuntimeError(f"login flow under api.D/auth failed: {flow.status_code}")
    local = httpx.get(
        f"{public}/self-service/login/browser",
        headers=json,
        params={"return_to": "http://localhost:8700/"},
    )
    if local.status_code != 400:
        raise RuntimeError("a local return URL is still allowed")
    for origin, allowed in ((app, True), ("http://localhost:8700", False)):
        cors = httpx.get(f"{public}/sessions/whoami", headers={**json, "Origin": origin})
        if (cors.headers.get("access-control-allow-origin") == origin) != allowed:
            raise RuntimeError(f"CORS for {origin} is not {'allowed' if allowed else 'refused'}")
    preflight = httpx.options(
        f"{public}/self-service/login",
        headers={
            "Origin": app,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )
    if preflight.headers.get("access-control-allow-credentials") != "true" or (
        preflight.headers.get("access-control-max-age") != "600"
    ):
        raise RuntimeError(f"the credentialed preflight is not cached: {preflight.headers}")


def main() -> None:
    public_port, admin_port = free_port(), free_port()
    public, admin = f"http://127.0.0.1:{public_port}", f"http://127.0.0.1:{admin_port}"
    env = auth_env(BASE_DOMAIN, api_url="http://host.docker.internal:8701", admin_url=admin) | {
        "DSN": "memory",
        "SECRETS_COOKIE": secrets.token_hex(16),
        "SECRETS_CIPHER": secrets.token_hex(16),
        "SELFSERVICE_METHODS_PASSWORD_CONFIG_HAVEIBEENPWNED_ENABLED": "false",
    }
    name = f"verify-kratos-{secrets.token_hex(4)}"
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            name,
            "-p",
            f"127.0.0.1:{public_port}:4433",
            "-p",
            f"127.0.0.1:{admin_port}:4434",
            "-v",
            f"{ROOT / 'infra/auth'}:/etc/config/auth:ro",
            *(arg for key, value in env.items() for arg in ("-e", f"{key}={value}")),
            image(),
            *AUTH_COMMAND,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    try:
        wait_ready(admin)
        check_overrides(public)
        contract = os.environ | {
            "AUTH_INTERNAL_URL": public,
            "AUTH_ADMIN_URL": admin,
            "AUTH_SESSION_COOKIE": SESSION_COOKIE,
            "CI": "1",
        }
        command = ["pytest", "-m", "kratos", "-q", "tests/test_auth_kratos.py"]
        subprocess.run(
            [sys.executable, "-m", "e2e.database", *command],
            cwd=ROOT / "backend",
            env=contract,
            check=True,
        )
    finally:
        subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
