"""cb0020 lets a file belong to a booking and refuses to reverse while one does."""

import os
import secrets
import subprocess
import sys

import pytest
from scripts.db_access import ADMIN_URL, quote
from scripts.fresh_database import admin, on
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from clientbridge.core.config import get_settings


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


async def test_cb0020_takes_booking_files_and_refuses_to_downgrade_while_one_exists() -> None:
    settings = get_settings()
    database = f"clientbridge_migration_{secrets.token_hex(4)}"
    url = on(settings.migration_database_url, database)
    env = os.environ | {
        "ADMIN_DATABASE_URL": on(ADMIN_URL, database),
        "MIGRATION_DATABASE_URL": url,
        "DATABASE_URL": on(settings.database_url, database),
    }
    await admin(f"CREATE DATABASE {quote(database)}")
    engine = create_async_engine(url)
    try:
        _run(env, "scripts.db_access", "roles")
        _run(env, "alembic", "upgrade", "cb0020")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                    " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
                    " status, trial_ends_at) VALUES ('bz_a', 'A', 'a', 'America/Vancouver',"
                    " false, '{}', false, false, '{}', 'active', now())"
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO files (id, business_id, parent_type, parent_id, s3_key)"
                    " VALUES ('fl_a', 'bz_a', 'booking', 'bk_a', 'bz_a/fl_a')"
                )
            )
        with pytest.raises(subprocess.CalledProcessError):
            _run(env, "alembic", "downgrade", "cb0019")
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM files"))
        _run(env, "alembic", "downgrade", "cb0019")
        async with engine.begin() as conn:
            with pytest.raises(IntegrityError):
                await conn.execute(
                    text(
                        "INSERT INTO files (id, business_id, parent_type, parent_id, s3_key)"
                        " VALUES ('fl_b', 'bz_a', 'booking', 'bk_a', 'bz_a/fl_b')"
                    )
                )
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
