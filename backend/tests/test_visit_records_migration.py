"""cb0036 moves staff-written visit records out of responses into their own table and back."""

import json
import os
import secrets
import subprocess
import sys

import pytest
from e2e import tier
from e2e.database import admin, on
from scripts.db_access import ADMIN_URL, quote
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from clientbridge.core.config import get_settings

SIGNATURE = {"user_id": "us_a", "staff_id": "st_a", "name": "Amy", "signed_at": "x", "amends": None}
DEFINITION = {"provenance": "issued", "name": "SOAP", "require_signature": False, "fields": []}


def _run(env: dict[str, str], *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-m", *args], env=env, check=False, stdout=sys.stderr, stderr=sys.stderr
    )


async def _graph(conn: AsyncConnection) -> None:
    """A business, form, client and booking; their own parents are left out of the check."""
    await conn.execute(text("SET session_replication_role = replica"))
    for statement in (
        "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
        " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements, status,"
        " trial_ends_at) VALUES ('bz_a', 'A', 'a', 'America/Vancouver', true, '{}', false,"
        " false, '{}', 'active', now())",
        "INSERT INTO forms (id, business_id, name, require_signature, active)"
        " VALUES ('frm_a', 'bz_a', 'SOAP', false, true)",
        "INSERT INTO clients (id, business_id, name, tags, status, custom_fields)"
        " VALUES ('cl_a', 'bz_a', 'Pat', '{}', 'active', '{}')",
        "INSERT INTO bookings (id, business_id, slot_id, starts_at, client_id, status, source,"
        " price_cents, deposit_amount_cents, deposit_status) VALUES ('bk_a', 'bz_a', 'ses_a',"
        " now(), 'cl_a', 'completed', 'manual', 0, 0, 'none')",
    ):
        await conn.execute(text(statement))


async def _response(conn: AsyncConnection, id_: str, token: str | None, parent: str) -> None:
    await conn.execute(
        text(
            "INSERT INTO responses (id, business_id, form_id, client_id, parent_type, parent_id,"
            " token, status, submitted_at, definition, answers, signature, created_at,"
            " updated_at) VALUES (:id, 'bz_a', 'frm_a', 'cl_a', 'booking', :parent, :token,"
            " 'submitted', '2026-10-01T18:00Z', CAST(:definition AS jsonb),"
            " CAST(:answers AS jsonb), CAST(:signature AS jsonb), '2026-10-01T18:00Z',"
            " '2026-10-01T18:05Z')"
        ),
        {
            "id": id_,
            "parent": parent,
            "token": token,
            "definition": json.dumps(DEFINITION),
            "answers": json.dumps({"subjective": "Neck"}),
            "signature": json.dumps(SIGNATURE),
        },
    )


@pytest.mark.parametrize("stray", [False, True])
async def test_cb0036_moves_records_out_of_responses_and_back(stray: bool) -> None:
    settings = get_settings()
    database = f"clientbridge_migration_{secrets.token_hex(4)}"
    url = on(settings.migration_database_url, database)
    env = os.environ | {
        "ADMIN_DATABASE_URL": on(ADMIN_URL, database),
        "MIGRATION_DATABASE_URL": url,
        "DATABASE_URL": on(settings.database_url, database),
    }
    await admin(f"CREATE DATABASE {quote(database)}")
    owner = create_async_engine(on(tier.environment()["ADMIN_DATABASE_URL"], database))
    engine = create_async_engine(url)
    try:
        assert _run(env, "scripts.db_access", "roles").returncode == 0
        assert _run(env, "alembic", "upgrade", "cb0035").returncode == 0
        async with owner.begin() as conn:
            await _graph(conn)
            await _response(conn, "fr_note", None, "bk_a")
            await _response(conn, "fr_intake", "tok", "bk_a")
            if stray:
                await _response(conn, "fr_stray", None, "bk_missing")
        upgraded = _run(env, "alembic", "upgrade", "cb0036")
        if stray:
            assert upgraded.returncode != 0
            async with engine.begin() as conn:
                version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
                assert version == "cb0035"
            return
        assert upgraded.returncode == 0
        async with engine.begin() as conn:
            moved = (await conn.execute(text("SELECT * FROM visit_records"))).mappings().one()
            assert (moved["id"], moved["booking_id"], moved["client_id"]) == (
                "fr_note",
                "bk_a",
                "cl_a",
            )
            assert moved["signature"] == SIGNATURE and moved["answers"] == {"subjective": "Neck"}
            assert moved["created_at"] != moved["updated_at"]
            left = await conn.scalars(text("SELECT id FROM responses"))
            assert list(left) == ["fr_intake"]
            nullable = await conn.scalar(
                text(
                    "SELECT is_nullable FROM information_schema.columns"
                    " WHERE table_name = 'responses' AND column_name = 'token'"
                )
            )
            assert nullable == "NO"
        assert _run(env, "alembic", "downgrade", "cb0035").returncode == 0
        async with engine.begin() as conn:
            back = (
                (await conn.execute(text("SELECT * FROM responses WHERE id = 'fr_note'")))
                .mappings()
                .one()
            )
            assert (back["token"], back["status"], back["parent_type"], back["parent_id"]) == (
                None,
                "submitted",
                "booking",
                "bk_a",
            )
            assert back["submitted_at"] == back["created_at"]
            assert back["signature"] == SIGNATURE
            table = await conn.scalar(text("SELECT to_regclass('visit_records')"))
            assert table is None
    finally:
        await owner.dispose()
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
