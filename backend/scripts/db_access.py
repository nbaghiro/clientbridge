"""Least-privilege database roles, grants and the replication publication, applied by an admin."""

import asyncio
import base64
import hashlib
import hmac
import os
import secrets
import sys
from typing import NamedTuple

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from clientbridge.core.config import get_settings
from scripts.gen_sync_schema import synced_tables

ADMIN_URL = os.environ.get(
    "ADMIN_DATABASE_URL",
    "postgresql+asyncpg://clientbridge:clientbridge@localhost:8702/clientbridge",
)


class Login(NamedTuple):
    role: str
    password: str
    database: str


class Logins(NamedTuple):
    migrator: Login
    api: Login
    source: Login
    storage: Login
    auth: Login


def quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def scram_verifier(password: str, *, salt: bytes | None = None, iterations: int = 4096) -> str:
    """The SCRAM-SHA-256 verifier Postgres stores, so no statement or log carries the password."""
    salt = salt if salt is not None else secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    client = hmac.digest(salted, b"Client Key", "sha256")
    server = hmac.digest(salted, b"Server Key", "sha256")

    def b64(value: bytes) -> str:
        return base64.b64encode(value).decode()

    stored = hashlib.sha256(client).digest()
    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored)}:{b64(server)}"


def login(variable: str, url: str) -> Login:
    parsed = make_url(url)
    if not parsed.username or not parsed.database:
        raise SystemExit(f"{variable} must name a user and a database")
    return Login(parsed.username, parsed.password or parsed.username, parsed.database)


def service_login(variable: str, role: str, password_variable: str, database: str) -> Login:
    local = make_url(ADMIN_URL).set(
        username=role, password=os.environ.get(password_variable, role), database=database
    )
    return login(variable, os.environ.get(variable, local.render_as_string(hide_password=False)))


def logins() -> Logins:
    """Every role and database comes from a URL, so environments on one server stay apart."""
    settings = get_settings()
    app = make_url(ADMIN_URL).database or "clientbridge"
    found = Logins(
        migrator=login("MIGRATION_DATABASE_URL", settings.migration_database_url),
        api=login("DATABASE_URL", settings.database_url),
        source=service_login(
            "POWERSYNC_SOURCE_DATABASE_URL", "powersync_source", "POWERSYNC_SOURCE_PASSWORD", app
        ),
        storage=service_login(
            "POWERSYNC_STORAGE_DATABASE_URL",
            "powersync_storage_owner",
            "POWERSYNC_STORAGE_PASSWORD",
            "powersync_storage",
        ),
        auth=service_login("AUTH_DATABASE_URL", "auth", "AUTH_DB_PASSWORD", "auth"),
    )
    for variable, each in (
        ("MIGRATION_DATABASE_URL", found.migrator),
        ("DATABASE_URL", found.api),
        ("POWERSYNC_SOURCE_DATABASE_URL", found.source),
    ):
        if each.database != app:
            raise SystemExit(f"{variable} names {each.database}, not the admin's database {app}")
    if len({each.role for each in found}) != len(found):
        raise SystemExit("each database role needs its own user name")
    if len({app, found.storage.database, found.auth.database}) != 3:
        raise SystemExit("the application, storage and auth databases need their own names")
    return found


async def ensure_role(
    conn: AsyncConnection, role: str, password: str, *, replication: bool
) -> None:
    current = (
        await conn.execute(
            text("SELECT rolsuper, rolreplication FROM pg_roles WHERE rolname = :r"), {"r": role}
        )
    ).first()
    verb = "ALTER" if current else "CREATE"
    verifier = literal(scram_verifier(password))
    try:
        # sent as is: text() would read the verifier's colons as bind parameters
        await conn.exec_driver_sql(
            f"{verb} ROLE {quote(role)} LOGIN NOCREATEDB NOCREATEROLE PASSWORD {verifier}"
        )
    except SQLAlchemyError as error:
        # the statement stays out of the message and the traceback
        raise SystemExit(f"{verb} ROLE {role} failed: {getattr(error, 'orig', error)}") from None
    # a non-superuser admin may not even name SUPERUSER, so these change only when they differ
    if current is not None and current.rolsuper:
        await conn.execute(text(f"ALTER ROLE {quote(role)} NOSUPERUSER"))
    if (current is not None and current.rolreplication) != replication:
        attribute = "REPLICATION" if replication else "NOREPLICATION"
        await conn.execute(text(f"ALTER ROLE {quote(role)} {attribute}"))


