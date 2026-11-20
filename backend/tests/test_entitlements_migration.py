"""cb0030 lets a package belong to one of the client's subjects; cb0043 dates a membership's end."""

import os
import secrets
import subprocess
import sys
from datetime import UTC, datetime

import pytest
from e2e.database import admin, on
from scripts.db_access import ADMIN_URL, quote
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


async def test_cb0043_dates_canceled_and_archive_ended_memberships_and_downgrades() -> None:
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

    async def ends() -> dict[str, datetime | None]:
        async with engine.connect() as conn:
            rows = await conn.execute(text("SELECT id, ends_at FROM subscriptions"))
            return {str(r.id): r.ends_at for r in rows}

    try:
        _run(env, "scripts.db_access", "roles")
        _run(env, "alembic", "upgrade", "cb0042")
        async with engine.begin() as conn:
            for statement in (
                "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements, status,"
                " trial_ends_at, subject) VALUES ('bz_ls', 'L', 'ls', 'America/Toronto', false,"
                " '{}', false, false, '{}', 'active', now(), 'pet')",
                "INSERT INTO clients (id, business_id, name, tags, status, custom_fields)"
                " VALUES ('cl_chen', 'bz_ls', 'Hui Chen', '{}', 'active', '{}')",
                "INSERT INTO items (id, business_id, kind, name, price_cents, currency,"
                " online_bookable, sell_online, buffer_before_min, buffer_after_min,"
                " deposit_type, tax_class, track_stock, active, interval, frequency) VALUES"
                " ('it_club', 'bz_ls', 'subscription', 'Club', 2500, 'CAD', false, false, 0, 0,"
                " 'none', 'exempt', false, true, 1, 'month'),"
                " ('it_spa', 'bz_ls', 'subscription', 'Spa', 2500, 'CAD', false, false, 0, 0,"
                " 'none', 'exempt', false, true, 1, 'month'),"
                " ('it_gym', 'bz_ls', 'subscription', 'Gym', 2500, 'CAD', false, false, 0, 0,"
                " 'none', 'exempt', false, true, 1, 'month')",
                "INSERT INTO subscriptions (id, business_id, client_id, item_id, status,"
                " current_period_end, updated_at) VALUES"
                " ('sub_live', 'bz_ls', 'cl_chen', 'it_club', 'active', '2026-12-01T00:00Z',"
                " '2026-11-01T00:00Z'),"
                " ('sub_gone', 'bz_ls', 'cl_chen', 'it_club', 'canceled', '2026-10-01T00:00Z',"
                " '2026-10-05T00:00Z'),"
                " ('sub_cut', 'bz_ls', 'cl_chen', 'it_club', 'canceled', '2026-12-01T00:00Z',"
                " '2026-11-10T00:00Z'),"
                " ('sub_archived', 'bz_ls', 'cl_chen', 'it_spa', 'active', '2026-12-05T00:00Z',"
                " '2026-11-01T00:00Z'),"
                " ('sub_restored', 'bz_ls', 'cl_chen', 'it_gym', 'active', '2026-12-07T00:00Z',"
                " '2026-11-01T00:00Z')",
                "INSERT INTO audits (id, business_id, action, entity_type, entity_id, changes)"
                " VALUES"
                " ('audit_01', 'bz_ls', 'subscription.cancel_at_period_end', 'subscription',"
                " 'sub_archived', '{}'),"
                " ('audit_02', 'bz_ls', 'subscription.cancel_at_period_end', 'subscription',"
                " 'sub_restored', '{}'),"
                " ('audit_03', 'bz_ls', 'subscription.keep', 'subscription', 'sub_restored', '{}'),"
                " ('audit_04', 'bz_ls', 'subscription.create', 'subscription', 'sub_live', '{}')",
            ):
                await conn.execute(text(statement))
        _run(env, "alembic", "upgrade", "cb0043")
        # a cancel mid-period is dated when it happened, not at the period it had paid for
        assert await ends() == {
            "sub_live": None,
            "sub_gone": datetime(2026, 10, 1, tzinfo=UTC),
            "sub_cut": datetime(2026, 11, 10, tzinfo=UTC),
            "sub_archived": datetime(2026, 12, 5, tzinfo=UTC),
            "sub_restored": None,
        }
        _run(env, "alembic", "downgrade", "cb0042")
        async with engine.connect() as conn:
            kept = await conn.scalar(text("SELECT count(*) FROM subscriptions"))
            gone = await conn.scalar(
                text(
                    "SELECT count(*) FROM information_schema.columns"
                    " WHERE table_name = 'subscriptions' AND column_name = 'ends_at'"
                )
            )
        assert (kept, gone) == (5, 0)
        _run(env, "alembic", "upgrade", "cb0043")
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
