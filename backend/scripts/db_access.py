"""Least-privilege database roles, grants and the replication publication, applied by an admin."""

import asyncio
import os
import sys

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from clientbridge.core.config import get_settings
from scripts.gen_sync_schema import synced_tables

ADMIN_URL = os.environ.get(
    "ADMIN_DATABASE_URL",
    "postgresql+asyncpg://clientbridge:clientbridge@localhost:8702/clientbridge",
)
STORAGE_DB = "powersync_storage"
MIGRATOR = "clientbridge_migrator"
API = "clientbridge_api"
SOURCE = "powersync_source"
STORAGE = "powersync_storage_owner"


def quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def passwords() -> dict[str, str]:
    settings = get_settings()
    return {
        MIGRATOR: make_url(settings.migration_database_url).password or MIGRATOR,
        API: make_url(settings.database_url).password or API,
        SOURCE: os.environ.get("POWERSYNC_SOURCE_PASSWORD", SOURCE),
        STORAGE: os.environ.get("POWERSYNC_STORAGE_PASSWORD", STORAGE),
    }


async def ensure_role(
    conn: AsyncConnection, role: str, password: str, *, replication: bool
) -> None:
    exists = await conn.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role})
    verb = "ALTER" if exists else "CREATE"
    extra = " REPLICATION" if replication else " NOREPLICATION"
    await conn.execute(
        text(
            f"{verb} ROLE {quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE{extra} "
            f"PASSWORD {literal(password)}"
        )
    )


async def roles(conn: AsyncConnection, database: str) -> None:
    secrets = passwords()
    for role in (MIGRATOR, API, STORAGE):
        await ensure_role(conn, role, secrets[role], replication=False)
    await ensure_role(conn, SOURCE, secrets[SOURCE], replication=True)
    db = quote(database)
    await conn.execute(text(f"GRANT CONNECT, CREATE, TEMPORARY ON DATABASE {db} TO {MIGRATOR}"))
    await conn.execute(text(f"GRANT CONNECT ON DATABASE {db} TO {API}, {SOURCE}"))
    await conn.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {MIGRATOR}"))
    await conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {API}, {SOURCE}"))
    for grant in (
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {API}",
        f"GRANT USAGE, SELECT ON SEQUENCES TO {API}",
    ):
        await conn.execute(
            text(f"ALTER DEFAULT PRIVILEGES FOR ROLE {MIGRATOR} IN SCHEMA public {grant}")
        )
    if not await conn.scalar(text("SELECT 1 FROM pg_publication WHERE pubname = 'powersync'")):
        await conn.execute(text("CREATE PUBLICATION powersync"))
    if not await conn.scalar(
        text("SELECT 1 FROM pg_database WHERE datname = :d"), {"d": STORAGE_DB}
    ):
        await conn.execute(text(f"CREATE DATABASE {quote(STORAGE_DB)} OWNER {STORAGE}"))
    else:
        await conn.execute(text(f"ALTER DATABASE {quote(STORAGE_DB)} OWNER TO {STORAGE}"))


async def ownership(conn: AsyncConnection) -> None:
    owned = await conn.execute(
        text(
            """
            SELECT c.relname, c.relkind::text FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v')
              AND pg_get_userbyid(c.relowner) <> :migrator
              AND NOT EXISTS (
                SELECT 1 FROM pg_depend d WHERE d.objid = c.oid
                  AND (d.deptype = 'e' OR (c.relkind = 'S' AND d.deptype IN ('a', 'i')))
              )
            """
        ),
        {"migrator": MIGRATOR},
    )
    for name, kind in owned.all():
        keyword = {"r": "TABLE", "S": "SEQUENCE", "v": "VIEW"}[kind]
        await conn.execute(text(f"ALTER {keyword} public.{quote(name)} OWNER TO {MIGRATOR}"))
    functions = await conn.execute(
        text(
            """
            SELECT p.oid::regprocedure::text FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> :migrator
              AND NOT EXISTS (
                SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
              )
            """
        ),
        {"migrator": MIGRATOR},
    )
    for (signature,) in functions.all():
        await conn.execute(text(f"ALTER FUNCTION {signature} OWNER TO {MIGRATOR}"))


async def grants(conn: AsyncConnection) -> None:
    await conn.execute(
        text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {API}")
    )
    await conn.execute(text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {API}"))
    await conn.execute(text(f"REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM {SOURCE}"))
    await conn.execute(text(f"GRANT SELECT ON {synced()} TO {SOURCE}"))


def synced() -> str:
    return ", ".join(f"public.{quote(t)}" for t in synced_tables())


async def publication(admin_url: str) -> None:
    """Publish only synced tables; an all-tables publication is replaced in one transaction."""
    engine = create_async_engine(admin_url)
    async with engine.begin() as conn:
        everything = await conn.scalar(
            text("SELECT puballtables FROM pg_publication WHERE pubname = 'powersync'")
        )
        if everything:
            await conn.execute(text("DROP PUBLICATION powersync"))
            await conn.execute(text(f"CREATE PUBLICATION powersync FOR TABLE {synced()}"))
        else:
            await conn.execute(text(f"ALTER PUBLICATION powersync SET TABLE {synced()}"))
    await engine.dispose()


async def storage_owner(admin_url: str) -> None:
    engine = create_async_engine(
        make_url(admin_url).set(database=STORAGE_DB), isolation_level="AUTOCOMMIT"
    )
    async with engine.connect() as conn:
        await conn.execute(text(f"GRANT ALL ON SCHEMA public TO {STORAGE}"))
        schemas = await conn.execute(
            text(
                "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' "
                "AND nspname NOT IN ('information_schema', 'public') "
                "AND pg_get_userbyid(nspowner) <> :owner"
            ),
            {"owner": STORAGE},
        )
        for (schema,) in schemas.all():
            await conn.execute(text(f"ALTER SCHEMA {quote(schema)} OWNER TO {STORAGE}"))
        objects = await conn.execute(
            text(
                """
                SELECT n.nspname, c.relname, c.relkind::text FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
                  AND c.relkind IN ('r', 'S', 'v') AND pg_get_userbyid(c.relowner) <> :owner
                  AND NOT EXISTS (
                    SELECT 1 FROM pg_depend d
                    WHERE d.objid = c.oid AND c.relkind = 'S' AND d.deptype IN ('a', 'i')
                  )
                """
            ),
            {"owner": STORAGE},
        )
        for schema, name, kind in objects.all():
            keyword = {"r": "TABLE", "S": "SEQUENCE", "v": "VIEW"}[kind]
            await conn.execute(
                text(f"ALTER {keyword} {quote(schema)}.{quote(name)} OWNER TO {STORAGE}")
            )
    await engine.dispose()


async def main(phase: str) -> None:
    url = make_url(ADMIN_URL)
    engine = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        if phase == "roles":
            await roles(conn, url.database or "clientbridge")
            await ownership(conn)
        elif phase == "grants":
            await grants(conn)
        else:
            raise SystemExit("usage: python -m scripts.db_access roles|grants")
    await engine.dispose()
    if phase == "roles":
        await storage_owner(ADMIN_URL)
    else:
        await publication(ADMIN_URL)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
