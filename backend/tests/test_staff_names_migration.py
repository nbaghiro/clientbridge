"""cb0015 keeps a name only staff held on the account before dropping staff.name."""

import os
import secrets
import subprocess
import sys
from uuid import uuid4

from e2e.database import admin, on
from scripts.db_access import ADMIN_URL, quote
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from clientbridge.core.config import get_settings

PEOPLE: list[tuple[str, str | None, list[str | None]]] = [
    ("us_named", "Account Name", ["Staff Name"]),
    ("us_missing", None, ["  Kept Name "]),
    ("us_blank", " ", ["Blank Kept"]),
    ("us_twice", None, ["First Row", "Second Row"]),
    ("us_nameless", None, [None]),
]


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


async def _seed(conn: AsyncConnection) -> None:
    for biz in ("bz_a", "bz_b"):
        await conn.execute(
            text(
                "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
                " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements, status,"
                " trial_ends_at) VALUES (:id, :id, :id, 'America/Vancouver', false, '{}', false,"
                " false, '{}', 'active', now())"
            ),
            {"id": biz},
        )
    for user_id, name, staff_names in PEOPLE:
        await conn.execute(
            text(
                "INSERT INTO users (id, identity_id, email, name)"
                " VALUES (:id, :identity, :email, :name)"
            ),
            {"id": user_id, "identity": str(uuid4()), "email": f"{user_id}@test.ca", "name": name},
        )
        for n, staff_name in enumerate(staff_names):
            await conn.execute(
                text(
                    "INSERT INTO staff (id, business_id, user_id, role, payee, status, name,"
                    " created_at) VALUES (:id, :biz, :user, 'staff', false, 'active', :name,"
                    " now() + make_interval(secs => :n))"
                ),
                {
                    "id": f"st_{user_id}_{n}",
                    "biz": ("bz_a", "bz_b")[n],
                    "user": user_id,
                    "name": staff_name,
                    "n": n,
                },
            )


async def test_cb0015_moves_staff_names_to_their_accounts_and_its_downgrade_copies_back() -> None:
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
        _run(env, "alembic", "upgrade", "cb0014")
        async with engine.begin() as conn:
            await _seed(conn)

        async def rows(sql: str) -> dict[str, str | None]:
            async with engine.connect() as conn:
                return {str(r[0]): r[1] for r in await conn.execute(text(sql))}

        _run(env, "alembic", "upgrade", "cb0015")
        assert await rows("SELECT id, name FROM users") == {
            "us_named": "Account Name",
            "us_missing": "Kept Name",
            "us_blank": "Blank Kept",
            "us_twice": "First Row",
            "us_nameless": None,
        }
        columns = await rows(
            "SELECT column_name, table_name FROM information_schema.columns"
            " WHERE table_name = 'staff' AND column_name = 'name'"
        )
        assert columns == {}
        _run(env, "alembic", "downgrade", "cb0014")
        assert await rows("SELECT id, name FROM staff") == {
            "st_us_named_0": "Account Name",
            "st_us_missing_0": "Kept Name",
            "st_us_blank_0": "Blank Kept",
            "st_us_twice_0": "First Row",
            "st_us_twice_1": "First Row",
            "st_us_nameless_0": None,
        }
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
