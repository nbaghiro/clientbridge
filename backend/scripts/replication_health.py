"""Fail when PowerSync is not ready, its slot is inactive, or replication lags or retains WAL."""

import asyncio
import json
import os
import sys
from collections.abc import Iterable, Mapping
from typing import NamedTuple

import httpx
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from scripts.db_access import ADMIN_URL

POWERSYNC_URL = os.environ.get("POWERSYNC_URL", "http://127.0.0.1:8704")
STORAGE_URL = os.environ.get("POWERSYNC_STORAGE_DATABASE_URL") or make_url(ADMIN_URL).set(
    database="powersync_storage"
).render_as_string(hide_password=False)
MAX_RETAINED_WAL_BYTES = 1024**3
MAX_LAG_SECONDS = 60.0


async def report(admin_url: str, powersync_url: str) -> dict[str, object]:
    try:
        ready = httpx.get(f"{powersync_url}/probes/readiness", timeout=5).is_success
    except httpx.TransportError:
        ready = False
    engine = create_async_engine(admin_url)
    async with engine.connect() as conn:
        slots = (
            await conn.execute(
                text(
                    """
                    SELECT slot_name, active,
                           pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint AS retained
                    FROM pg_replication_slots WHERE slot_name LIKE 'powersync%'
                    """
                )
            )
        ).all()
        lag = await conn.scalar(
            text(
                "SELECT COALESCE(MAX(EXTRACT(EPOCH FROM replay_lag)), 0) FROM pg_stat_replication "
                "WHERE application_name LIKE 'powersync%'"
            )
        )
    await engine.dispose()
    retained = max((int(s.retained or 0) for s in slots), default=0)
    problems = []
    if not ready:
        problems.append("PowerSync is not ready")
    if not any(s.active for s in slots):
        problems.append("no active PowerSync replication slot")
    if retained > MAX_RETAINED_WAL_BYTES:
        problems.append(f"slots retain {retained} bytes of WAL")
    if float(lag or 0) > MAX_LAG_SECONDS:
        problems.append(f"replication lags {float(lag):.0f} seconds")
    return {
        "ready": ready,
        "slots": [
            {"name": s.slot_name, "active": s.active, "retained_bytes": s.retained} for s in slots
        ],
        "lag_seconds": float(lag or 0),
        "problems": problems,
    }


class Bucket(NamedTuple):
    name: str
    operations: int
    size: int


def by_business(
    buckets: Iterable[Bucket], owners: Mapping[str, set[str]]
) -> dict[str, dict[str, int]]:
    """Buckets, operations and bytes per business, a bucket counting for each business it names."""
    found: dict[str, dict[str, int]] = {}
    for bucket in buckets:
        _, _, parameters = bucket.name.partition("[")
        values = json.loads(f"[{parameters}") if parameters else []
        for business in sorted({b for v in values for b in owners.get(str(v), set())}):
            totals = found.setdefault(business, {"buckets": 0, "operations": 0, "bytes": 0})
            totals["buckets"] += 1
            totals["operations"] += bucket.operations
            totals["bytes"] += bucket.size
    return dict(sorted(found.items(), key=lambda item: -item[1]["bytes"]))


async def bucket_sizes(admin_url: str, storage_url: str) -> dict[str, dict[str, int]]:
    engine = create_async_engine(admin_url)
    async with engine.connect() as conn:
        rows = await conn.execute(text("SELECT id, business_id, user_id FROM staff"))
        owners: dict[str, set[str]] = {}
        for staff_id, business_id, user_id in rows.all():
            for key in (staff_id, business_id, user_id):
                if key is not None:
                    owners.setdefault(str(key), set()).add(str(business_id))
    await engine.dispose()
    storage = create_async_engine(make_url(storage_url).set(drivername="postgresql+asyncpg"))
    async with storage.connect() as conn:
        buckets = [
            Bucket(str(name), int(operations), int(size))
            for name, operations, size in await conn.execute(
                text(
                    """
                    SELECT bucket_name, count(*), COALESCE(sum(octet_length(data)), 0)
                    FROM powersync.bucket_data
                    WHERE group_id = (
                      SELECT max(id) FROM powersync.sync_rules WHERE state = 'ACTIVE'
                    )
                    GROUP BY bucket_name
                    """
                )
            )
        ]
    await storage.dispose()
    return by_business(buckets, owners)


def main() -> None:
    result = asyncio.run(report(ADMIN_URL, POWERSYNC_URL))
    result["businesses"] = asyncio.run(bucket_sizes(ADMIN_URL, STORAGE_URL))
    print(json.dumps(result, indent=1))
    sys.exit(1 if result["problems"] else 0)


if __name__ == "__main__":
    main()
