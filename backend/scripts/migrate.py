"""The image's migrate step: roles, then the upgrade and grants unless a rollback finds it ahead."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from clientbridge.core.config import get_settings

BACKEND = Path(__file__).resolve().parents[1]
# set by the deploy workflow's rollback run only; any other unknown revision stops the deploy
ALLOW_AHEAD = "MIGRATE_ALLOW_AHEAD"


def known_revisions() -> set[str]:
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    return {revision.revision for revision in script.walk_revisions()}


def _heads(connection: Connection) -> tuple[str, ...]:
    return MigrationContext.configure(connection).get_current_heads()


async def current_heads(url: str) -> tuple[str, ...]:
    engine = create_async_engine(url, poolclass=NullPool)
    async with engine.connect() as conn:
        heads = await conn.run_sync(_heads)
    await engine.dispose()
    return heads


def unknown_heads() -> list[str]:
    known = known_revisions()
    heads = asyncio.run(current_heads(get_settings().migration_database_url))
    return sorted(head for head in heads if head not in known)


def run(*args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], cwd=BACKEND, check=True)


def main() -> int:
    run("scripts.db_access", "roles")
    unknown = unknown_heads()
    if unknown and os.environ.get(ALLOW_AHEAD) != "1":
        print(
            f"migrate: the database is at {', '.join(unknown)}, which this image does not know; "
            "stopping, since a squashed or deleted revision or an image from another branch "
            f"would leave the schema behind (a rollback to an older image sets {ALLOW_AHEAD}=1)",
            file=sys.stderr,
            flush=True,
        )
        return 1
    if unknown:
        # grants and the publication follow the newer image's schema, so this image leaves them
        print(
            f"migrate: the database is at {', '.join(unknown)}, which this image does not know "
            f"and {ALLOW_AHEAD}=1 allows (a rollback); skipping alembic upgrade and db_access "
            "grants",
            flush=True,
        )
        return 0
    run("alembic", "upgrade", "head")
    run("scripts.db_access", "grants")
    return 0


if __name__ == "__main__":
    sys.exit(main())
