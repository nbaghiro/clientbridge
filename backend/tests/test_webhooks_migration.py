"""cb0008 clears handled Stripe payloads, and its downgrade backfills them."""

import json
import os
import secrets
import subprocess
import sys

from e2e.database import admin, on
from scripts.db_access import ADMIN_URL, quote
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from clientbridge.core.config import get_settings

ROWS = [
    ("evt_done", "stripe", "processed"),
    ("evt_failed", "stripe", "failed"),
    ("evt_pending", "stripe", "pending"),
    ("sms_done", "twilio", "processed"),
    ("mail_done", "resend", "processed"),
]


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


async def test_cb0008_clears_handled_stripe_payloads_and_its_downgrade_backfills_them() -> None:
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
        _run(env, "alembic", "upgrade", "cb0007")
        async with engine.begin() as conn:
            for row_id, provider, status in ROWS:
                await conn.execute(
                    text(
                        "INSERT INTO webhooks (id, provider, event, payload, status) "
                        "VALUES (:id, :provider, 'event', CAST(:payload AS jsonb), :status)"
                    ),
                    {
                        "id": row_id,
                        "provider": provider,
                        "payload": json.dumps({"id": row_id}),
                        "status": status,
                    },
                )

        async def payloads() -> dict[str, object]:
            async with engine.connect() as conn:
                rows = await conn.execute(text("SELECT id, payload FROM webhooks"))
                return {str(r.id): r.payload for r in rows}

        _run(env, "alembic", "upgrade", "cb0008")
        kept = {row_id: {"id": row_id} for row_id, _, _ in ROWS}
        assert await payloads() == kept | {"evt_done": None}
        _run(env, "alembic", "downgrade", "cb0007")
        assert await payloads() == kept | {"evt_done": {}}
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