async def act_for(conn: AsyncConnection, role: str) -> None:
    """Let a non-superuser admin (Cloud SQL's) assign ownership to and act with the role."""
    able = await conn.scalar(
        text(
            "SELECT pg_has_role(current_user, :r, 'USAGE') AND pg_has_role(current_user, :r, 'SET')"
        ),
        {"r": role},
    )
    if not able:
        await conn.execute(text(f"GRANT {quote(role)} TO CURRENT_USER WITH INHERIT TRUE, SET TRUE"))


async def roles(conn: AsyncConnection, database: str, found: Logins) -> None:
    for each in (found.migrator, found.api, found.storage, found.auth):
        await ensure_role(conn, each.role, each.password, replication=False)
    await ensure_role(conn, found.source.role, found.source.password, replication=True)
    for owner in (found.migrator, found.storage, found.auth):
        await act_for(conn, owner.role)
    # cloudsqlsuperuser owns API-created databases, so every environment's admin could drop it
    await owned_database(conn, database, found.migrator.role)
    migrator, api, source = (quote(each.role) for each in (found.migrator, found.api, found.source))
    db = quote(database)
    # databases accept PUBLIC connections by default, which would open one environment to another
    await conn.execute(text(f"REVOKE CONNECT, TEMPORARY ON DATABASE {db} FROM PUBLIC"))
    await conn.execute(text(f"GRANT CONNECT, CREATE, TEMPORARY ON DATABASE {db} TO {migrator}"))
    await conn.execute(text(f"GRANT CONNECT ON DATABASE {db} TO {api}, {source}"))
    await conn.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {migrator}"))
    await conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {api}, {source}"))
    for grant in (
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {api}",
        f"GRANT USAGE, SELECT ON SEQUENCES TO {api}",
    ):
        await conn.execute(
            text(f"ALTER DEFAULT PRIVILEGES FOR ROLE {migrator} IN SCHEMA public {grant}")
        )
    if not await conn.scalar(text("SELECT 1 FROM pg_publication WHERE pubname = 'powersync'")):
        await conn.execute(text(f"SET ROLE {migrator}"))
        await conn.execute(text("CREATE PUBLICATION powersync"))
        await conn.execute(text("RESET ROLE"))
    for owned in (found.storage, found.auth):
        await owned_database(conn, owned.database, owned.role)
        await conn.execute(
            text(f"REVOKE CONNECT, TEMPORARY ON DATABASE {quote(owned.database)} FROM PUBLIC")
        )


async def owned_database(conn: AsyncConnection, name: str, owner: str) -> None:
    current = await conn.scalar(
        text("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = :d"), {"d": name}
    )
    if current is not None and not await conn.scalar(
        text("SELECT pg_has_role(current_user, :o, 'USAGE')"), {"o": current}
    ):
        raise SystemExit(
            f"the admin cannot act as {current}, which owns {name}; let db_access create the "
            f"database, or create it as the admin"
        )
    if current is None:
        await conn.execute(text(f"CREATE DATABASE {quote(name)} OWNER {quote(owner)}"))
    elif current != owner:
        await conn.execute(text(f"ALTER DATABASE {quote(name)} OWNER TO {quote(owner)}"))


