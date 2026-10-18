"""Internal feedback is removed while invitation history survives."""

import os
import secrets
import subprocess
import sys

import pytest
from scripts.db_access import ADMIN_URL, quote
from scripts.fresh_database import admin, on
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from clientbridge.core.config import get_settings


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


async def test_cb0019_preserves_requests_and_removes_feedback() -> None:
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
        _run(env, "alembic", "upgrade", "cb0018")
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
                    "INSERT INTO clients (id, business_id, name, tags, status, custom_fields)"
                    " VALUES ('cl_a', 'bz_a', 'A', '{}', 'active', '{}')"
                )
            )
            for identity, requested in (("rv_request", True), ("rv_unrequested", False)):
                await conn.execute(
                    text(
                        "INSERT INTO reviews (id, business_id, client_id, status, rating, body,"
                        " response, token, requested_at, sent_to_google) VALUES"
                        " (:id, 'bz_a', 'cl_a', 'published', 5, 'private feedback', 'local reply',"
                        " :id, CASE WHEN :requested THEN '2026-10-01T12:00:00Z'::timestamptz"
                        " END, false)"
                    ),
                    {"id": identity, "requested": requested},
                )
            for scope in ("review.request", "review.respond", "client.create"):
                await conn.execute(
                    text(
                        "INSERT INTO commands (id, business_id, scope, key, response)"
                        " VALUES (:scope, 'bz_a', :scope, 'key', '{}')"
                    ),
                    {"scope": scope},
                )
        _run(env, "alembic", "upgrade", "cb0019")
        async with engine.connect() as conn:
            rows = (
                await conn.execute(text("SELECT id, client_id, requested_at FROM review_requests"))
            ).all()
            assert len(rows) == 1
            assert rows[0].id == "rv_request" and rows[0].client_id == "cl_a"
            assert rows[0].requested_at.isoformat() == "2026-10-01T12:00:00+00:00"
            assert await conn.scalar(text("SELECT to_regclass('reviews')")) is None
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM information_schema.columns"
                        " WHERE table_schema='public'"
                        " AND column_name IN ('review_hold_at', 'sent_to_google')"
                    )
                )
                == 0
            )
            remaining = (await conn.execute(text("SELECT scope FROM commands"))).scalars().all()
            assert remaining == ["client.create"]
        with pytest.raises(subprocess.CalledProcessError):
            _run(env, "alembic", "downgrade", "cb0018")
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
