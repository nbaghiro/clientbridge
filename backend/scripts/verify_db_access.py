"""Migrate two environments on one disposable Postgres, each with its own Cloud SQL style admin."""

import asyncio
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import NamedTuple

from asyncpg.exceptions import InsufficientPrivilegeError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from scripts.db_access import literal, quote
from scripts.gen_sync_schema import published_columns, synced_tables

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
TABLES = (
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relkind = 'r'"
)
ROLES = (
    "clientbridge_api",
    "clientbridge_migrator",
    "powersync_source",
    "powersync_storage_owner",
    "auth",
)
SERVICE_URLS = (
    "POWERSYNC_SOURCE_DATABASE_URL",
    "POWERSYNC_STORAGE_DATABASE_URL",
    "AUTH_DATABASE_URL",
)


class Environment(NamedTuple):
    prefix: str
    admin: str

    def name(self, base: str) -> str:
        return f"{self.prefix}{base}"

    @property
    def app(self) -> str:
        return self.name("clientbridge")

    @property
    def databases(self) -> tuple[str, str, str]:
        return self.app, self.name("powersync_storage"), self.name("auth")


# production keeps the default names, so it also covers the defaults; staging names every URL
PRODUCTION = Environment("", "prod_admin")
STAGING = Environment("staging_", "staging_admin")


def image() -> str:
    found = re.search(
        r"image: (postgres:16@sha256:[0-9a-f]+)", (ROOT / "docker-compose.yml").read_text()
    )
    if found is None:
        raise RuntimeError("docker-compose.yml has no pinned postgres:16 image")
    return found.group(1)


def url(address: str, role: str, database: str) -> str:
    return f"postgresql+asyncpg://{role}:{role}@{address}/{database}"


def environ(address: str, env: Environment) -> dict[str, str]:
    values = {k: v for k, v in os.environ.items() if k not in SERVICE_URLS}
    values |= {
        "ADMIN_DATABASE_URL": url(address, env.admin, env.app),
        "MIGRATION_DATABASE_URL": url(address, env.name("clientbridge_migrator"), env.app),
        "DATABASE_URL": url(address, env.name("clientbridge_api"), env.app),
        "POWERSYNC_SOURCE_PASSWORD": "powersync_source",
        "POWERSYNC_STORAGE_PASSWORD": "powersync_storage_owner",
        "AUTH_DB_PASSWORD": "auth",
    }
    if env.prefix:
        _, storage, auth = env.databases
        values |= {
            "POWERSYNC_SOURCE_DATABASE_URL": url(address, env.name("powersync_source"), env.app),
            "POWERSYNC_STORAGE_DATABASE_URL": url(
                address, env.name("powersync_storage_owner"), storage
            ),
            "AUTH_DATABASE_URL": f"postgres://{env.name('auth')}:{env.name('auth')}"
            f"@{address}/{auth}?sslmode=disable",
        }
    return values


async def wait_for(target: str) -> None:
    deadline = time.monotonic() + 60
    while True:
        engine = create_async_engine(target)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return
        except (OSError, DBAPIError):
            if time.monotonic() >= deadline:
                raise
            await asyncio.sleep(0.5)
        finally:
            await engine.dispose()


async def execute(target: str, statements: list[str]) -> None:
    engine = create_async_engine(target, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        for statement in statements:
            await conn.execute(text(statement))
    await engine.dispose()


async def names(conn: AsyncConnection, query: str, **params: str) -> set[str]:
    return {str(row[0]) for row in (await conn.execute(text(query), params)).all()}


def check(condition: bool, problem: str, problems: list[str]) -> None:
    if not condition:
        problems.append(problem)


async def verify(address: str, env: Environment) -> list[str]:
    problems: list[str] = []
    migrator, api, source = (
        env.name(r) for r in ("clientbridge_migrator", "clientbridge_api", "powersync_source")
    )
    synced = set(synced_tables())
    engine = create_async_engine(url(address, "bootstrap", env.app))
    async with engine.connect() as conn:
        tables = await names(conn, TABLES)
        check(synced <= tables, f"{env.app}: a synced table is missing", problems)
        foreign = await names(conn, f"{TABLES} AND pg_get_userbyid(c.relowner) <> :m", m=migrator)
        check(
            not foreign, f"{env.app}: tables not owned by {migrator}: {sorted(foreign)}", problems
        )
        unwritable = await names(
            conn,
            f"{TABLES} AND NOT has_table_privilege(:a, c.oid, 'SELECT,INSERT,UPDATE,DELETE')",
            a=api,
        )
        check(not unwritable, f"{env.app}: {api} cannot write {sorted(unwritable)}", problems)
        creates = await conn.scalar(
            text("SELECT has_schema_privilege(:a, 'public', 'CREATE')"), {"a": api}
        )
        check(not creates, f"{env.app}: {api} can create objects in public", problems)
        readable = await names(
            conn, f"{TABLES} AND has_table_privilege(:s, c.oid, 'SELECT')", s=source
        )
        check(
            readable == synced,
            f"{env.app}: {source} reads {sorted(readable ^ synced)} wrongly",
            problems,
        )
        published = {
            str(row.tablename): sorted(row.attnames)
            for row in await conn.execute(
                text(
                    "SELECT tablename, attnames FROM pg_publication_tables "
                    "WHERE pubname = 'powersync'"
                )
            )
        }
        wanted = {table: sorted(columns) for table, columns in published_columns().items()}
        differing = sorted(
            t for t in published.keys() | wanted.keys() if published.get(t) != wanted.get(t)
        )
        check(not differing, f"{env.app}: publication differs on {differing}", problems)
        owner = await conn.scalar(
            text("SELECT pg_get_userbyid(pubowner) FROM pg_publication WHERE pubname = 'powersync'")
        )
        check(owner == migrator, f"{env.app}: the publication is owned by {owner}", problems)
        replication = await conn.scalar(
            text("SELECT rolreplication FROM pg_roles WHERE rolname = :s"), {"s": source}
        )
        check(bool(replication), f"{source} has no REPLICATION", problems)
        app, storage, auth = env.databases
        for database, role in (
            (app, migrator),
            (storage, env.name("powersync_storage_owner")),
            (auth, env.name("auth")),
        ):
            actual = await conn.scalar(
                text("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = :d"),
                {"d": database},
            )
            check(actual == role, f"{database} is owned by {actual}", problems)
    await engine.dispose()
    writer = create_async_engine(url(address, api, env.app))
    async with writer.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO webhooks (id, provider, event, status) "
                "VALUES ('verify', 'stripe', 'event', 'pending')"
            )
        )
        await conn.execute(text("UPDATE webhooks SET status = 'processed' WHERE id = 'verify'"))
        await conn.execute(text("DELETE FROM webhooks WHERE id = 'verify'"))
        await conn.rollback()
    await writer.dispose()
    replica = create_async_engine(url(address, source, env.app))
    async with replica.connect() as conn:
        await conn.execute(text("SELECT pg_create_logical_replication_slot('verify', 'pgoutput')"))
        await conn.execute(text("SELECT pg_drop_replication_slot('verify')"))
    await replica.dispose()
    return problems


