import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
import jwt

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "infra/powersync/verification/compose.yaml"


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
        env["DATABASE_URL"] = (
            f"postgresql+asyncpg://verification:verification@127.0.0.1:{port('postgres', '5432')}"
            "/clientbridge_test_sync"
        )
        run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT / "backend")
        run([sys.executable, "-m", "scripts.sync_fixtures"], cwd=ROOT / "backend")
        for sql in (
            "CREATE DATABASE powersync_storage",
            "CREATE PUBLICATION powersync FOR ALL TABLES",
        ):
            run(
                [
                    *docker,
                    "exec",
                    "-T",
                    "postgres",
                    "psql",
                    "-U",
                    "verification",
                    "-d",
                    "clientbridge_test_sync",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-c",
                    sql,
                ]
            )
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
        run(
            ["pnpm", "exec", "playwright", "test", "-c", "packages/sync/playwright.config.ts"],
            cwd=ROOT / "frontend",
        )
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
