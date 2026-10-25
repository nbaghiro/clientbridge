"""Read-only tenant accounting snapshot or parse actual browser-downloaded CSV/ZIP."""

import argparse
import asyncio
import csv
import io
import json
from pathlib import Path
from zipfile import ZipFile

from sqlalchemy import text

from clientbridge.core.db import engine


async def evidence(business_id: str) -> dict[str, object]:
    # Entire owned fresh tenant, so accidental additional invoice/payment/journal is visible.
    queries = {
        "business": "SELECT id,province,timezone,tax_registered FROM businesses WHERE id=:business",
        "entries": "SELECT e.id,e.journal_id,e.event,e.subject_type,e.subject_id,e.source_type,"
        "e.source_id,e.amount_cents,a.category,a.code,a.owner_type,a.owner_id "
        "FROM entries e JOIN accounts a ON a.id=e.account_id "
        "WHERE e.business_id=:business ORDER BY e.id",
        "invoices": "SELECT id,status,subtotal_cents,tax_total_cents,total_cents "
        "FROM invoices WHERE business_id=:business ORDER BY id",
        "payments": "SELECT id,invoice_id,kind,status,method,amount_cents,parent_payment_id,"
        "credit_note FROM payments WHERE business_id=:business ORDER BY id",
        "lines": "SELECT id,invoice_id,item_id,quantity,amount_cents,tax_amount_cents "
        "FROM lines WHERE business_id=:business ORDER BY id",
        "commands": "SELECT id,scope,key FROM commands WHERE business_id=:business ORDER BY id",
    }
    async with engine.connect() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        result = {}
        for key, query in queries.items():
            rows = await db.execute(text(query), {"business": business_id})
            result[key] = [dict(row) for row in rows.mappings()]
        return result


def artifact(path: Path) -> dict[str, object]:
    if path.suffix == ".zip":
        with ZipFile(path) as archive:
            names = archive.namelist()
            # Preserve membership separately: duplicate members cannot be hidden by dict collapse.
            return {
                "members": names,
                "rows": {
                    name: list(csv.reader(io.StringIO(archive.read(name).decode("utf-8-sig"))))
                    for name in names
                },
            }
    return {
        "members": [path.name],
        "rows": {path.name: list(csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig"))))},
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--business")
    source.add_argument("--artifact", type=Path)
    args = parser.parse_args()
    try:
        result = artifact(args.artifact) if args.artifact else await evidence(args.business)
        print(json.dumps(result, default=str))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
