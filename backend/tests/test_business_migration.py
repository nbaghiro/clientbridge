"""cb0034 adds the day a business's GST/HST registration took effect."""

import os
import secrets
import subprocess
import sys
from datetime import date

from e2e.database import admin, on
from scripts.db_access import ADMIN_URL, quote
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from clientbridge.core.config import get_settings


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


_COLUMN = text(
    "SELECT count(*) FROM information_schema.columns"
    " WHERE table_name = 'businesses' AND column_name = 'tax_registered_on'"
)


async def test_cb0034_adds_a_nullable_registration_date_and_drops_it_on_downgrade() -> None:
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
        _run(env, "alembic", "upgrade", "cb0033")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                    " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
                    " status, trial_ends_at) VALUES ('bz_a', 'A', 'a', 'America/Vancouver',"
                    " true, '{}', false, false, '{}', 'active', now())"
                )
            )
        _run(env, "alembic", "upgrade", "cb0034")
        async with engine.begin() as conn:
            kept = await conn.scalar(text("SELECT tax_registered_on FROM businesses"))
            assert kept is None
            await conn.execute(text("UPDATE businesses SET tax_registered_on = '2026-10-01'"))
            stored = await conn.scalar(text("SELECT tax_registered_on FROM businesses"))
            assert stored == date(2026, 10, 1)
        _run(env, "alembic", "downgrade", "cb0033")
        async with engine.begin() as conn:
            assert await conn.scalar(_COLUMN) == 0
            assert await conn.scalar(text("SELECT tax_registered FROM businesses")) is True
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
