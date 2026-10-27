"""cb0033 deletes client email data and drops every channel column; its downgrade restores them."""

import os
import secrets
import subprocess
import sys
from uuid import uuid4

from e2e.database import admin, on
from scripts.db_access import ADMIN_URL, quote
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from clientbridge.core import clock
from clientbridge.core.config import get_settings

TABLES = "('clients', 'consents', 'threads', 'messages', 'broadcasts', 'orders')"
DROPPED = {
    ("clients", "email"),
    ("clients", "preferred_channel"),
    ("consents", "channel"),
    ("threads", "channel"),
    ("messages", "channel"),
    ("broadcasts", "channel"),
    ("orders", "receipt_email"),
    ("orders", "receipt_channel"),
}


def _run(env: dict[str, str], *args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], env=env, check=True, stdout=sys.stderr)


async def _insert(conn: AsyncConnection, table: str, **values: object) -> None:
    names = ", ".join(values)
    params = ", ".join(f":{name}" for name in values)
    await conn.execute(text(f"INSERT INTO {table} ({names}) VALUES ({params})"), values)


async def _seed(conn: AsyncConnection) -> None:
    await conn.execute(
        text(
            "INSERT INTO businesses (id, name, slug, timezone, tax_registered, brand,"
            " stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements, status,"
            " trial_ends_at) VALUES ('bz_a', 'A', 'bz-a', 'America/Toronto', false, '{}', false,"
            " false, '{}', 'active', now())"
        )
    )
    await _insert(conn, "users", id="us_a", identity_id=str(uuid4()), email="owner@test.ca")
    await _insert(
        conn,
        "staff",
        id="st_a",
        business_id="bz_a",
        user_id="us_a",
        role="owner",
        payee=False,
        status="active",
    )
    for client, email, phone, preferred in (
        ("cl_both", "both@test.ca", "+14165550101", "email"),
        ("cl_mail", "mail@test.ca", None, "email"),
        ("cl_text", None, "+14165550102", "sms"),
    ):
        await conn.execute(
            text(
                "INSERT INTO clients (id, business_id, name, email, phone, tags, status,"
                " custom_fields, preferred_channel) VALUES (:id, 'bz_a', :id, :email, :phone,"
                " '{}', 'active', '{}', :preferred)"
            ),
            {"id": client, "email": email, "phone": phone, "preferred": preferred},
        )
    for thread, client, channel in (
        ("th_both_sms", "cl_both", "sms"),
        ("th_both_mail", "cl_both", "email"),
        ("th_mail", "cl_mail", "email"),
        ("th_text", "cl_text", "sms"),
    ):
        await _insert(
            conn,
            "threads",
            id=thread,
            business_id="bz_a",
            client_id=client,
            channel=channel,
            status="open",
        )
    for broadcast, channel in (("bc_mail", "email"), ("bc_text", "sms")):
        await conn.execute(
            text(
                "INSERT INTO broadcasts (id, business_id, name, channel, audience, status)"
                " VALUES (:id, 'bz_a', :id, :channel, '{}', 'sent')"
            ),
            {"id": broadcast, "channel": channel},
        )
    for message, thread, channel, direction, broadcast in (
        ("ms_both_sms", "th_both_sms", "sms", "out", None),
        ("ms_both_mail", "th_both_mail", "email", "out", None),
        ("ms_mail_in", "th_mail", "email", "in", None),
        ("ms_bc_mail", "th_both_mail", "email", "out", "bc_mail"),
        ("ms_bc_text", "th_text", "sms", "out", "bc_text"),
    ):
        await _insert(
            conn,
            "messages",
            id=message,
            business_id="bz_a",
            thread_id=thread,
            channel=channel,
            direction=direction,
            status="sent",
            broadcast_id=broadcast,
        )
    for consent, client, channel, status, source in (
        ("cs_text", "cl_text", "sms", "granted", "in_person"),
        ("cs_mail", "cl_both", "email", "granted", "form"),
        ("cs_complaint", "cl_both", "email", "withdrawn", "complaint"),
    ):
        await _insert(
            conn,
            "consents",
            id=consent,
            business_id="bz_a",
            client_id=client,
            channel=channel,
            status=status,
            source=source,
        )
    for order, email, phone, channel in (
        ("or_mail", "walkin@test.ca", None, "email"),
        ("or_text", None, "+14165550103", "sms"),
        ("or_none", None, None, None),
    ):
        await _insert(
            conn,
            "orders",
            id=order,
            business_id="bz_a",
            staff_id="st_a",
            status="open",
            currency="CAD",
            subtotal_cents=0,
            tax_total_cents=0,
            total_cents=0,
            source="pos",
            receipt_email=email,
            receipt_phone=phone,
            receipt_channel=channel,
            receipt_sent_at=clock.now() if channel else None,
        )