def insufficient(error: BaseException) -> bool:
    orig = error.orig if isinstance(error, DBAPIError) else error
    return (
        isinstance(orig, InsufficientPrivilegeError)
        or (getattr(orig, "pgcode", None) or getattr(orig, "sqlstate", None)) == "42501"
    )


async def refused(target: str, statement: str = "SELECT 1") -> bool:
    engine = create_async_engine(target)
    try:
        async with engine.connect() as conn:
            await conn.execute(text(statement))
        return False
    except (DBAPIError, InsufficientPrivilegeError) as error:
        if insufficient(error):
            return True
        raise
    finally:
        await engine.dispose()


async def isolated(address: str) -> list[str]:
    problems: list[str] = []
    for own, other in ((PRODUCTION, STAGING), (STAGING, PRODUCTION)):
        for name in (*(own.name(role) for role in ROLES), own.admin):
            for database in other.databases:
                if not await refused(url(address, name, database)):
                    problems.append(f"{name} can connect to {database}")
        home = url(address, own.admin, own.app)
        for role in ROLES:
            theirs = quote(other.name(role))
            for statement in (
                f"SET ROLE {theirs}",
                f"ALTER ROLE {theirs} PASSWORD 'taken'",
                f"GRANT {theirs} TO CURRENT_USER",
            ):
                if not await refused(home, statement):
                    problems.append(f"{own.admin} ran {statement}")
        engine = create_async_engine(home)
        async with engine.connect() as conn:
            for database in other.databases:
                owns = await conn.scalar(
                    text(
                        "SELECT pg_has_role(current_user, datdba, 'USAGE') "
                        "FROM pg_database WHERE datname = :d"
                    ),
                    {"d": database},
                )
                check(not owns, f"{own.admin} has the owner's rights on {database}", problems)
            member = await conn.scalar(
                text("SELECT pg_has_role(current_user, :o, 'MEMBER')"), {"o": other.admin}
            )
            check(not member, f"{own.admin} is a member of {other.admin}", problems)
        await engine.dispose()
    return problems


def main() -> None:
    name = f"cb-db-access-{uuid.uuid4().hex[:10]}"
    subprocess.run(
        [
            *("docker", "run", "-d", "--name", name, "-p", "127.0.0.1::5432"),
            *("-e", "POSTGRES_USER=bootstrap", "-e", "POSTGRES_PASSWORD=bootstrap"),
            *(image(), "postgres", "-c", "wal_level=logical"),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    try:
        port = subprocess.check_output(["docker", "port", name, "5432"], text=True)
        address = f"127.0.0.1:{port.split(':')[-1].strip()}"
        bootstrap = url(address, "bootstrap", "bootstrap")
        asyncio.run(wait_for(bootstrap))
        # as on Cloud SQL: each admin is a CREATEROLE CREATEDB user outside cloudsqlsuperuser
        asyncio.run(
            execute(
                bootstrap,
                [
                    *(
                        f"CREATE ROLE {e.admin} LOGIN CREATEROLE CREATEDB REPLICATION "
                        f"PASSWORD {literal(e.admin)}"
                        for e in (PRODUCTION, STAGING)
                    ),
                ],
            )
        )
        # production's database is left for db_access to create, staging's exists, made by its admin
        asyncio.run(
            execute(
                url(address, STAGING.admin, "postgres"),
                [f"CREATE DATABASE {STAGING.app}"],
            )
        )
        for env in (PRODUCTION, STAGING):
            for _ in range(2):
                subprocess.run(
                    [sys.executable, "-m", "scripts.migrate"],
                    cwd=BACKEND,
                    env=environ(address, env),
                    check=True,
                )
        problems = [
            *asyncio.run(verify(address, PRODUCTION)),
            *asyncio.run(verify(address, STAGING)),
            *asyncio.run(isolated(address)),
        ]
    finally:
        subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL)
    if problems:
        raise SystemExit("\n".join(problems))
    print("db_access keeps two environments apart, each under its own non-superuser admin")


if __name__ == "__main__":
    main()
