"""An e2e run's own copy of the core demo businesses in the shared tier, and its removal."""

import argparse
import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator, Iterator, Sequence
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import cast

import asyncpg
import boto3
import httpx
from scripts import demo_copy, seed_demo
from scripts.demo_context import DEMO_BUSINESSES, DEMO_PASSWORD
from sqlalchemy import CheckConstraint, String, Table, UniqueConstraint, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.integrations.kratos import get_identity_provider
from clientbridge.integrations.s3 import S3_CONFIG
from clientbridge.models import Base
from clientbridge.models.business import Business, User
from clientbridge.models.platform import File
from e2e import tier
from e2e.database import admin, on

TOKEN = re.compile(r"[A-Za-z0-9_]+")
EMAIL = re.compile(r"([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})")
# the bucket is the run's own, so stored keys stay as the seed wrote them and find their assets
KEPT = {("files", "s3_key")}


def core_businesses() -> list[str]:
    return [business.id for business in DEMO_BUSINESSES if business.core]


def unique_groups(table: Table) -> list[list[str]]:
    """Column sets unique across the whole database, which two runs' copies would collide on."""
    groups = [[c.name for c in index.columns] for index in table.indexes if index.unique]
    groups += [
        [c.name for c in constraint.columns]
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    ]
    groups += [[c.name] for c in table.columns if c.unique]
    return [group for group in groups if "business_id" not in group and "id" not in group]


def free_text(table: Table, name: str) -> bool:
    """A string column no CHECK constraint holds to a vocabulary, so a suffix keeps it valid."""
    checked = any(
        isinstance(constraint, CheckConstraint)
        and re.search(rf"\b{name}\b", str(constraint.sqltext)) is not None
        for constraint in table.constraints
    )
    return isinstance(table.c[name].type, String) and not checked


class Renamer:
    """Maps one seeded value to its namespaced form: ids, emails and globally unique values."""

    def __init__(self, namespace: str, ids: Sequence[str], identities: dict[str, str]) -> None:
        self.namespace = namespace
        self.ids = {value: self.id(value) for value in ids}
        self.identities = identities

    def id(self, value: str) -> str:
        return f"{value}_{self.namespace}"

    def email(self, value: str) -> str:
        return EMAIL.sub(lambda m: f"{m[1]}+{self.namespace}@{m[2]}", value)

    def text(self, value: str) -> str:
        return self.email(TOKEN.sub(lambda m: self.ids.get(m[0], m[0]), value))

    def value(self, table: str, column: str, value: object) -> object:
        if value is None or (table, column) in KEPT:
            return value
        if (table, column) == ("users", "identity_id"):
            return uuid.UUID(self.identities[str(value)])
        if (table, column) == ("businesses", "slug"):
            return f"{value}-{self.namespace}"
        if (table, column) == ("businesses", "sms_number"):
            # +1, the area code, the namespace and the line's last three digits stay distinct
            number = str(value)
            return f"{number[:5]}{self.namespace}{number[-3:]}"
        if isinstance(value, list):
            items = cast(list[object], value)
            return [self.text(item) if isinstance(item, str) else item for item in items]
        return self.text(value) if isinstance(value, str) else value

    def row(self, table: Table, values: Sequence[object]) -> tuple[object, ...]:
        names = [column.name for column in table.c]
        renamed = [
            self.value(table.name, name, value) for name, value in zip(names, values, strict=True)
        ]
        for group in unique_groups(table):
            positions = [names.index(name) for name in group]
            if all(renamed[i] == values[i] for i in positions):
                free = next((i for i in positions if free_text(table, names[i])), None)
                if free is not None and renamed[free] is not None:
                    renamed[free] = f"{renamed[free]}_{self.namespace}"
        return tuple(renamed)


def scope(table: Table, business_ids: Sequence[str]) -> tuple[str, list[list[str]]] | None:
    """The scratch rows to copy from a table, and the query's arguments: every seeded user."""
    if table.name == "users":
        return "TRUE", []
    found = demo_copy.scope(table, business_ids, [])
    return None if found is None else (found[0], [found[1]])


