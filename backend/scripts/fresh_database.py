"""Run a command against a migrated, freshly seeded database of its own, dropped afterwards."""

import asyncio
import os
import secrets
import subprocess
import sys

from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import create_async_engine
from tests.clock import FROZEN

from clientbridge.core.config import get_settings
from scripts.db_access import ADMIN_URL, quote


async def admin(statement: str) -> None:
    engine = create_async_engine(on(ADMIN_URL, "postgres"), isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        await conn.execute(text(statement))
    await engine.dispose()


def on(url: str | URL, database: str) -> str:
    return make_url(url).set(database=database).render_as_string(hide_password=False)


def run(command: list[str], env: dict[str, str]) -> None:
    subprocess.run(command, env=env, check=True, stdout=sys.stderr)


def main(command: list[str]) -> int:
    settings = get_settings()
    # its own database, so other suites, the dev API and e2e runs on this machine cannot touch it
    database = f"clientbridge_test_{secrets.token_hex(4)}"
    env = os.environ | {
        "ADMIN_DATABASE_URL": on(ADMIN_URL, database),
        "MIGRATION_DATABASE_URL": on(settings.migration_database_url, database),
        "DATABASE_URL": on(settings.database_url, database),
    }
    python = [sys.executable, "-m"]
    asyncio.run(admin(f"CREATE DATABASE {quote(database)}"))
    try:
        run([*python, "scripts.db_access", "roles"], env)
        run([*python, "alembic", "upgrade", "head"], env)
        run([*python, "scripts.db_access", "grants"], env)
        run([*python, "scripts.seed_demo", "--core", "--as-of", FROZEN.isoformat()], env)
        return subprocess.run(command, env=env, check=False).returncode
    finally:
        asyncio.run(admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)"))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