async def _schema(engine: AsyncEngine) -> dict[str, set[tuple[str, ...]]]:
    async with engine.connect() as conn:
        columns = await conn.execute(
            text(
                "SELECT table_name, column_name, data_type, is_nullable,"
                " coalesce(column_default, '') FROM information_schema.columns"
                f" WHERE table_schema = 'public' AND table_name IN {TABLES}"
            )
        )
        constraints = await conn.execute(
            text(
                "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid)"
                f" FROM pg_constraint WHERE conrelid::regclass::text IN {TABLES}"
            )
        )
        indexes = await conn.execute(
            text(
                f"SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename IN {TABLES}"
            )
        )
        return {
            "columns": {tuple(map(str, row)) for row in columns},
            "constraints": {tuple(map(str, row)) for row in constraints},
            "indexes": {tuple(map(str, row)) for row in indexes},
        }


async def _ids(engine: AsyncEngine, table: str, column: str = "id") -> dict[str, str | None]:
    async with engine.connect() as conn:
        rows = await conn.execute(text(f"SELECT id, {column} FROM {table}"))
        return {str(row[0]): row[1] for row in rows}


async def test_cb0033_drops_client_email_and_channels_and_its_downgrade_restores_them() -> None:
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
        _run(env, "alembic", "upgrade", "cb0032")
        async with engine.begin() as conn:
            await _seed(conn)
        before = await _schema(engine)

        _run(env, "alembic", "upgrade", "cb0033")
        assert set(await _ids(engine, "threads")) == {"th_both_sms", "th_text"}
        assert set(await _ids(engine, "messages")) == {"ms_both_sms", "ms_bc_text"}
        assert set(await _ids(engine, "broadcasts")) == {"bc_text"}
        assert set(await _ids(engine, "consents")) == {"cs_text"}
        assert await _ids(engine, "orders", "receipt_phone") == {
            "or_mail": None,
            "or_text": "+14165550103",
            "or_none": None,
        }
        after = await _schema(engine)
        assert {(c[0], c[1]) for c in after["columns"]}.isdisjoint(DROPPED)
        assert ("threads", "uq_threads_client", "UNIQUE (business_id, client_id)") in after[
            "constraints"
        ]
        source = next(c[2] for c in after["constraints"] if c[1] == "ck_consents_source")
        assert "complaint" not in source

        _run(env, "alembic", "downgrade", "cb0032")
        assert await _schema(engine) == before
        assert set((await _ids(engine, "threads", "channel")).values()) == {"sms"}
        assert set((await _ids(engine, "messages", "channel")).values()) == {"sms"}
        assert await _ids(engine, "orders", "receipt_channel") == {
            "or_mail": "sms",
            "or_text": "sms",
            "or_none": None,
        }
        assert await _ids(engine, "clients", "email") == dict.fromkeys(
            ("cl_both", "cl_mail", "cl_text")
        )
    finally:
        await engine.dispose()
        await admin(f"DROP DATABASE IF EXISTS {quote(database)} WITH (FORCE)")
