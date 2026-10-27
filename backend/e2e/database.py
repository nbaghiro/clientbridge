"""Run a command against its own copies of a migrated database seeded at the frozen instant."""

import asyncio
import fcntl
import os
import secrets
import subprocess
import sys
from pathlib import Path

from scripts.db_access import quote
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import create_async_engine
from tests.clock import FROZEN

from e2e import tier

# templates other checkouts may still be using; older ones are dropped
KEPT_TEMPLATES = 4


async def admin(statement: str) -> None:
    url = on(tier.environment()["ADMIN_DATABASE_URL"], "postgres")
    engine = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        await conn.execute(text(statement))
    await engine.dispose()


async def admin_values(statement: str) -> list[str]:
    url = on(tier.environment()["ADMIN_DATABASE_URL"], "postgres")
    engine = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        found = [str(row[0]) for row in await conn.execute(text(statement))]
    await engine.dispose()
    return found


def on(url: str | URL, database: str) -> str:
    return make_url(url).set(database=database).render_as_string(hide_password=False)


def run(command: list[str], env: dict[str, str]) -> None:
    subprocess.run(command, env=env, check=True, stdout=sys.stderr)


def seed_sources() -> list[Path]:
    """What a seeded database is built from: the migrations and the demo seed's code and assets."""
    scripts = tier.BACKEND / "scripts"
    return [
        tier.BACKEND / "migrations",
        *sorted(scripts.glob("demo_*.py")),
        scripts / "seed_demo.py",
        scripts / "demo_assets",
    ]


def template_name() -> str:
    """One seeded template per migrations, seed code and frozen instant."""
    found = tier.digest(*seed_sources(), tier.BACKEND / "tests" / "clock.py")
    return f"clientbridge_test_tpl_{found[:12]}"


def build_template(name: str) -> None:
    python = [sys.executable, "-m"]
    env = os.environ | tier.environment(name)
    asyncio.run(admin(f"CREATE DATABASE {quote(name)}"))
    try:
        run([*python, "scripts.db_access", "roles"], env)
        run([*python, "alembic", "upgrade", "head"], env)
        run([*python, "scripts.db_access", "grants"], env)
        run([*python, "scripts.seed_demo", "--core", "--as-of", FROZEN.isoformat()], env)
    except BaseException:
        asyncio.run(admin(f"DROP DATABASE IF EXISTS {quote(name)} WITH (FORCE)"))
        raise
    asyncio.run(
        admin(f"ALTER DATABASE {quote(name)} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false")
    )


def prune_templates(current: str) -> None:
    names = asyncio.run(
        admin_values(
            "SELECT datname FROM pg_database WHERE datname LIKE 'clientbridge_test_tpl_%' "
            "ORDER BY oid DESC"
        )
    )
    for name in [found for found in names if found != current][KEPT_TEMPLATES - 1 :]:
        asyncio.run(admin(f"ALTER DATABASE {quote(name)} WITH IS_TEMPLATE false"))
        asyncio.run(admin(f"DROP DATABASE IF EXISTS {quote(name)} WITH (FORCE)"))


def ensure_template() -> str:
    """Seed the template once per fingerprint; concurrent callers wait for the first."""
    name = template_name()
    with (tier.TIER / "templates.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not asyncio.run(admin_values(f"SELECT 1 FROM pg_database WHERE datname = '{name}'")):
            build_template(name)
            prune_templates(name)
    return name


def worker_count() -> int:
    """One pytest-xdist worker per core, up to eight, unless TEST_WORKERS names a count."""
    return int(os.environ.get("TEST_WORKERS") or min(os.cpu_count() or 1, 8))


async def copy_databases(template: str, names: list[str]) -> None:
    await asyncio.gather(
        *(admin(f"CREATE DATABASE {quote(name)} TEMPLATE {quote(template)}") for name in names)
    )


async def drop_databases(names: list[str]) -> None:
    await asyncio.gather(
        *(admin(f"DROP DATABASE IF EXISTS {quote(name)} WITH (FORCE)") for name in names)
    )


def main(command: list[str]) -> int:
    with tier.hold():
        template = ensure_template()
        # its own copies, so other suites and e2e runs on this machine cannot touch them
        database = f"clientbridge_test_{secrets.token_hex(4)}"
        workers = worker_count()
        # each pytest-xdist worker opens <database>_gw<n> (tests/__init__.py)
        copies = [database, *(f"{database}_gw{index}" for index in range(workers))]
        try:
            asyncio.run(copy_databases(template, copies))
            env = os.environ | tier.environment(database)
            env["PYTEST_XDIST_AUTO_NUM_WORKERS"] = str(workers)
            # the suite builds deployed Settings from this environment, which refuse a dev mailer
            env.pop("SMTP_URL")
            return subprocess.run(command, env=env, check=False).returncode
        finally:
            asyncio.run(drop_databases(copies))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
