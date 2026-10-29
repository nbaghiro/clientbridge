"""cb0038 records the number each STOP or START reply came from, read from its client's phone."""

import os
import secrets
import subprocess
import sys

from e2e.database import admin, on
from scripts.db_access import ADMIN_URL, quote
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from clientbridge.core.config import get_settings


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


async def _seed(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements, status,"
                " trial_ends_at) VALUES ('bz_a', 'A', 'bz-a', 'America/Toronto', false, '{}',"
                " false, false, '{}', 'active', now())"
            )
        )
        for client, phone, source in (
            ("cl_e164", "+14165550101", "reply"),
            ("cl_typed", "(416) 555-0102", "reply"),
            ("cl_world", "+44 20 7946 0958", "reply"),
            ("cl_short", "555-0103", "reply"),
            ("cl_none", None, "reply"),
            ("cl_staff", "+14165550104", "in_person"),
        ):
            await conn.execute(
                text(
                    "INSERT INTO clients (id, business_id, name, phone, tags, status,"
                    " custom_fields) VALUES (:id, 'bz_a', :id, :phone, '{}', 'active', '{}')"
                ),
                {"id": client, "phone": phone},
            )
            await conn.execute(
                text(
                    "INSERT INTO consents (id, business_id, client_id, status, source)"
                    " VALUES (:id, 'bz_a', :client, 'withdrawn', :source)"
                ),
                {"id": f"cs_{client}", "client": client, "source": source},
            )


async def _phones(engine: AsyncEngine) -> dict[str, str | None]:
    async with engine.connect() as conn:
        rows = await conn.execute(text("SELECT id, phone FROM consents"))
        return {str(row[0]): row[1] for row in rows}


async def _has_phone(engine: AsyncEngine) -> bool:
    async with engine.connect() as conn:
        found = await conn.scalar(
            text(
                "SELECT count(*) FROM information_schema.columns"
                " WHERE table_name = 'consents' AND column_name = 'phone'"
            )
        )
        return found == 1


async def _has_reply_index(engine: AsyncEngine) -> bool:
    async with engine.connect() as conn:
        found = await conn.scalar(
            text("SELECT count(*) FROM pg_indexes WHERE indexname = 'ix_consents_reply_phone'")
        )
        return found == 1


async def test_cb0038_backfills_reply_numbers_and_its_downgrade_drops_them() -> None:
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
        _run(env, "alembic", "upgrade", "cb0037")
        await _seed(engine)

        _run(env, "alembic", "upgrade", "cb0038")
        assert await _phones(engine) == {
            "cs_cl_e164": "+14165550101",
            "cs_cl_typed": "+14165550102",
            "cs_cl_world": "+442079460958",
            "cs_cl_short": None,
            "cs_cl_none": None,
            "cs_cl_staff": None,
        }
        assert await _has_reply_index(engine)

        _run(env, "alembic", "downgrade", "cb0037")
        assert not await _has_phone(engine)
        assert not await _has_reply_index(engine)
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
