"""Fail when PowerSync is not ready, its slot is inactive, or replication lags or retains WAL."""

import asyncio
import json
import os
import sys

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from scripts.db_access import ADMIN_URL

POWERSYNC_URL = os.environ.get("POWERSYNC_URL", "http://127.0.0.1:8704")
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


def main() -> None:
    result = asyncio.run(report(ADMIN_URL, POWERSYNC_URL))
    print(json.dumps(result, indent=1))
    sys.exit(1 if result["problems"] else 0)


if __name__ == "__main__":
    main()
