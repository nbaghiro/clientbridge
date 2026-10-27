"""The core demo businesses seeded once into a Postgres dump, which each run restores."""

import argparse
import asyncio
import fcntl
import json
import secrets
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import asyncpg
from scripts import demo_copy, seed_demo
from scripts.demo_context import DEMO_BUSINESSES

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.zones import zone
from clientbridge.models.platform import File
from e2e import tier
from e2e.database import admin, on, seed_sources

SNAPSHOTS = tier.TIER / "snapshots"
# a run restores a real-time seed this recent; the suites already run minutes after their seed
FRESH = timedelta(minutes=15)
KEPT = 6


@dataclass(frozen=True)
class Snapshot:
    dump: Path
    as_of: datetime


def inputs() -> str:
    return tier.digest(*seed_sources())


def usable(as_of: datetime, at: datetime | None, now: datetime) -> bool:
    """An explicit seed instant needs that exact seed; a real-time run a fresh one from today."""
    if at is not None:
        return as_of == at
    zones = {zone(business.timezone) for business in DEMO_BUSINESSES if business.core}
    same_day = all(as_of.astimezone(z).date() == now.astimezone(z).date() for z in zones)
    return timedelta(0) <= now - as_of <= FRESH and same_day


def recorded(directory: Path) -> Iterator[Snapshot]:
    for record in directory.glob(f"{inputs()}-*.json"):
        dump = record.with_suffix(".dump")
        if dump.is_file():
            as_of = datetime.fromisoformat(json.loads(record.read_text())["as_of"])
            yield Snapshot(dump, as_of)


def found(directory: Path, at: datetime | None, now: datetime) -> Snapshot | None:
    matches = [s for s in recorded(directory) if usable(s.as_of, at, now)]
    return max(matches, key=lambda s: s.as_of, default=None)


def prune(directory: Path) -> None:
    dumps = sorted(directory.glob("*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in dumps[KEPT:]:
        stale.with_suffix(".json").unlink(missing_ok=True)
        stale.unlink()


def core_businesses() -> list[str]:
    return [business.id for business in DEMO_BUSINESSES if business.core]


async def seed(url: str, as_of: datetime) -> None:
    """Seed the core businesses into a migrated database, one process per business."""
    loop = asyncio.get_running_loop()
    businesses = core_businesses()
    with ProcessPoolExecutor(len(businesses), max_tasks_per_child=1) as pool:
        graphs = list(
            await asyncio.gather(
                *(loop.run_in_executor(pool, seed_demo.build_graph, b, as_of) for b in businesses)
            )
        )
        outcomes = await asyncio.gather(
            *(loop.run_in_executor(pool, seed_demo.written, graph, as_of, url) for graph in graphs)
        )
    failed = [f"{o.business_id}: {o.error}" for o in outcomes if o.error]
    if failed:
        raise SystemExit(f"seeding the snapshot failed: {'; '.join(failed)}")


async def build(directory: Path, as_of: datetime) -> Snapshot:
    name = f"clientbridge_test_snapshot_{secrets.token_hex(4)}"
    await admin(f"CREATE DATABASE {demo_copy.quote(name)} OWNER clientbridge_migrator")
    try:
        migration = get_settings().migration_database_url
        url = await demo_copy.prepare(on(migration, name), migration)
        await seed(url, as_of)
        stem = directory / f"{inputs()}-{as_of.strftime('%Y%m%dT%H%M%S%z')}"
        partial = stem.with_suffix(".partial")
        with partial.open("wb") as out:
            tier.postgres("pg_dump", "--format=custom", "--dbname", name, stdout=out)
        partial.replace(stem.with_suffix(".dump"))
        stem.with_suffix(".json").write_text(json.dumps({"as_of": as_of.isoformat()}))
    finally:
        await admin(f"DROP DATABASE IF EXISTS {demo_copy.quote(name)} WITH (FORCE)")
    return Snapshot(stem.with_suffix(".dump"), as_of)


async def ensure(at: datetime | None) -> Snapshot:
    """Reuse a matching snapshot, or seed one; concurrent runs wait for the first to finish."""
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    with (SNAPSHOTS / "snapshots.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = clock.wall()
        snapshot = found(SNAPSHOTS, at, now)
        if snapshot is None:
            snapshot = await build(SNAPSHOTS, at or now)
            prune(SNAPSHOTS)
        return snapshot


def restore(snapshot: Snapshot, database: str) -> None:
    """Load a snapshot into an empty database; triggers stay off, since its ledger is complete."""
    with snapshot.dump.open("rb") as dump:
        tier.postgres(
            "pg_restore", "--exit-on-error", "--disable-triggers", "--dbname", database, stdin=dump
        )


async def upload_assets(seeded: asyncpg.Connection) -> None:
    """Put the demo assets a restored seed's files name in the configured bucket."""
    rows = await seeded.fetch("SELECT id, s3_key, size, content_type FROM files")
    files = [
        File(id=row["id"], s3_key=row["s3_key"], size=row["size"], content_type=row["content_type"])
        for row in rows
    ]
    await asyncio.to_thread(seed_demo.upload_demo_assets, files)


async def upload_restored_assets() -> None:
    seeded = await demo_copy.connect(get_settings().migration_database_url)
    try:
        await upload_assets(seeded)
    finally:
        await seeded.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=["fresh", "assets"],
        help="fresh: make sure a real-time snapshot exists for the lanes that start next; "
        "assets: upload the assets of the database the settings name, after a restore",
    )
    args = parser.parse_args()
    seed_demo.validate_seed_target()
    if args.action == "assets":
        asyncio.run(upload_restored_assets())
        return
    print(asyncio.run(ensure(None)).dump)


if __name__ == "__main__":
    main()
