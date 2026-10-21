"""Compare two databases' demo rows, with generated ids replaced by stable names."""

import argparse
import asyncio
import hashlib
import json
import re
import sys

from sqlalchemy import Table, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from clientbridge.models import Base
from scripts.demo_context import DEMO_IDS

ULID = re.compile(r"\b([a-z]+)_[0-9A-HJKMNP-TV-Z]{26}\b")
# auth identities differ by auth service, not by seed
SKIPPED = {("users", "identity_id")}


def _scope(table: Table) -> str | None:
    if "business_id" in table.c:
        return f'SELECT * FROM "{table.name}" WHERE business_id = ANY(:ids)'
    if table.name == "businesses":
        return "SELECT * FROM businesses WHERE id = ANY(:ids)"
    if table.name == "users":
        return (
            "SELECT * FROM users"
            " WHERE id IN (SELECT user_id FROM staff WHERE business_id = ANY(:ids))"
        )
    return None


async def _names(conn: AsyncConnection, ids: list[str]) -> dict[str, str]:
    """Ledger ids are random, so each takes its journal's ref, its account's key or its leg."""
    names: dict[str, str] = {}
    journals = await conn.execute(
        text("SELECT DISTINCT journal_id, ref FROM entries WHERE business_id = ANY(:ids)"),
        {"ids": ids},
    )
    for journal_id, ref in journals.tuples():
        names[journal_id] = f"journal<{ref}>"
    accounts = await conn.execute(
        text(
            "SELECT id, owner_type, owner_id, category, code, currency FROM accounts"
            " WHERE business_id = ANY(:ids)"
        ),
        {"ids": ids},
    )
    for account_id, *key in accounts.tuples():
        names[account_id] = "account<" + ":".join(map(str, key)) + ">"
    entries = await conn.execute(
        text("SELECT id, ref, leg FROM entries WHERE business_id = ANY(:ids)"), {"ids": ids}
    )
    for entry_id, ref, leg in entries.tuples():
        names[entry_id] = f"entry<{ref}#{leg}>"
    return names


async def fingerprint(url: str) -> dict[str, list[str]]:
    engine = create_async_engine(url)
    ids = list(DEMO_IDS)
    tables: dict[str, list[str]] = {}
    async with engine.connect() as conn:
        names = await _names(conn, ids)

        def named(value: object) -> str:
            raw = (
                value if isinstance(value, str) else json.dumps(value, default=str, sort_keys=True)
            )
            for _ in range(3):
                raw = ULID.sub(lambda m: names.get(m.group(0), m.group(0)), raw)
            return ULID.sub(lambda m: f"{m.group(1)}_*", raw)

        for table in Base.metadata.sorted_tables:
            query = _scope(table)
            if query is None:
                continue
            result = await conn.execute(text(query), {"ids": ids})
            tables[table.name] = sorted(
                named({k: v for k, v in row.items() if (table.name, k) not in SKIPPED})
                for row in result.mappings()
            )
    await engine.dispose()
    return tables


def digest(rows: list[str]) -> str:
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()[:16]


async def compare(first: str, second: str) -> bool:
    a, b = await fingerprint(first), await fingerprint(second)
    same = True
    for table in sorted(set(a) | set(b)):
        left, right = a.get(table, []), b.get(table, [])
        if digest(left) == digest(right):
            print(f"{table:28s} {len(left):7d} rows  {digest(left)}")
            continue
        same = False
        only_left, only_right = sorted(set(left) - set(right)), sorted(set(right) - set(left))
        print(f"{table:28s} {len(left):7d} vs {len(right)} rows  DIFFERENT")
        for row in only_left[:2]:
            print(f"    first:  {row[:300]}")
        for row in only_right[:2]:
            print(f"    second: {row[:300]}")
    total = sum(len(rows) for rows in a.values())
    print(f"{'identical' if same else 'different'}: {len(a)} tables, {total} rows")
    return same


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare", nargs=2, metavar="URL", required=True)
    args = parser.parse_args()
    sys.exit(0 if asyncio.run(compare(*args.compare)) else 1)
