"""Seed into a scratch database beside the seed, then copy each business with COPY."""

import asyncio
import os
import sys
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

import asyncpg
from sqlalchemy import Column, Table, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clientbridge.core.db import Base

BACKEND = Path(__file__).resolve().parents[1]
DIALECT = postgresql.dialect()
type Scope = tuple[str, list[str]]
# a column whose FK closes a cycle is written after the table it points at
DEFERRED: list[Column[object]] = [
    fk.parent for table in Base.metadata.sorted_tables for fk in table.foreign_keys if fk.use_alter
]
BALANCE_DRIFT = """
    SELECT count(*) FROM accounts a WHERE a.business_id = $1 AND a.balance_cents <> (
        SELECT coalesce(sum(e.amount_cents), 0) FROM entries e WHERE e.account_id = a.id
    )
"""


def quote(name: str) -> str:
    return DIALECT.identifier_preparer.quote(name)


def scope(table: Table, business_ids: Sequence[str], user_ids: Sequence[str]) -> Scope | None:
    """The condition on $1 that picks these businesses' rows, or their users', from the table."""
    if "business_id" in table.c:
        return "business_id = ANY($1::text[])", list(business_ids)
    if table.name == "businesses":
        return "id = ANY($1::text[])", list(business_ids)
    if table.name == "users":
        return "id = ANY($1::text[])", list(user_ids)
    return None


def selected(table: Table) -> str:
    return ", ".join(
        f"NULL::{column.type.compile(dialect=DIALECT)}"
        if column in DEFERRED
        else quote(column.name)
        for column in table.c
    )


async def prepare(scratch_url: str, target_url: str) -> str:
    """Create and migrate an empty scratch database; return the URL its writers use."""
    url = make_url(scratch_url).set(drivername="postgresql+asyncpg")
    target = make_url(target_url)
    if not url.database:
        raise SystemExit("--scratch must name a database")
    if (url.host, url.port or 5432, url.database) == (
        target.host,
        target.port or 5432,
        target.database,
    ):
        raise SystemExit("--scratch must not be the seed target")
    admin = create_async_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        found = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :d"), {"d": url.database}
        )
        if not found:
            await conn.execute(text(f"CREATE DATABASE {quote(url.database)}"))
    await admin.dispose()
    rendered = url.render_as_string(hide_password=False)
    scratch = create_async_engine(rendered)
    async with scratch.connect() as conn:
        tables = await conn.scalar(
            text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
        )
    await scratch.dispose()
    if tables:
        raise SystemExit(f"the scratch database {url.database} must start empty")
    migrate = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "alembic",
        "upgrade",
        "head",
        cwd=BACKEND,
        env=os.environ | {"MIGRATION_DATABASE_URL": rendered},
    )
    if await migrate.wait():
        raise SystemExit("migrating the scratch database failed")
    return rendered


async def connect(url: str) -> asyncpg.Connection:
    return await asyncpg.connect(make_url(url).set(drivername="postgresql").render_as_string(False))


async def count(conn: asyncpg.Connection, query: str, *args: object) -> int:
    value = await conn.fetchval(query, *args)
    if not isinstance(value, int):
        raise TypeError(f"expected a count, got {value!r}")
    return value


def copied_rows(status: str) -> int:
    return int(status.rsplit(" ", 1)[-1])


async def uncovered(
    scratch: asyncpg.Connection, business_ids: Sequence[str], user_ids: Sequence[str]
) -> list[str]:
    """Tables with scratch rows outside these businesses and their users, which no copy takes."""
    found: list[str] = []
    for table in Base.metadata.sorted_tables:
        found_scope = scope(table, business_ids, user_ids)
        total = await count(scratch, f"SELECT count(*) FROM {quote(table.name)}")
        covered = 0
        if found_scope is not None:
            where, keys = found_scope
            covered = await count(
                scratch, f"SELECT count(*) FROM {quote(table.name)} WHERE {where}", keys
            )
        if total != covered:
            found.append(f"{table.name}: {total - covered}")
    return found


async def _replay(chunks: list[bytes]) -> AsyncIterator[bytes]:
    for chunk in chunks:
        yield chunk


async def copy_business(
    scratch: asyncpg.Connection, session: AsyncSession, business_id: str, user_ids: Sequence[str]
) -> int:
    """Copy one purged business's rows into the session's transaction, parents first."""
    connection = await session.connection()
    raw = await connection.get_raw_connection()
    target: asyncpg.Connection | None = raw.driver_connection
    if target is None:
        raise RuntimeError("the session has no asyncpg connection")
    # accounts arrive with their balances, so posting the entries must not add them again
    await target.execute("SELECT set_config('clientbridge.ledger_write', 'on', true)")
    await target.execute("ALTER TABLE entries DISABLE TRIGGER accounts_balance_from_entries")
    copied = 0
    for table in Base.metadata.sorted_tables:
        found = scope(table, [business_id], user_ids)
        if found is None:
            continue
        where, keys = found
        chunks: list[bytes] = []

        async def collect(chunk: bytes, into: list[bytes] = chunks) -> None:
            into.append(chunk)

        status: str = await scratch.copy_from_query(
            f"SELECT {selected(table)} FROM {quote(table.name)} WHERE {where}",
            keys,
            output=collect,
            format="binary",
        )
        rows = copied_rows(status)
        if rows:
            written: str = await target.copy_to_table(
                table.name,
                source=_replay(chunks),
                columns=[column.name for column in table.c],
                format="binary",
            )
            if copied_rows(written) != rows:
                raise ValueError(f"{table.name}: read {rows} rows but wrote {written}")
            copied += rows
    for column in DEFERRED:
        found = scope(column.table, [business_id], user_ids)
        if found is None:
            continue
        where, keys = found
        table, name = quote(column.table.name), quote(column.name)
        pairs = await scratch.fetch(
            f"SELECT id, {name} FROM {table} WHERE {where} AND {name} IS NOT NULL", keys
        )
        if pairs:
            await target.execute(
                f"UPDATE {table} SET {name} = v.ref"
                " FROM unnest($1::text[], $2::text[]) AS v(id, ref)"
                f" WHERE {table}.id = v.id",
                [pair[0] for pair in pairs],
                [pair[1] for pair in pairs],
            )
    # each journal's balance check runs now, since a table with queued checks cannot be altered
    await target.execute("SET CONSTRAINTS entries_balanced IMMEDIATE")
    await target.execute("ALTER TABLE entries ENABLE TRIGGER accounts_balance_from_entries")
    await target.execute("SELECT set_config('clientbridge.ledger_write', 'off', true)")
    drift = await count(target, BALANCE_DRIFT, business_id)
    if drift:
        raise ValueError(f"{drift} accounts' balances differ from their entries")
    return copied