@asynccontextmanager
async def scratch_database(namespace: str) -> AsyncIterator[str]:
    """A migrated empty database beside the tier's, seeded and then copied from."""
    settings = get_settings()
    name = f"clientbridge_test_seed_{namespace}"
    await admin(f"DROP DATABASE IF EXISTS {demo_copy.quote(name)} WITH (FORCE)")
    await admin(f"CREATE DATABASE {demo_copy.quote(name)} OWNER clientbridge_migrator")
    url = await demo_copy.prepare(
        on(settings.migration_database_url, name), settings.migration_database_url
    )
    try:
        yield url
    finally:
        await admin(f"DROP DATABASE IF EXISTS {demo_copy.quote(name)} WITH (FORCE)")


async def seed_scratch(url: str, as_of: datetime) -> None:
    loop = asyncio.get_running_loop()
    businesses = core_businesses()
    with ProcessPoolExecutor(len(businesses), max_tasks_per_child=1) as pool:
        graphs = list(
            await asyncio.gather(
                *(loop.run_in_executor(pool, seed_demo.build_graph, b, as_of) for b in businesses)
            )
        )
        seed_demo.upload_demo_assets([file for graph in graphs for file in graph.ctx.all(File)])
        outcomes = await asyncio.gather(
            *(loop.run_in_executor(pool, seed_demo.written, graph, as_of, url) for graph in graphs)
        )
    failed = [f"{o.business_id}: {o.error}" for o in outcomes if o.error]
    if failed:
        raise SystemExit(f"seeding the scratch database failed: {'; '.join(failed)}")


async def link_identities(scratch: asyncpg.Connection, renamer: Renamer) -> dict[str, str]:
    """Create each seeded user's namespaced login, keyed by the scratch identity it replaces."""
    identities = get_identity_provider()
    linked: dict[str, str] = {}
    for row in await scratch.fetch("SELECT identity_id, email, name FROM users"):
        email = renamer.email(str(row["email"]))
        found = await identities.find_identity(email)
        if found is None:
            found = await identities.create_identity(
                email, str(row["name"] or ""), DEMO_PASSWORD, demo=True
            )
        linked[str(row["identity_id"])] = found
    return linked


async def copy_into(
    scratch: asyncpg.Connection, target: asyncpg.Connection, renamer: Renamer
) -> int:
    """Copy every seeded row into the shared database, renamed, in one transaction."""
    businesses = core_businesses()
    copied = 0
    async with target.transaction():
        await target.execute("SELECT set_config('clientbridge.ledger_write', 'on', true)")
        for table in Base.metadata.sorted_tables:
            found = scope(table, businesses)
            if found is None:
                continue
            where, keys = found
            columns = [column.name for column in table.c]
            query = f"SELECT {demo_copy.selected(table)} FROM {demo_copy.quote(table.name)}"
            rows = await scratch.fetch(f"{query} WHERE {where}", *keys)
            if not rows:
                continue
            records = [renamer.row(table, list(row)) for row in rows]
            if table.name == "accounts":
                # accounts start empty: inserting their entries adds each balance back
                balance = list(table.c.keys()).index("balance_cents")
                records = [(*r[:balance], 0, *r[balance + 1 :]) for r in records]
            await target.copy_records_to_table(table.name, records=records, columns=columns)
            copied += len(records)
        for column in demo_copy.DEFERRED:
            found = scope(column.table, businesses)
            if found is None:
                continue
            where, keys = found
            name, table_name = demo_copy.quote(column.name), demo_copy.quote(column.table.name)
            pairs = await scratch.fetch(
                f"SELECT id, {name} FROM {table_name} WHERE {where} AND {name} IS NOT NULL", *keys
            )
            if pairs:
                await target.execute(
                    f"UPDATE {table_name} SET {name} = v.ref"
                    " FROM unnest($1::text[], $2::text[]) AS v(id, ref)"
                    f" WHERE {table_name}.id = v.id",
                    [renamer.id(str(pair[0])) for pair in pairs],
                    [renamer.text(str(pair[1])) for pair in pairs],
                )
        await target.execute("SET CONSTRAINTS entries_balanced IMMEDIATE")
        await target.execute("SELECT set_config('clientbridge.ledger_write', 'off', true)")
        for business in businesses:
            drift = await demo_copy.count(target, demo_copy.BALANCE_DRIFT, renamer.id(business))
            if drift:
                raise ValueError(
                    f"{business}: {drift} accounts' balances differ from their entries"
                )
    return copied


