"""cb0030 lets a package belong to one of the client's subjects."""

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


async def test_cb0030_leaves_packages_shared_checks_the_subject_and_downgrades() -> None:
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
                    "SELECT column_name FROM information_schema.columns"
                    " WHERE table_name = 'packages'"
                )
            )
            return {str(r.column_name) for r in rows}

    try:
        _run(env, "scripts.db_access", "roles")
        _run(env, "alembic", "upgrade", "cb0029")
        async with engine.begin() as conn:
            for statement in (
                "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements, status,"
                " trial_ends_at, subject) VALUES ('bz_ls', 'L', 'ls', 'America/Toronto', false,"
                " '{}', false, false, '{}', 'active', now(), 'student')",
                "INSERT INTO clients (id, business_id, name, tags, status, custom_fields)"
                " VALUES ('cl_chen', 'bz_ls', 'Hui Chen', '{}', 'active', '{}')",
                "INSERT INTO subjects (id, business_id, client_id, name, attributes)"
                " VALUES ('sj_maya', 'bz_ls', 'cl_chen', 'Maya', '{}')",
                "INSERT INTO items (id, business_id, kind, name, price_cents, currency,"
                " online_bookable, sell_online, buffer_before_min, buffer_after_min,"
                " deposit_type, tax_class, track_stock, active, session_count) VALUES"
                " ('it_term', 'bz_ls', 'package', 'Term', 40000, 'CAD', false, false, 0, 0,"
                " 'none', 'exempt', false, true, 10)",
                "INSERT INTO packages (id, business_id, client_id, item_id, sessions_total,"
                " status) VALUES ('pkg_a', 'bz_ls', 'cl_chen', 'it_term', 10, 'active')",
            ):
                await conn.execute(text(statement))
        _run(env, "alembic", "upgrade", "cb0030")
        async with engine.begin() as conn:
            kept = await conn.scalar(text("SELECT subject_id FROM packages WHERE id = 'pkg_a'"))
            assert kept is None
            await conn.execute(text("UPDATE packages SET subject_id = 'sj_maya'"))
        async with engine.begin() as conn:
            with pytest.raises(IntegrityError):
                await conn.execute(text("UPDATE packages SET subject_id = 'sj_nope'"))
        _run(env, "alembic", "downgrade", "cb0029")
        assert "subject_id" not in await columns()
        async with engine.connect() as conn:
            total = await conn.scalar(text("SELECT sessions_total FROM packages"))
        assert total == 10
        _run(env, "alembic", "upgrade", "cb0030")
        assert "subject_id" in await columns()
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
