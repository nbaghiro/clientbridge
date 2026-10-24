"""cb0029 names the staff who offer a service, empty for everyone."""

import os
import secrets
import subprocess
import sys

from scripts.db_access import ADMIN_URL, quote
from scripts.fresh_database import admin, on
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from clientbridge.core.config import get_settings


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


async def test_cb0029_gives_every_item_an_empty_staff_list_and_downgrades() -> None:
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

    async def columns() -> set[str]:
        async with engine.connect() as conn:
            rows = await conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'items'"
                )
            )
            return {str(r.column_name) for r in rows}

    try:
        _run(env, "scripts.db_access", "roles")
        _run(env, "alembic", "upgrade", "cb0028")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                    " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
                    " status, trial_ends_at) VALUES ('bz_cut', 'C', 'cut', 'America/Vancouver',"
                    " false, '{}', false, false, '{}', 'active', now())"
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO items (id, business_id, kind, name, price_cents, currency,"
                    " online_bookable, sell_online, buffer_before_min, buffer_after_min,"
                    " deposit_type, tax_class, track_stock, active) VALUES ('it_cut', 'bz_cut',"
                    " 'service', 'Cut', 5000, 'CAD', true, false, 0, 0, 'none', 'standard',"
                    " false, true)"
                )
            )
        _run(env, "alembic", "upgrade", "cb0029")
        async with engine.begin() as conn:
            kept = await conn.scalar(text("SELECT staff_ids FROM items WHERE id = 'it_cut'"))
            assert kept == []
            await conn.execute(text("UPDATE items SET staff_ids = '{st_a}' WHERE id = 'it_cut'"))
        _run(env, "alembic", "downgrade", "cb0028")
        assert "staff_ids" not in await columns()
        async with engine.connect() as conn:
            name = await conn.scalar(text("SELECT name FROM items WHERE id = 'it_cut'"))
        assert name == "Cut"
        _run(env, "alembic", "upgrade", "cb0029")
        assert "staff_ids" in await columns()
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