async def seed(namespace: str, as_of: datetime) -> dict[str, object]:
    """Write the core demo businesses into the shared database as this namespace's own."""
    settings = get_settings()
    async with scratch_database(namespace) as url:
        await seed_scratch(url, as_of)
        scratch = await demo_copy.connect(url)
        target = await demo_copy.connect(settings.migration_database_url)
        try:
            stray = await demo_copy.uncovered(scratch, core_businesses(), [])
            stray = [entry for entry in stray if not entry.startswith("users:")]
            if stray:
                raise SystemExit(f"seeded rows outside the core businesses: {stray}")
            ids: list[str] = []
            for table in Base.metadata.sorted_tables:
                if "id" in table.c:
                    found = await scratch.fetch(f"SELECT id FROM {demo_copy.quote(table.name)}")
                    ids += [str(row[0]) for row in found]
            renamer = Renamer(namespace, ids, {})
            renamer.identities = await link_identities(scratch, renamer)
            rows = await copy_into(scratch, target, renamer)
        finally:
            await scratch.close()
            await target.close()
    return {
        "namespace": namespace,
        "rows": rows,
        "businesses": {business: renamer.id(business) for business in core_businesses()},
    }


async def purge(namespace: str) -> dict[str, int]:
    """Remove everything a namespace wrote: businesses, users, logins, mail and its bucket."""
    settings = get_settings()
    owner = create_async_engine(settings.migration_database_url)
    try:
        async with async_sessionmaker(owner)() as session, session.begin():
            owned = {"n": namespace}
            businesses = list(
                await session.scalars(
                    select(Business.id).where(text("right(businesses.id, 4) = :n")), owned
                )
            )
            users = (
                await session.execute(
                    select(User.id, User.identity_id).where(text("right(users.id, 4) = :n")),
                    owned,
                )
            ).all()
            await seed_demo.purge_businesses(session, businesses, [str(u.id) for u in users])
    finally:
        await owner.dispose()
    identities = get_identity_provider()
    logins = {str(u.identity_id) for u in users if u.identity_id}
    logins |= set(tagged_identities(namespace))
    for identity in logins:
        await identities.delete_identity(identity)
    httpx.delete(
        f"{tier.environment()['MAILPIT_URL']}/api/v1/search",
        params={"query": f'to:"+{namespace}@"'},
        timeout=10,
    )
    drop_bucket(f"e2e-{namespace}")
    return {"businesses": len(businesses), "users": len(users), "logins": len(logins)}


def tagged_identities(namespace: str) -> Iterator[str]:
    """Logins whose email carries the namespace, including signups that never reached the app."""
    admin_url = get_settings().auth_admin_url
    page: str | None = ""
    while page is not None:
        response = httpx.get(
            f"{admin_url}/admin/identities",
            params={"page_size": 250, **({"page_token": page} if page else {})},
            timeout=10,
        )
        response.raise_for_status()
        for identity in cast(list[dict[str, object]], response.json()):
            traits = cast(dict[str, object], identity.get("traits") or {})
            if f"+{namespace}@" in str(traits.get("email", "")):
                yield str(identity["id"])
        page = next_page(response.headers.get("link", ""))


def next_page(link: str) -> str | None:
    match = re.search(r'page_token=([^&>]+)[^>]*>;\s*rel="next"', link)
    return match[1] if match else None


def drop_bucket(name: str) -> None:
    settings = get_settings()
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=S3_CONFIG,
    )
    if name not in {bucket["Name"] for bucket in client.list_buckets().get("Buckets", [])}:
        return
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=name):
        keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if keys:
            client.delete_objects(Bucket=name, Delete={"Objects": keys})
    client.delete_bucket(Bucket=name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["seed", "purge"])
    parser.add_argument("namespace")
    parser.add_argument("--as-of", type=datetime.fromisoformat)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}", args.namespace):
        parser.error("the namespace is four digits")
    if args.action == "purge":
        print(json.dumps(asyncio.run(purge(args.namespace))))
        return
    seed_demo.validate_seed_target()
    result = asyncio.run(seed(args.namespace, args.as_of or clock.now()))
    if args.output is not None:
        args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
