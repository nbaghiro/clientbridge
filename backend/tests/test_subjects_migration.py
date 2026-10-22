"""cb0016 moves the subject kind onto the business, cb0019 adds sites and cb0028 vehicles."""

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


async def test_cb0016_backfills_pet_businesses_refuses_other_kinds_and_downgrades() -> None:
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
        _run(env, "alembic", "upgrade", "cb0015")
        async with engine.begin() as conn:
            for biz in ("bz_pets", "bz_plain"):
                await conn.execute(
                    text(
                        "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                        " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
                        " status, trial_ends_at) VALUES (:id, :id, :id, 'America/Vancouver',"
                        " false, '{}', false, false, '{}', 'active', now())"
                    ),
                    {"id": biz},
                )
            await conn.execute(
                text(
                    "INSERT INTO clients (id, business_id, name, tags, status, custom_fields)"
                    " VALUES ('cl_a', 'bz_pets', 'A', '{}', 'active', '{}')"
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO subjects (id, business_id, client_id, kind, name, attributes)"
                    " VALUES ('sj_a', 'bz_pets', 'cl_a', 'vehicle', 'Van', '{}')"
                )
            )
        with pytest.raises(subprocess.CalledProcessError):
            _run(env, "alembic", "upgrade", "cb0016")
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE subjects SET kind = 'pet'"))
        _run(env, "alembic", "upgrade", "cb0016")

        async def kinds() -> dict[str, object]:
            async with engine.connect() as conn:
                rows = await conn.execute(text("SELECT id, subject FROM businesses ORDER BY id"))
                return {str(r.id): r.subject for r in rows}

        assert await kinds() == {"bz_pets": "pet", "bz_plain": None}
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE businesses SET subject = 'student' WHERE id = 'bz_pets'")
            )
        _run(env, "alembic", "downgrade", "cb0015")
        async with engine.connect() as conn:
            kind = await conn.scalar(text("SELECT kind FROM subjects WHERE id = 'sj_a'"))
        assert kind == "child"
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")


async def test_cb0019_takes_site_businesses_and_refuses_to_downgrade_while_one_exists() -> None:
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
        _run(env, "alembic", "upgrade", "cb0019")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                    " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
                    " status, trial_ends_at, subject) VALUES ('bz_site', 'S', 'site',"
                    " 'America/Vancouver', false, '{}', false, false, '{}', 'active', now(),"
                    " 'site')"
                )
            )
        with pytest.raises(subprocess.CalledProcessError):
            _run(env, "alembic", "downgrade", "cb0018")
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE businesses SET subject = 'property'"))
        _run(env, "alembic", "downgrade", "cb0018")
        async with engine.begin() as conn:
            with pytest.raises(IntegrityError):
                await conn.execute(text("UPDATE businesses SET subject = 'site'"))
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")


async def test_cb0028_takes_vehicle_businesses_and_refuses_to_downgrade_while_one_exists() -> None:
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
        _run(env, "alembic", "upgrade", "cb0028")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                    " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
                    " status, trial_ends_at, subject) VALUES ('bz_car', 'C', 'car',"
                    " 'America/Vancouver', false, '{}', false, false, '{}', 'active', now(),"
                    " 'vehicle')"
                )
            )
        with pytest.raises(subprocess.CalledProcessError):
            _run(env, "alembic", "downgrade", "cb0027")
        async with engine.begin() as conn:
            kept = await conn.execute(text("SELECT subject FROM businesses WHERE id = 'bz_car'"))
            assert kept.scalar_one() == "vehicle"
            await conn.execute(text("UPDATE businesses SET subject = 'site'"))
        _run(env, "alembic", "downgrade", "cb0027")
        async with engine.begin() as conn:
            with pytest.raises(IntegrityError):
                await conn.execute(text("UPDATE businesses SET subject = 'vehicle'"))
        _run(env, "alembic", "upgrade", "cb0028")
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE businesses SET subject = 'vehicle'"))
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