async def ownership(conn: AsyncConnection, migrator: str) -> None:
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
        {"migrator": migrator},
    )
    for name, kind in owned.all():
        keyword = {"r": "TABLE", "S": "SEQUENCE", "v": "VIEW"}[kind]
        await conn.execute(text(f"ALTER {keyword} public.{quote(name)} OWNER TO {quote(migrator)}"))
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
        {"migrator": migrator},
    )
    for (signature,) in functions.all():
        await conn.execute(text(f"ALTER FUNCTION {signature} OWNER TO {quote(migrator)}"))


async def grants(conn: AsyncConnection, found: Logins) -> None:
    api, source = quote(found.api.role), quote(found.source.role)
    await conn.execute(
        text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {api}")
    )
    await conn.execute(text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {api}"))
    await conn.execute(text(f"REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM {source}"))
    await conn.execute(text(f"GRANT SELECT ON {synced()} TO {source}"))


def synced() -> str:
    return ", ".join(f"public.{quote(t)}" for t in synced_tables())


async def publication(admin_url: str, migrator: str) -> None:
    """Publish only synced tables as their owner; an all-tables publication is replaced at once."""
    engine = create_async_engine(admin_url)
    async with engine.begin() as conn:
        current = (
            await conn.execute(
                text(
                    "SELECT puballtables, pg_get_userbyid(pubowner) AS owner "
                    "FROM pg_publication WHERE pubname = 'powersync'"
                )
            )
        ).first()
        if current is not None and current.puballtables:
            await conn.execute(text("DROP PUBLICATION powersync"))
            current = None
        elif current is not None and current.owner != migrator:
            await conn.execute(text(f"ALTER PUBLICATION powersync OWNER TO {quote(migrator)}"))
        await conn.execute(text(f"SET LOCAL ROLE {quote(migrator)}"))
        if current is None:
            await conn.execute(text(f"CREATE PUBLICATION powersync FOR TABLE {synced()}"))
        else:
            await conn.execute(text(f"ALTER PUBLICATION powersync SET TABLE {synced()}"))
    await engine.dispose()


async def storage_owner(admin_url: str, storage: Login) -> None:
    engine = create_async_engine(
        make_url(admin_url).set(database=storage.database), isolation_level="AUTOCOMMIT"
    )
    async with engine.connect() as conn:
        await conn.execute(text(f"GRANT ALL ON SCHEMA public TO {quote(storage.role)}"))
        schemas = await conn.execute(
            text(
                "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' "
                "AND nspname NOT IN ('information_schema', 'public') "
                "AND pg_get_userbyid(nspowner) <> :owner"
            ),
            {"owner": storage.role},
        )
        for (schema,) in schemas.all():
            await conn.execute(text(f"ALTER SCHEMA {quote(schema)} OWNER TO {quote(storage.role)}"))
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
            {"owner": storage.role},
        )
        for schema, name, kind in objects.all():
            keyword = {"r": "TABLE", "S": "SEQUENCE", "v": "VIEW"}[kind]
            await conn.execute(
                text(
                    f"ALTER {keyword} {quote(schema)}.{quote(name)} OWNER TO {quote(storage.role)}"
                )
            )
    await engine.dispose()


async def application_database(admin_url: str) -> None:
    """Create the application database as the admin when the environment has none yet."""
    url = make_url(admin_url)
    name = url.database or "clientbridge"
    engine = create_async_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        found = await conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :d"), {"d": name})
        if not found:
            await conn.execute(text(f"CREATE DATABASE {quote(name)}"))
    await engine.dispose()


async def main(phase: str) -> None:
    if phase not in ("roles", "grants"):
        raise SystemExit("usage: python -m scripts.db_access roles|grants")
    found = logins()
    url = make_url(ADMIN_URL)
    if phase == "roles":
        await application_database(ADMIN_URL)
    engine = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        if phase == "roles":
            await roles(conn, url.database or "clientbridge", found)
            await ownership(conn, found.migrator.role)
        else:
            await grants(conn, found)
    await engine.dispose()
    if phase == "roles":
        await storage_owner(ADMIN_URL, found.storage)
    else:
        await publication(ADMIN_URL, found.migrator.role)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
