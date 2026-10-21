"""Wait until PowerSync has replicated every write so far, so e2e suites start on a full replica."""

import asyncio
import time

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from scripts.db_access import ADMIN_URL

TIMEOUT_SECONDS = 600
TOUCH = "UPDATE businesses SET updated_at = updated_at WHERE id = (SELECT min(id) FROM businesses)"
REACHED = (
    "SELECT coalesce(bool_or(last_checkpoint_lsn::pg_lsn >= CAST(CAST(:target AS text) AS pg_lsn)),"
    " false) FROM powersync.sync_rules WHERE state = 'ACTIVE' AND snapshot_done"
)


async def main() -> None:
    source = create_async_engine(ADMIN_URL)
    storage = create_async_engine(make_url(ADMIN_URL).set(database="powersync_storage"))
    async with source.begin() as conn:
        target = await conn.scalar(text("SELECT pg_current_wal_lsn()::text"))
        # a commit on a synced table, so the checkpoint moves past the target once PowerSync is idle
        await conn.execute(text(TOUCH))
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while True:
        async with storage.connect() as conn:
            reached = await conn.scalar(text(REACHED), {"target": target})
        if reached:
            break
        if time.monotonic() > deadline:
            raise SystemExit(f"powersync has not replicated up to {target}")
        await asyncio.sleep(1)
    await source.dispose()
    await storage.dispose()
    print(f"PowerSync has replicated up to {target}.")


if __name__ == "__main__":
    asyncio.run(main())
