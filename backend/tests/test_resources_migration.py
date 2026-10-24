"""cb0031 adds rooms and equipment, a service's pool and the resource a slot holds."""

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


_BUSINESS = (
    "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
    " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
    " status, trial_ends_at) VALUES ('bz_spa', 'S', 'spa', 'America/Vancouver',"
    " false, '{}', false, false, '{}', 'active', now())"
)
_ITEM = (
    "INSERT INTO items (id, business_id, kind, name, price_cents, currency,"
    " online_bookable, sell_online, buffer_before_min, buffer_after_min,"
    " deposit_type, tax_class, track_stock, active) VALUES ('it_rub', 'bz_spa',"
    " 'service', 'Rub', 5000, 'CAD', true, false, 0, 0, 'none', 'standard',"
    " false, true)"
)
_STAFF = (
    "INSERT INTO staff (id, business_id, role, payee, status)"
    " VALUES ('st_a', 'bz_spa', 'owner', false, 'active'),"
    " ('st_b', 'bz_spa', 'staff', false, 'active')"
)


def _slot(slot_id: str, start: str, end: str, staff: str = "st_a") -> str:
    return (
        "INSERT INTO slots (id, business_id, item_id, staff_id, resource_id, starts_at, ends_at,"
        f" capacity, status) VALUES ('{slot_id}', 'bz_spa', 'it_rub', '{staff}', 'rs_one',"
        f" '{start}', '{end}', 1, 'scheduled')"
    )


async def test_cb0031_adds_resources_refuses_a_double_booking_and_downgrades_once_unused() -> None:
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

    async def tables() -> set[str]:
        async with engine.connect() as conn:
            rows = await conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
                )
            )
            return {str(r.table_name) for r in rows}

    try:
        _run(env, "scripts.db_access", "roles")
        _run(env, "alembic", "upgrade", "cb0030")
        async with engine.begin() as conn:
            for statement in (_BUSINESS, _ITEM, _STAFF):
                await conn.execute(text(statement))
        _run(env, "alembic", "upgrade", "cb0031")
        async with engine.begin() as conn:
            assert (
                await conn.scalar(text("SELECT resource_ids FROM items WHERE id = 'it_rub'")) == []
            )
            await conn.execute(
                text(
                    "INSERT INTO resources (id, business_id, name)"
                    " VALUES ('rs_one', 'bz_spa', 'Room')"
                )
            )
            await conn.execute(text(_slot("ses_a", "2027-01-01 10:00Z", "2027-01-01 11:00Z")))
            await conn.execute(text(_slot("ses_b", "2027-01-01 11:00Z", "2027-01-01 12:00Z")))
        with pytest.raises(IntegrityError, match="excl_slots_resource_overlap"):
            async with engine.begin() as conn:
                await conn.execute(
                    text(_slot("ses_c", "2027-01-01 10:30Z", "2027-01-01 11:30Z", "st_b"))
                )
        with pytest.raises(IntegrityError, match="ux_resources_business_name"):
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO resources (id, business_id, name)"
                        " VALUES ('rs_two', 'bz_spa', 'ROOM')"
                    )
                )
        with pytest.raises(subprocess.CalledProcessError):
            _run(env, "alembic", "downgrade", "cb0030")
        assert "resources" in await tables()
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM slots"))
        _run(env, "alembic", "downgrade", "cb0030")
        assert "resources" not in await tables()
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT name FROM items WHERE id = 'it_rub'")) == "Rub"
        _run(env, "alembic", "upgrade", "cb0031")
        assert "resources" in await tables()
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
