"""cb0039 gives each phone to the oldest live client on it and makes the number unique."""

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
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from clientbridge.core.config import get_settings

_PHONE = "+14165550101"


def _day(month: int) -> datetime:
    return datetime(2026, month, 1, tzinfo=UTC)


def _run(env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", *args], env=env, check=True, capture_output=True, text=True
    )


async def _seed(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        for business in ("bz_a", "bz_b"):
            await conn.execute(
                text(
                    "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                    " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements,"
                    " status, trial_ends_at) VALUES (:id, :id, :id, 'America/Toronto', false,"
                    " '{}', false, false, '{}', 'active', now())"
                ),
                {"id": business},
            )
        for client, business, phone, created, deleted in (
            ("cl_oldest", "bz_a", _PHONE, _day(1), None),
            ("cl_newer", "bz_a", _PHONE, _day(2), None),
            ("cl_same_time_b", "bz_a", _PHONE, _day(2), None),
            ("cl_merged", "bz_a", _PHONE, datetime(2025, 1, 1, tzinfo=UTC), _day(3)),
            ("cl_other_business", "bz_b", _PHONE, _day(3), None),
            ("cl_typed", "bz_a", "(416) 555-0101", _day(4), None),
            ("cl_alone", "bz_a", "+14165550102", _day(3), None),
            ("cl_none_1", "bz_a", None, _day(3), None),
            ("cl_none_2", "bz_a", None, _day(3), None),
        ):
            await conn.execute(
                text(
                    "INSERT INTO clients (id, business_id, name, phone, tags, status,"
                    " custom_fields, created_at, deleted_at) VALUES (:id, :business, :id,"
                    " :phone, '{}', 'active', '{}', :created, :deleted)"
                ),
                {
                    "id": client,
                    "business": business,
                    "phone": phone,
                    "created": created,
                    "deleted": deleted,
                },
            )


async def _phones(engine: AsyncEngine) -> dict[str, str | None]:
    async with engine.connect() as conn:
        rows = await conn.execute(text("SELECT id, phone FROM clients"))
        return {str(row[0]): row[1] for row in rows}


async def _has_index(engine: AsyncEngine) -> bool:
    async with engine.connect() as conn:
        found = await conn.scalar(
            text("SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_clients_business_phone'")
        )
        return found == 1


async def _insert_twin(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO clients (id, business_id, name, phone, tags, status, custom_fields)"
                " VALUES ('cl_twin', 'bz_a', 'Twin', :phone, '{}', 'active', '{}')"
            ),
            {"phone": _PHONE},
        )


async def test_cb0039_clears_shared_phones_and_its_downgrade_drops_only_the_index() -> None:
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
        _run(env, "alembic", "upgrade", "cb0038")
        await _seed(engine)

        upgraded = _run(env, "alembic", "upgrade", "cb0039")
        assert await _phones(engine) == {
            "cl_oldest": _PHONE,
            "cl_newer": None,
            "cl_same_time_b": None,
            "cl_merged": _PHONE,
            "cl_typed": None,
            "cl_other_business": _PHONE,
            "cl_alone": "+14165550102",
            "cl_none_1": None,
            "cl_none_2": None,
        }
        assert all(c in upgraded.stderr for c in ("cl_newer", "cl_same_time_b", "cl_typed"))
        assert "cl_oldest" not in upgraded.stderr
        assert await _has_index(engine)
        with pytest.raises(IntegrityError, match="uq_clients_business_phone"):
            await _insert_twin(engine)

        _run(env, "alembic", "downgrade", "cb0038")
        assert not await _has_index(engine)
        assert (await _phones(engine))["cl_newer"] is None
        await _insert_twin(engine)
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
